import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import {
  SUBSCRIPTIONS,
  type AuditEvent,
  type CreateTeamRequest,
  type CreateTeamResponse,
  type Subscription,
  type Team,
  type TeamMember,
} from '@outcome99/shared';

/**
 * POST /createTeam
 *
 * Creates a new team. Caller becomes the team's owner and a partner-role
 * member. A trialing Starter subscription is attached to the team — the
 * same default a user gets on first signup for their personal team.
 *
 * No quota or rate limit on team creation in Build A. Abuse prevention
 * (e.g. limiting teams-per-user) can layer in via a simple counter on
 * `users/{uid}` in a later build if needed.
 */

const RequestSchema = z.object({
  name: z.string().min(1).max(100),
  billingEmail: z.string().email().max(200),
});

export const createTeam = onCall<CreateTeamRequest, Promise<CreateTeamResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }

    const teamRef = db.collection('teams').doc();
    const teamId = teamRef.id;
    const memberRef = teamRef.collection('members').doc(uid);
    const subRef = db.collection('subscriptions').doc();
    const auditRef = db.collection('teamAuditLog').doc();

    const anniversaryDate = new Date();
    anniversaryDate.setUTCFullYear(anniversaryDate.getUTCFullYear() + 1);

    const team: Team = {
      name: parsed.data.name,
      billingEmail: parsed.data.billingEmail,
      ownerId: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const member: TeamMember = {
      uid,
      role: 'partner',
      invitedBy: uid,
      invitedAt: FieldValue.serverTimestamp(),
      joinedAt: FieldValue.serverTimestamp(),
      status: 'active',
    };

    const starter = SUBSCRIPTIONS.starter;
    const subscription: Subscription = {
      teamId,
      tier: 'starter',
      dealsIncluded: starter.dealsPerYear,
      dealsUsedThisYear: 0,
      seatsMax: starter.seatsMax,
      anniversaryDate: anniversaryDate.getTime(),
      status: 'trialing',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId,
      actorId: uid,
      actorRole: 'partner',
      eventType: 'team_created',
      targetType: 'team',
      targetId: teamId,
      diff: { after: { name: parsed.data.name } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(teamRef, team);
    batch.set(memberRef, member);
    batch.set(subRef, subscription);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Team created', { teamId, uid, name: parsed.data.name });
    return { ok: true, teamId };
  }
);
