import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  AuditEvent,
  Invitation,
  TeamMember,
} from '@outcome99/shared';

/**
 * POST /acceptInvite
 *
 * Claims a pending invitation, turning it into an active team membership.
 *
 * Access: any signed-in user whose auth email matches the invitation email.
 *
 * Flow:
 *   1. Look up the invitation by id via a collection-group query (invitation
 *      subcollections live under each team; the id is globally unique).
 *   2. Verify pending, not expired, and email matches the caller's auth email.
 *   3. If the caller is already an active member of the team, fail-safe exit.
 *   4. Create teams/{teamId}/members/{uid} with role from invitation,
 *      mark invitation as accepted, write member_invite_accepted audit event.
 *      All in one batch.
 */

const RequestSchema = z.object({
  invitationId: z.string().min(1).max(128),
});

export const acceptInvite = onCall<AcceptInviteRequest, Promise<AcceptInviteResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    const callerEmail = (req.auth?.token.email as string | undefined)?.toLowerCase();
    if (!uid) throw httpErr.unauthenticated();
    if (!callerEmail) throw httpErr.failedPrecondition('Caller email unavailable.');

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const invitationId = parsed.data.invitationId;

    // Find the invitation via a collection-group query. The security rule on
    // invitations permits read when the caller's email matches, so this is
    // safe and efficient (indexed). We scan pending invites for the caller
    // and match the id in-process — not expensive since a user has at most
    // a handful of pending invites at once.
    const pending = await db
      .collectionGroup('invitations')
      .where('email', '==', callerEmail)
      .where('status', '==', 'pending')
      .get();
    const match = pending.docs.find((d) => d.id === invitationId);
    if (!match) {
      throw httpErr.notFound('Invitation not found or not addressed to you.');
    }

    const invitation = match.data() as Invitation;
    const teamId = invitation.teamId;

    if (invitation.expiresAt < Date.now()) {
      // Mark expired while we're here, but don't fail silently for UX.
      await match.ref.update({ status: 'expired' });
      throw httpErr.failedPrecondition('This invitation has expired.');
    }

    // If user is already an active member, just succeed idempotently.
    const memberRef = db.collection('teams').doc(teamId).collection('members').doc(uid);
    const existing = await memberRef.get();
    if (existing.exists && (existing.data() as TeamMember).status === 'active') {
      await match.ref.update({
        status: 'accepted',
        acceptedBy: uid,
        acceptedAt: FieldValue.serverTimestamp(),
      });
      logger.info('Invitation accepted but member already active', { teamId, uid, invitationId });
      return { ok: true, teamId };
    }

    const member: TeamMember = {
      uid,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.invitedAt,
      joinedAt: FieldValue.serverTimestamp(),
      status: 'active',
    };

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: invitation.role,
      eventType: 'member_invite_accepted',
      targetType: 'member',
      targetId: uid,
      diff: { after: { role: invitation.role, email: callerEmail } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(memberRef, member);
    batch.update(match.ref, {
      status: 'accepted',
      acceptedBy: uid,
      acceptedAt: FieldValue.serverTimestamp(),
    });
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Invitation accepted', { teamId, uid, invitationId, role: invitation.role });
    return { ok: true, teamId };
  }
);
