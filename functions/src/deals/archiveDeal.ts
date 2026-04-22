import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import type {
  ArchiveDealRequest,
  ArchiveDealResponse,
  AuditEvent,
  Deal,
} from '@outcome99/shared';

/**
 * POST /archiveDeal
 *
 * Soft-hides a deal from default views. The deal remains in Firestore
 * with `archivedAt` set, preserving the audit trail and giving us a
 * restore path if needed.
 *
 * Policy: quota is NOT refunded on archive. Annual deal quotas are
 * commitments, not consumables.
 *
 * Access: partners only. Associates create deals but cannot archive them.
 */

const RequestSchema = z.object({
  dealId: z.string().min(1).max(128),
});

export const archiveDeal = onCall<ArchiveDealRequest, Promise<ArchiveDealResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }

    const dealRef = db.collection('deals').doc(parsed.data.dealId);
    const snap = await dealRef.get();
    if (!snap.exists) throw httpErr.notFound('Deal not found.');
    const deal = snap.data() as Deal;

    if (deal.archivedAt) {
      // Idempotent — already archived.
      return { ok: true };
    }

    const member = await requireTeamRole(deal.teamId, uid, ['partner']);

    const auditRef = dealRef.collection('auditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      dealId: parsed.data.dealId,
      teamId: deal.teamId,
      actorId: uid,
      actorRole: member.role,
      eventType: 'deal_archived',
      targetType: 'deal',
      targetId: parsed.data.dealId,
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.update(dealRef, {
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Deal archived', { dealId: parsed.data.dealId, teamId: deal.teamId, uid });
    return { ok: true };
  }
);
