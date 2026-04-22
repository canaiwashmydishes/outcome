import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import {
  SUBSCRIPTIONS,
  type UserProfile,
  type Team,
  type TeamMember,
  type Subscription,
  type AuditEvent,
} from '@outcome99/shared';

/**
 * Sign-up hook. Enforce domain restrictions here (Enterprise SSO, etc.)
 * when Build H lands. No-op for Build 0.
 */
export const beforeCreate = beforeUserCreated((event) => {
  const email = event.data?.email;
  if (!email) {
    logger.warn('Sign-up attempt without email', { uid: event.data?.uid });
    return;
  }
  logger.info('User sign-up', { email, provider: event.data?.providerData?.[0]?.providerId });
});

/**
 * Callable `ensureUserProfile`
 *
 * Idempotent. On first call it creates:
 *   - users/{uid} with a pointer to their primary team
 *   - teams/{teamId} — their personal team, owned by them
 *   - teams/{teamId}/members/{uid} — a 'partner' role entry
 *   - subscriptions/{subId} — a free Starter subscription that allows
 *     the user to create up to 3 deals. Billing integration in Build H
 *     upgrades this to a paid Stripe subscription.
 *   - teamAuditLog/{eventId} — member_invited (self) entry
 *
 * All writes happen in a single batch to keep the user's post-signup state
 * consistent even on partial failure.
 */
export const ensureUserProfile = onCall({ cors: true }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw httpErr.unauthenticated();

  const email = req.auth?.token.email ?? '';
  const displayName = req.auth?.token.name ?? '';
  const photoURL = (req.auth?.token.picture as string | undefined) ?? '';

  const userRef = db.collection('users').doc(uid);
  const existing = await userRef.get();
  if (existing.exists) {
    return { ok: true, created: false, profile: existing.data() };
  }

  // Create team first — we need its id to reference from the user profile.
  const teamRef = db.collection('teams').doc();
  const teamId = teamRef.id;
  const subRef = db.collection('subscriptions').doc();
  const memberRef = teamRef.collection('members').doc(uid);
  const auditRef = db.collection('teamAuditLog').doc();

  const now = Date.now();
  const anniversaryDate = new Date();
  anniversaryDate.setUTCFullYear(anniversaryDate.getUTCFullYear() + 1);

  const team: Team = {
    name: displayName ? `${displayName}'s workspace` : 'Personal workspace',
    billingEmail: email,
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

  const profile: UserProfile = {
    uid,
    email,
    displayName,
    photoURL,
    primaryTeamId: teamId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const auditEvent: Omit<AuditEvent, 'id'> = {
    teamId,
    actorId: uid,
    actorRole: 'partner',
    eventType: 'member_invited',
    targetType: 'member',
    targetId: uid,
    timestamp: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(userRef, profile);
  batch.set(teamRef, team);
  batch.set(memberRef, member);
  batch.set(subRef, subscription);
  batch.set(auditRef, auditEvent);
  await batch.commit();

  logger.info('Seeded user + team + starter subscription', { uid, teamId });
  return {
    ok: true,
    created: true,
    profile: { ...profile, createdAt: now, updatedAt: now },
    teamId,
  };
});
