import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import type {
  AuditEvent,
  ChangeMemberRoleRequest,
  ChangeMemberRoleResponse,
  TeamMember,
} from '@outcome99/shared';

/**
 * POST /changeMemberRole
 *
 * Changes an active member's role on a team.
 *
 * Access: partners only.
 *
 * Guardrail: a team must always have at least one active partner. Demoting
 * the last partner fails with failed-precondition so the team isn't left
 * without anyone who can manage it.
 */

const RequestSchema = z.object({
  teamId: z.string().min(1).max(128),
  memberUid: z.string().min(1).max(128),
  role: z.enum([
    'partner',
    'associate',
    'external_counsel',
    'consultant',
    'observer',
  ]),
});

export const changeMemberRole = onCall<
  ChangeMemberRoleRequest,
  Promise<ChangeMemberRoleResponse>
>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { teamId, memberUid, role } = parsed.data;

    const caller = await requireTeamRole(teamId, uid, ['partner']);

    const memberRef = db.collection('teams').doc(teamId).collection('members').doc(memberUid);
    const snap = await memberRef.get();
    if (!snap.exists) throw httpErr.notFound('Member not found.');

    const existing = snap.data() as TeamMember;
    if (existing.status !== 'active') {
      throw httpErr.failedPrecondition('Member is not active.');
    }
    if (existing.role === role) {
      // No-op. Idempotent.
      return { ok: true };
    }

    // Last-partner guard. If demoting a partner, confirm another active
    // partner exists on the team.
    if (existing.role === 'partner' && role !== 'partner') {
      const partnersSnap = await db
        .collection('teams')
        .doc(teamId)
        .collection('members')
        .where('role', '==', 'partner')
        .where('status', '==', 'active')
        .get();
      if (partnersSnap.size <= 1) {
        throw httpErr.failedPrecondition(
          'Cannot demote the last partner. Promote another member to partner first.'
        );
      }
    }

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: caller.role,
      eventType: 'member_role_changed',
      targetType: 'member',
      targetId: memberUid,
      diff: { before: { role: existing.role }, after: { role } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.update(memberRef, { role });
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Member role changed', {
      teamId,
      memberUid,
      from: existing.role,
      to: role,
      by: uid,
    });
    return { ok: true };
  }
);
