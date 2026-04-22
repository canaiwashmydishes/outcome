import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { getIngestConfig } from '../lib/ingestConfig.js';
import { ANTHROPIC_API_KEY } from '../lib/secrets.js';
import { processOcrSync } from '../ingest/documentAI.js';
import { claudeClient } from '../clients/claude.js';
import type {
  DealDocument,
  Deal,
  AuditEvent,
} from '@outcome99/shared';

/**
 * POST /processDocument
 *
 * Per-document worker invoked by Cloud Tasks.
 *
 * Pipeline:
 *   1. Load doc row; if not in 'uploaded' state, exit (idempotent retry).
 *   2. Transition → 'ocr_in_progress'. Run OCR via Document AI.
 *   3. Transition → 'classifying'. Call Claude Sonnet classifyDocument.
 *   4. Transition → 'completed'. Write workstream, OCR text, page count.
 *
 * Failure handling:
 *   - Any thrown error transitions the doc to 'failed' with the error
 *     message, returns 200 (so Cloud Tasks does NOT retry), and writes
 *     a document_failed audit event. Cloud Tasks retries 5xx responses
 *     for transient infrastructure failures only.
 *
 * Authentication:
 *   - The Cloud Tasks OIDC token is validated by the Cloud Functions
 *     runtime (enforced by the invoker IAM binding on the function).
 *     We verify the request body is well-formed JSON with the expected
 *     shape; beyond that, if a Task reaches this function it's trusted.
 */

const BodySchema = z.object({
  dealId: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
});

/** Soft cap on how much OCR text we inline into the doc row. Longer
 *  extracts go to GCS. Firestore's 1 MiB doc limit forces us to keep
 *  the row lightweight. */
const INLINE_OCR_MAX_CHARS = 40_000;

/** Excerpt length sent to the classifier. Larger excerpts raise cost
 *  without meaningfully improving classification accuracy. */
const CLASSIFIER_EXCERPT_CHARS = 6_000;

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export const processDocument = onRequest(
  {
    cors: false,
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [ANTHROPIC_API_KEY],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).send(`Invalid body: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      return;
    }
    const { dealId, documentId } = parsed.data;

    const dealRef = db.collection('deals').doc(dealId);
    const docRef = dealRef.collection('documents').doc(documentId);

    try {
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        logger.warn('processDocument: doc not found; acking', { dealId, documentId });
        res.status(200).send({ ok: true, skipped: 'not_found' });
        return;
      }
      const doc = docSnap.data() as DealDocument;

      // Idempotency — if the doc has already progressed past 'uploaded',
      // ack without re-running.
      if (doc.status !== 'uploaded') {
        logger.info('processDocument: skipping non-uploaded doc', {
          dealId,
          documentId,
          status: doc.status,
        });
        res.status(200).send({ ok: true, skipped: doc.status });
        return;
      }

      // Step 1: OCR
      await docRef.update({ status: 'ocr_in_progress' });

      const cfg = getIngestConfig();
      const [buffer] = await getStorage()
        .bucket(cfg.storage.bucket)
        .file(doc.storagePath)
        .download();
      const contentBase64 = buffer.toString('base64');
      const ocrResult = await processOcrSync({
        contentBase64,
        mimeType: doc.mimeType,
      });

      // Step 2: Classification
      await docRef.update({ status: 'classifying' });

      const excerpt = ocrResult.text.slice(0, CLASSIFIER_EXCERPT_CHARS);
      const classification = await claudeClient.classifyDocument({
        filename: doc.name,
        folderPath: doc.folderPath,
        ocrExcerpt: excerpt,
      });

      // Step 3: Persist OCR text. Inline if small; spill to GCS if large.
      let inlineOcrText: string | undefined;
      let ocrStoragePath: string | undefined;
      if (ocrResult.text.length <= INLINE_OCR_MAX_CHARS) {
        inlineOcrText = ocrResult.text;
      } else {
        ocrStoragePath = `deals/${dealId}/ocr/${documentId}.txt`;
        await getStorage()
          .bucket(cfg.storage.bucket)
          .file(ocrStoragePath)
          .save(ocrResult.text, { contentType: 'text/plain' });
        // Include an inline tail so the UI can preview even for large docs.
        inlineOcrText = ocrResult.text.slice(0, INLINE_OCR_MAX_CHARS);
      }

      // Step 4: Finalize.
      await docRef.update({
        status: 'completed',
        pages: ocrResult.pageCount,
        workstream: classification.workstream,
        classifierConfidence: classification.confidence,
        classifierRationale: classification.rationale,
        ocrText: inlineOcrText,
        ocrStoragePath: ocrStoragePath ?? FieldValue.delete(),
        processedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Document processed', {
        dealId,
        documentId,
        workstream: classification.workstream,
        confidence: classification.confidence,
        pages: ocrResult.pageCount,
      });

      res.status(200).send({ ok: true });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('processDocument failed', { dealId, documentId, err: message });

      // Mark failed, write audit, ack the task to prevent retries of a
      // non-transient error (malformed PDF, permanent OCR rejection, etc.).
      const dealSnap = await dealRef.get();
      const deal = dealSnap.data() as Deal | undefined;

      try {
        await docRef.update({
          status: 'failed',
          failureReason: message.slice(0, 500),
          processedAt: FieldValue.serverTimestamp(),
        });
        if (deal) {
          const auditRef = dealRef.collection('auditLog').doc();
          const auditEvent: Omit<AuditEvent, 'id'> = {
            dealId,
            teamId: deal.teamId,
            actorId: 'system',
            actorRole: 'system',
            eventType: 'document_failed',
            targetType: 'document',
            targetId: documentId,
            rationale: message.slice(0, 500),
            timestamp: FieldValue.serverTimestamp(),
          };
          await auditRef.set(auditEvent);
        }
      } catch (writeErr) {
        logger.error('processDocument: failure-path write failed', {
          err: String(writeErr),
        });
      }

      res.status(200).send({ ok: false, err: message });
      return;
    }
  }
);
