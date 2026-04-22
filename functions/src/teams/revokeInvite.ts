import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import type {
  AuditEvent,
  Invitation,
  RevokeInviteRequest,
  RevokeInviteResponse,
} from '@outcome99/shared';

/**
 * POST /revokeInvite
 *
 * Marks a pending invitation as revoked. Idempotent — revoking an already
 * revoked or expired invite succeeds without error.
 *
 * Access: partners only on the owning team.
 */

const RequestSchema = z.object({
  teamId: z.string().min(1).max(128),
  invitationId: z.string().min(1).max(128),
});

export const revokeInvite = onCall<RevokeInviteRequest, Promise<RevokeInviteResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { teamId, invitationId } = parsed.data;

    const member = await requireTeamRole(teamId, uid, ['partner']);

    const inviteRef = db
      .collection('teams')
      .doc(teamId)
      .collection('invitations')
      .doc(invitationId);

    const snap = await inviteRef.get();
    if (!snap.exists) throw httpErr.notFound('Invitation not found.');

    const invitation = snap.data() as Invitation;
    if (invitation.status !== 'pending') {
      // Idempotent — invite already in terminal state.
      return { ok: true };
    }

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: member.role,
      eventType: 'member_invite_revoked',
      targetType: 'invitation',
      targetId: invitationId,
      diff: { before: { email: invitation.email, role: invitation.role } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.update(inviteRef, {
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
    });
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Invitation revoked', { teamId, invitationId, uid });
    return { ok: true };
  }
);
