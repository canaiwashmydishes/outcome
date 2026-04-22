import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { requireTeamRole } from '../lib/teams.js';
import { getActiveSubscription } from '../lib/entitlements.js';
import type {
  AuditEvent,
  InviteMemberRequest,
  InviteMemberResponse,
  Invitation,
  TeamMemberRole,
} from '@outcome99/shared';

/**
 * POST /inviteMember
 *
 * Creates a pending invitation to a team.
 *
 * Access: partners only.
 *
 * Seat quota:
 *   - Starter: capped at 5 active members + pending invites.
 *   - Professional: cap from subscription.seatsMax (null = unlimited fair use).
 *   - Enterprise: unlimited.
 *
 * Duplicate prevention:
 *   - If there's already a pending invite for (teamId, email), reuse it
 *     (idempotent — returns the existing invitationId).
 *   - If the email already belongs to an active member, return
 *     failed-precondition.
 *
 * Invitation expiry: 14 days. Expired invites are cleaned up by a
 * scheduled job (TODO Build H). For now, acceptInvite checks expiry.
 */

const ROLES: TeamMemberRole[] = [
  'partner',
  'associate',
  'external_counsel',
  'consultant',
  'observer',
];

const RequestSchema = z.object({
  teamId: z.string().min(1).max(128),
  email: z.string().email().toLowerCase().max(200),
  role: z.enum([
    'partner',
    'associate',
    'external_counsel',
    'consultant',
    'observer',
  ]),
});

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export const inviteMember = onCall<InviteMemberRequest, Promise<InviteMemberResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    const inviterEmail = req.auth?.token.email as string | undefined;
    if (!uid) throw httpErr.unauthenticated();
    if (!inviterEmail) throw httpErr.failedPrecondition('Inviter email unavailable.');

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { teamId, email, role } = parsed.data;

    // Access — only partners can invite.
    const inviter = await requireTeamRole(teamId, uid, ['partner']);

    // Block self-invite.
    if (email === inviterEmail.toLowerCase()) {
      throw httpErr.invalidArg('Cannot invite yourself.');
    }

    // Block invitation if that email is already an active member.
    const existingMembersByUid = await db
      .collection('teams')
      .doc(teamId)
      .collection('members')
      .get();
    // We don't index by email on members (uid is the doc id), so we check
    // against the users collection.
    const existingUsers = await db
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!existingUsers.empty) {
      const existingUid = existingUsers.docs[0].id;
      const memberDoc = existingMembersByUid.docs.find((d) => d.id === existingUid);
      if (memberDoc) {
        const m = memberDoc.data();
        if (m.status === 'active') {
          throw httpErr.failedPrecondition('That user is already an active member.');
        }
      }
    }

    // Reuse existing pending invite if present (idempotent).
    const invitationsRef = db.collection('teams').doc(teamId).collection('invitations');
    const existingInvites = await invitationsRef
      .where('email', '==', email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!existingInvites.empty) {
      const inviteId = existingInvites.docs[0].id;
      logger.info('Reused existing invitation', { teamId, email, inviteId });
      return {
        ok: true,
        invitationId: inviteId,
        inviteLink: buildInviteLink(teamId, inviteId),
      };
    }

    // Enforce seat quota.
    const sub = await getActiveSubscription(teamId);
    if (!sub) throw httpErr.failedPrecondition('No active subscription on this team.');
    if (sub.seatsMax !== null) {
      const activeMembers = existingMembersByUid.docs.filter(
        (d) => (d.data() as { status: string }).status === 'active'
      ).length;
      const pendingInvites = await invitationsRef
        .where('status', '==', 'pending')
        .get();
      const total = activeMembers + pendingInvites.size;
      if (total >= sub.seatsMax) {
        throw httpErr.resourceExhausted(
          `Seat quota reached (${total}/${sub.seatsMax}). Upgrade or revoke pending invites.`
        );
      }
    }

    // Create invitation + audit event.
    const inviteRef = invitationsRef.doc();
    const inviteId = inviteRef.id;
    const auditRef = db.collection('teamAuditLog').doc();

    const invitation: Invitation = {
      teamId,
      email,
      role: role as TeamMemberRole,
      invitedBy: uid,
      invitedByEmail: inviterEmail,
      invitedAt: FieldValue.serverTimestamp(),
      expiresAt: Date.now() + INVITATION_TTL_MS,
      status: 'pending',
    };

    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: inviter.role,
      eventType: 'member_invited',
      targetType: 'invitation',
      targetId: inviteId,
      diff: { after: { email, role } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(inviteRef, invitation);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Invitation created', { teamId, inviteId, email, role });
    return {
      ok: true,
      invitationId: inviteId,
      inviteLink: buildInviteLink(teamId, inviteId),
    };
  }
);

function buildInviteLink(teamId: string, invitationId: string): string {
  // The web app reads /invite/:invitationId and the accept flow resolves
  // teamId from the invitation document itself.
  return `/invite/${invitationId}?team=${teamId}`;
}
