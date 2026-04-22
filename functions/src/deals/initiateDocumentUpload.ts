import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import { getIngestConfig } from '../lib/ingestConfig.js';
import type {
  DealDocument,
  Deal,
  InitiateDocumentUploadRequest,
  InitiateDocumentUploadResponse,
} from '@outcome99/shared';

/**
 * POST /initiateDocumentUpload
 *
 * Step 1 of the two-step upload dance:
 *   1. Client sends name + size + mimeType + sha256.
 *   2. Server checks dedup → if hash matches an existing doc on the deal,
 *      respond with action=duplicate and skip the upload entirely.
 *   3. Otherwise, pre-create the DealDocument row in `queued` state and
 *      return a v4 signed URL. Client uploads directly to GCS.
 *   4. Client calls finalizeDocumentUpload to trigger the Cloud Task.
 *
 * Access: partners or associates on the deal's team.
 *
 * The signed URL is valid for 15 minutes — a client dropping 50 files
 * gets 50 URLs in the same call cycle.
 */

const RequestSchema = z.object({
  dealId: z.string().min(1).max(128),
  name: z.string().min(1).max(500),
  folderPath: z.string().max(500).optional(),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1).max(200),
  sha256: z.string().length(64).regex(/^[a-f0-9]+$/),
});

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (!_storage) _storage = new Storage();
  return _storage;
}

export const initiateDocumentUpload = onCall<
  InitiateDocumentUploadRequest,
  Promise<InitiateDocumentUploadResponse>
>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const input = parsed.data;

    // Resolve deal + enforce role.
    const dealSnap = await db.collection('deals').doc(input.dealId).get();
    if (!dealSnap.exists) throw httpErr.notFound('Deal not found.');
    const deal = dealSnap.data() as Deal;
    await requireTeamRole(deal.teamId, uid, ['partner', 'associate']);

    // Enforce file size cap.
    const cfg = getIngestConfig();
    if (input.sizeBytes > cfg.maxFileBytes) {
      throw httpErr.invalidArg(
        `File exceeds ${(cfg.maxFileBytes / 1024 / 1024).toFixed(0)} MB upload limit.`
      );
    }
    if (!cfg.acceptedMimeTypes.includes(input.mimeType as (typeof cfg.acceptedMimeTypes)[number])) {
      throw httpErr.invalidArg(`File type ${input.mimeType} is not accepted for ingestion.`);
    }

    // Dedup check — does this hash already exist on the deal?
    const dupSnap = await db
      .collection('deals')
      .doc(input.dealId)
      .collection('documents')
      .where('sha256', '==', input.sha256)
      .where('status', 'in', ['uploaded', 'ocr_in_progress', 'classifying', 'completed'])
      .limit(1)
      .get();

    if (!dupSnap.empty) {
      const canonical = dupSnap.docs[0];
      // Record the skip as its own row so the UI can show "N duplicates"
      // without the duplicate invisibly adding to the deal's doc count.
      const skipRef = db
        .collection('deals')
        .doc(input.dealId)
        .collection('documents')
        .doc();
      const skipDoc: DealDocument = {
        dealId: input.dealId,
        name: input.name,
        storagePath: '',
        sha256: input.sha256,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        pages: 0,
        sourceChannel: 'manual_upload',
        status: 'skipped_duplicate',
        folderPath: input.folderPath,
        duplicateOf: canonical.id,
        uploadedBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      };
      await skipRef.set(skipDoc);
      logger.info('Upload deduped against existing doc', {
        dealId: input.dealId,
        canonicalId: canonical.id,
        incomingName: input.name,
      });
      return {
        ok: true,
        action: 'duplicate',
        documentId: skipRef.id,
        canonicalDocumentId: canonical.id,
      };
    }

    // Pre-create the doc row and mint a v4 signed URL.
    const docRef = db
      .collection('deals')
      .doc(input.dealId)
      .collection('documents')
      .doc();
    const documentId = docRef.id;
    const storagePath = `deals/${input.dealId}/uploads/${documentId}/${sanitizeFilename(input.name)}`;

    const newDoc: DealDocument = {
      dealId: input.dealId,
      name: input.name,
      storagePath,
      sha256: input.sha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      pages: 0,
      sourceChannel: 'manual_upload',
      status: 'queued',
      folderPath: input.folderPath,
      uploadedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    await docRef.set(newDoc);

    const [uploadUrl] = await getStorage()
      .bucket(cfg.storage.bucket)
      .file(storagePath)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 min
        contentType: input.mimeType,
      });

    return {
      ok: true,
      action: 'upload',
      documentId,
      uploadUrl,
      uploadHeaders: { 'Content-Type': input.mimeType },
    };
  }
);

/**
 * Strip Windows path separators and control chars from a user-supplied
 * filename before using it as a GCS object path segment. Does NOT attempt
 * to collapse unicode or rewrite the extension — we want to preserve
 * the user's original name in the UI.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[\\/]/g, '_')
    .slice(0, 240);
}
