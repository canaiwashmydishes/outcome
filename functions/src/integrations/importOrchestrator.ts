import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { logger } from 'firebase-functions/v2';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { getIngestConfig } from '../lib/ingestConfig.js';
import { getAccessToken, IntegrationExpiredError } from './lib/tokens.js';
import { makeAdapter } from './lib/factory.js';
import { enqueueDocumentProcessing } from '../ingest/cloudTasks.js';
import { ANTHROPIC_API_KEY } from '../lib/secrets.js';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  MS_OAUTH_CLIENT_ID,
  MS_OAUTH_CLIENT_SECRET,
  DROPBOX_OAUTH_CLIENT_ID,
  DROPBOX_OAUTH_CLIENT_SECRET,
} from '../lib/secrets.js';
import type {
  AuditEvent,
  Deal,
  DealDocument,
  IntegrationImport,
} from '@outcome99/shared';

/**
 * POST /importOrchestrator
 *
 * Cloud Tasks invokes this with a payload `{dealId, importId}`. The
 * orchestrator:
 *   1. Resolves the import row + deal + connected provider adapter.
 *   2. Walks the subtree rooted at `rootItemId` using the adapter's
 *      walkSubtree async generator.
 *   3. For each file:
 *        - Downloads bytes from the provider.
 *        - Computes SHA-256.
 *        - Dedups against existing deal documents.
 *        - If new: uploads to GCS, creates the DealDocument row in
 *          'uploaded' state, enqueues processDocument Cloud Task.
 *        - If duplicate: creates a 'skipped_duplicate' row pointing to
 *          the canonical doc.
 *   4. Updates import row progress as files are dispatched.
 *   5. Marks the import 'completed' when the walk finishes.
 *
 * Reuses Build B's processDocument pipeline verbatim for OCR + classify.
 *
 * Failure handling: per-file errors are logged and counted but don't abort
 * the walk. The whole import fails only if the provider is unreachable or
 * credentials expire mid-walk, in which case the import row is marked
 * 'failed' with failureReason. We always return 200 to Cloud Tasks so it
 * doesn't retry (the sweep below will catch leftovers).
 */

const BodySchema = z.object({
  dealId: z.string().min(1).max(128),
  importId: z.string().min(1).max(128),
});

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export const importOrchestrator = onRequest(
  {
    cors: false,
    memory: '2GiB',
    timeoutSeconds: 1800, // up to 30 min per import
    secrets: [
      ANTHROPIC_API_KEY,
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      MS_OAUTH_CLIENT_ID,
      MS_OAUTH_CLIENT_SECRET,
      DROPBOX_OAUTH_CLIENT_ID,
      DROPBOX_OAUTH_CLIENT_SECRET,
    ],
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
    const { dealId, importId } = parsed.data;

    const dealRef = db.collection('deals').doc(dealId);
    const importRef = dealRef.collection('imports').doc(importId);

    try {
      const [dealSnap, importSnap] = await Promise.all([dealRef.get(), importRef.get()]);
      if (!dealSnap.exists || !importSnap.exists) {
        logger.warn('importOrchestrator: missing deal or import', { dealId, importId });
        res.status(200).send({ ok: true, skipped: 'not_found' });
        return;
      }
      const deal = dealSnap.data() as Deal;
      const importRow = importSnap.data() as IntegrationImport;

      if (importRow.status !== 'queued' && importRow.status !== 'listing') {
        // Idempotent — don't re-run a completed or failed import.
        logger.info('importOrchestrator: skipping non-queued import', {
          importId,
          status: importRow.status,
        });
        res.status(200).send({ ok: true, skipped: importRow.status });
        return;
      }

      await importRef.update({ status: 'listing' });

      // Fetch token + adapter. If expired, mark import failed.
      let accessToken: string;
      try {
        accessToken = await getAccessToken(importRow.initiatedBy, importRow.provider);
      } catch (err) {
        const reason =
          err instanceof IntegrationExpiredError
            ? 'Integration expired; reconnect required.'
            : `Could not resolve credentials: ${String(err)}`;
        await failImport(dealRef, importRef, deal, reason);
        res.status(200).send({ ok: false, err: reason });
        return;
      }
      const adapter = makeAdapter(importRow.provider, accessToken);
      const cfg = getIngestConfig();

      await importRef.update({ status: 'dispatching' });

      let discovered = 0;
      let dispatched = 0;
      let perFileErrors = 0;

      for await (const file of adapter.walkSubtree(importRow.rootItemId)) {
        discovered++;

        // Periodically update the discovered count so UI can show progress
        // even during slow walks. Batch every 10 files to avoid write storms.
        if (discovered % 10 === 0) {
          await importRef.update({
            totalFilesDiscovered: discovered,
            totalFilesDispatched: dispatched,
          });
        }

        try {
          // Download file bytes.
          const payload = await adapter.downloadFile(file.id);

          if (payload.bytes.length > cfg.maxFileBytes) {
            logger.warn('Skipping file above size cap', {
              importId,
              name: file.name,
              bytes: payload.bytes.length,
            });
            perFileErrors++;
            continue;
          }
          if (!cfg.acceptedMimeTypes.includes(payload.mimeType as (typeof cfg.acceptedMimeTypes)[number])) {
            logger.info('Skipping file with unsupported MIME', {
              importId,
              name: file.name,
              mimeType: payload.mimeType,
            });
            perFileErrors++;
            continue;
          }

          // Hash + dedup.
          const sha256 = createHash('sha256').update(payload.bytes).digest('hex');
          const dup = await dealRef
            .collection('documents')
            .where('sha256', '==', sha256)
            .where('status', 'in', ['uploaded', 'ocr_in_progress', 'classifying', 'completed'])
            .limit(1)
            .get();

          if (!dup.empty) {
            const canonical = dup.docs[0];
            const skipRef = dealRef.collection('documents').doc();
            const skipDoc: DealDocument = {
              dealId,
              name: file.name,
              storagePath: '',
              sha256,
              mimeType: payload.mimeType,
              sizeBytes: payload.bytes.length,
              pages: 0,
              sourceChannel: providerToChannel(importRow.provider),
              status: 'skipped_duplicate',
              folderPath: file.folderPath,
              duplicateOf: canonical.id,
              uploadedBy: importRow.initiatedBy,
              createdAt: FieldValue.serverTimestamp(),
            };
            await skipRef.set(skipDoc);
            dispatched++;
            continue;
          }

          // Stage to GCS + create doc row + enqueue processDocument.
          const docRef = dealRef.collection('documents').doc();
          const documentId = docRef.id;
          const storagePath = `deals/${dealId}/uploads/${documentId}/${sanitizeFilename(file.name)}`;
          await getStorage()
            .bucket(cfg.storage.bucket)
            .file(storagePath)
            .save(payload.bytes, { contentType: payload.mimeType });

          const newDoc: DealDocument = {
            dealId,
            name: file.name,
            storagePath,
            sha256,
            mimeType: payload.mimeType,
            sizeBytes: payload.bytes.length,
            pages: 0,
            sourceChannel: providerToChannel(importRow.provider),
            status: 'uploaded',
            folderPath: file.folderPath,
            uploadedBy: importRow.initiatedBy,
            createdAt: FieldValue.serverTimestamp(),
            uploadedAt: FieldValue.serverTimestamp(),
          };
          await docRef.set(newDoc);

          await enqueueDocumentProcessing({ dealId, documentId });
          dispatched++;
        } catch (err) {
          perFileErrors++;
          logger.error('importOrchestrator: per-file error', {
            importId,
            name: file.name,
            err: String(err),
          });
        }
      }

      // Finalize import row + audit.
      const auditRef = dealRef.collection('auditLog').doc();
      const auditEvent: Omit<AuditEvent, 'id'> = {
        dealId,
        teamId: deal.teamId,
        actorId: importRow.initiatedBy,
        actorRole: 'partner',
        eventType: 'import_completed',
        targetType: 'import',
        targetId: importId,
        diff: { after: { discovered, dispatched, perFileErrors } },
        timestamp: FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      batch.update(importRef, {
        status: 'completed',
        totalFilesDiscovered: discovered,
        totalFilesDispatched: dispatched,
        completedAt: FieldValue.serverTimestamp(),
      });
      batch.set(auditRef, auditEvent);
      await batch.commit();

      logger.info('Import completed', { importId, discovered, dispatched, perFileErrors });
      res.status(200).send({ ok: true, discovered, dispatched, perFileErrors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('importOrchestrator top-level failure', { importId, err: message });
      try {
        const dealSnap = await dealRef.get();
        const deal = dealSnap.data() as Deal | undefined;
        if (deal) await failImport(dealRef, importRef, deal, message.slice(0, 500));
      } catch (writeErr) {
        logger.error('failImport write failed', { err: String(writeErr) });
      }
      res.status(200).send({ ok: false, err: message });
    }
  }
);

async function failImport(
  dealRef: FirebaseFirestore.DocumentReference,
  importRef: FirebaseFirestore.DocumentReference,
  deal: Deal,
  reason: string
): Promise<void> {
  const auditRef = dealRef.collection('auditLog').doc();
  const auditEvent: Omit<AuditEvent, 'id'> = {
    dealId: dealRef.id,
    teamId: deal.teamId,
    actorId: 'system',
    actorRole: 'system',
    eventType: 'import_failed',
    targetType: 'import',
    targetId: importRef.id,
    rationale: reason,
    timestamp: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.update(importRef, {
    status: 'failed',
    failureReason: reason,
    completedAt: FieldValue.serverTimestamp(),
  });
  batch.set(auditRef, auditEvent);
  await batch.commit();
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[\\/]/g, '_')
    .slice(0, 240);
}

function providerToChannel(
  p: IntegrationImport['provider']
): DealDocument['sourceChannel'] {
  switch (p) {
    case 'gdrive':
      return 'gdrive';
    case 'sharepoint':
      return 'sharepoint';
    case 'dropbox':
      return 'dropbox';
    case 'intralinks':
      return 'intralinks';
    case 'datasite':
      return 'datasite';
    case 'firmex':
      return 'firmex';
  }
}
