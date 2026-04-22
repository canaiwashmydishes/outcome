import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import type {
  AuditEvent,
  RemoveMemberRequest,
  RemoveMemberResponse,
  TeamMember,
} from '@outcome99/shared';

/**
 * POST /removeMember
 *
 * Removes an active member from a team by deleting their membership doc.
 * The user still exists globally and keeps access to any other teams they
 * belong to.
 *
 * Access: partners only.
 *
 * Guardrails:
 *   - Cannot remove the last active partner (same logic as changeMemberRole).
 *   - A partner removing themselves triggers the same guard.
 */

const RequestSchema = z.object({
  teamId: z.string().min(1).max(128),
  memberUid: z.string().min(1).max(128),
});

export const removeMember = onCall<RemoveMemberRequest, Promise<RemoveMemberResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { teamId, memberUid } = parsed.data;

    const caller = await requireTeamRole(teamId, uid, ['partner']);

    const memberRef = db.collection('teams').doc(teamId).collection('members').doc(memberUid);
    const snap = await memberRef.get();
    if (!snap.exists) {
      // Idempotent.
      return { ok: true };
    }
    const existing = snap.data() as TeamMember;

    // If removing a partner, enforce the last-partner guard.
    if (existing.role === 'partner') {
      const partnersSnap = await db
        .collection('teams')
        .doc(teamId)
        .collection('members')
        .where('role', '==', 'partner')
        .where('status', '==', 'active')
        .get();
      if (partnersSnap.size <= 1) {
        throw httpErr.failedPrecondition(
          'Cannot remove the last partner. Promote another member to partner first.'
        );
      }
    }

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: caller.role,
      eventType: 'member_removed',
      targetType: 'member',
      targetId: memberUid,
      diff: { before: { role: existing.role, status: existing.status } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.delete(memberRef);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Member removed', { teamId, memberUid, by: uid });
    return { ok: true };
  }
);
