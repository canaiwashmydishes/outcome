import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import { getIngestConfig } from '../lib/ingestConfig.js';
import { enqueueDocumentProcessing } from '../ingest/cloudTasks.js';
import { ANTHROPIC_API_KEY } from '../lib/secrets.js';
import type {
  AuditEvent,
  DealDocument,
  Deal,
  FinalizeDocumentUploadRequest,
  FinalizeDocumentUploadResponse,
} from '@outcome99/shared';

/**
 * POST /finalizeDocumentUpload
 *
 * Step 2 of the upload dance. Confirms the GCS object exists, marks the
 * DealDocument row as 'uploaded', enqueues a Cloud Task for per-document
 * processing, and writes a document_uploaded audit event.
 *
 * Also transitions the deal's `phaseStatus.ingestion` to 'in_progress'
 * on the first successful upload.
 *
 * Access: partners or associates on the deal's team.
 */

const RequestSchema = z.object({
  dealId: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
});

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export const finalizeDocumentUpload = onCall<
  FinalizeDocumentUploadRequest,
  Promise<FinalizeDocumentUploadResponse>
>(
  {
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 30,
    // Bind secrets the downstream processDocument worker needs — not read
    // by finalize itself, but declaring here means the deploy validates
    // the processDocument worker has them too.
    secrets: [ANTHROPIC_API_KEY],
  },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { dealId, documentId } = parsed.data;

    // Resolve deal + enforce role.
    const dealRef = db.collection('deals').doc(dealId);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) throw httpErr.notFound('Deal not found.');
    const deal = dealSnap.data() as Deal;
    const member = await requireTeamRole(deal.teamId, uid, ['partner', 'associate']);

    const docRef = dealRef.collection('documents').doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) throw httpErr.notFound('Document row not found.');
    const docData = docSnap.data() as DealDocument;

    if (docData.status !== 'queued') {
      // Idempotent — a client retrying finalize after a network blip should
      // not double-enqueue.
      logger.info('Finalize called on non-queued doc; no-op', {
        dealId,
        documentId,
        status: docData.status,
      });
      return { ok: true };
    }

    // Verify the object actually landed in GCS.
    const cfg = getIngestConfig();
    const [exists] = await getStorage()
      .bucket(cfg.storage.bucket)
      .file(docData.storagePath)
      .exists();
    if (!exists) {
      throw httpErr.failedPrecondition(
        'Upload not found in storage. Try uploading again.'
      );
    }

    // Transition doc → uploaded, deal ingestion → in_progress, write audit,
    // all atomically. Enqueue the Cloud Task after the commit so we don't
    // leave tasks pointing at half-written rows.
    const auditRef = dealRef.collection('auditLog').doc();
    const dealPatch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (deal.phaseStatus.ingestion === 'not_started') {
      dealPatch['phaseStatus.ingestion'] = 'in_progress';
    }

    const auditEvent: Omit<AuditEvent, 'id'> = {
      dealId,
      teamId: deal.teamId,
      actorId: uid,
      actorRole: member.role,
      eventType: 'document_uploaded',
      targetType: 'document',
      targetId: documentId,
      diff: { after: { name: docData.name, sizeBytes: docData.sizeBytes } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.update(docRef, {
      status: 'uploaded',
      uploadedAt: FieldValue.serverTimestamp(),
    });
    batch.update(dealRef, dealPatch);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    // Enqueue the work. If this throws, the doc is stuck at 'uploaded' and
    // a support retry is needed — preferable to writing half the state.
    await enqueueDocumentProcessing({ dealId, documentId });

    logger.info('Document finalized and enqueued', { dealId, documentId });
    return { ok: true };
  }
);
