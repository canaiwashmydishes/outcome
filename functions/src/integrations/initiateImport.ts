import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import { enqueueImportOrchestrator } from '../ingest/cloudTasks.js';
import type {
  AuditEvent,
  Deal,
  InitiateImportRequest,
  InitiateImportResponse,
  IntegrationImport,
} from '@outcome99/shared';

/**
 * POST /initiateImport
 *
 * Kicks off a subtree import from a connected provider.
 *
 * Flow:
 *   1. Verify caller is a partner/associate on the deal's team.
 *   2. Create deals/{dealId}/imports/{importId} row with status='queued'.
 *   3. Enqueue a single orchestrator task that will walk the provider and
 *      dispatch per-doc ingest work.
 *   4. Write an import_initiated audit event.
 *
 * The orchestrator task does the actual provider walk + per-doc dispatch.
 * This callable just enqueues and returns; the UI subscribes to the import
 * row for progress.
 */

const RequestSchema = z.object({
  dealId: z.string().min(1).max(128),
  provider: z.enum(['gdrive', 'sharepoint', 'dropbox', 'intralinks', 'datasite', 'firmex']),
  rootItemId: z.string().min(1).max(2000),
  rootItemName: z.string().min(1).max(500),
});

export const initiateImport = onCall<
  InitiateImportRequest,
  Promise<InitiateImportResponse>
>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { dealId, provider, rootItemId, rootItemName } = parsed.data;

    // Load deal + enforce role.
    const dealRef = db.collection('deals').doc(dealId);
    const dealSnap = await dealRef.get();
    if (!dealSnap.exists) throw httpErr.notFound('Deal not found.');
    const deal = dealSnap.data() as Deal;
    const member = await requireTeamRole(deal.teamId, uid, ['partner', 'associate']);

    // Create the import row.
    const importRef = dealRef.collection('imports').doc();
    const importId = importRef.id;
    const importRow: IntegrationImport = {
      dealId,
      provider,
      initiatedBy: uid,
      rootItemId,
      rootItemName,
      status: 'queued',
      totalFilesDiscovered: 0,
      totalFilesDispatched: 0,
      startedAt: FieldValue.serverTimestamp(),
    };

    // Also move deal ingestion to in_progress if still not_started.
    const dealPatch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (deal.phaseStatus.ingestion === 'not_started') {
      dealPatch['phaseStatus.ingestion'] = 'in_progress';
    }

    const auditRef = dealRef.collection('auditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      dealId,
      teamId: deal.teamId,
      actorId: uid,
      actorRole: member.role,
      eventType: 'import_initiated',
      targetType: 'import',
      targetId: importId,
      diff: { after: { provider, rootItemName } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(importRef, importRow);
    batch.update(dealRef, dealPatch);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    // Enqueue orchestrator. If this throws, the import is stuck at 'queued'
    // until a support retry — same tradeoff we made with processDocument.
    await enqueueImportOrchestrator({ dealId, importId });

    logger.info('Import initiated', { dealId, importId, provider });
    return { ok: true, importId };
  }
);
