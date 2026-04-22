import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { consumeDealQuota } from '../lib/entitlements.js';
import { requireTeamRole } from '../lib/teams.js';
import {
  type Deal,
  type UserProfile,
  type CreateDealRequest,
  type CreateDealResponse,
  type AuditEvent,
  type PhaseName,
  type PhaseStatus,
  QuotaExceededError,
} from '@outcome99/shared';

/**
 * POST /createDeal
 *
 * Creates a deal workspace scoped to a team.
 *
 * Access:
 *   - Caller must be an active partner or associate on the target team.
 *   - If no teamId is supplied, falls back to the caller's primaryTeamId.
 *
 * Side effects:
 *   - Atomically decrements the team's dealsUsedThisYear.
 *   - Writes `deals/{dealId}` with all seven phases at 'not_started'.
 *   - Writes a `deal_created` audit event.
 */

const MetaSchema = z.object({
  name: z.string().min(1).max(200),
  targetCompany: z.string().min(1).max(200),
  sector: z.string().min(1).max(100),
  sizeUSD: z.number().nullable(),
  structure: z.enum([
    'asset_purchase',
    'stock_purchase',
    'merger',
    'carve_out',
    'recapitalization',
    'minority_investment',
    'other',
  ]),
  geography: z.string().min(1).max(100),
  expectedCloseDate: z.string().optional(),
  riskAppetiteNotes: z.string().max(2000).optional(),
});

const RequestSchema = z.object({
  meta: MetaSchema,
  teamId: z.string().min(1).max(128).optional(),
});

const PHASE_NAMES: PhaseName[] = [
  'ingestion',
  'research',
  'extraction',
  'detection',
  'followup',
  'scenario',
  'synthesis_export',
];

export const createDeal = onCall<CreateDealRequest, Promise<CreateDealResponse>>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }

    // Resolve target team: explicit param wins, else user's primary team.
    let teamId = parsed.data.teamId;
    if (!teamId) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) throw httpErr.notFound('User profile missing.');
      const user = userSnap.data() as UserProfile;
      teamId = user.primaryTeamId;
    }

    // Enforce role — only partners and associates can create deals.
    const member = await requireTeamRole(teamId, uid, ['partner', 'associate']);

    // Atomically consume the deal quota. Throws QuotaExceededError if out.
    try {
      await consumeDealQuota(teamId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        throw httpErr.resourceExhausted(err.message);
      }
      throw err;
    }

    // Build and write the deal + audit event atomically.
    const dealRef = db.collection('deals').doc();
    const dealId = dealRef.id;
    const auditRef = dealRef.collection('auditLog').doc();

    const phaseStatus: Record<PhaseName, PhaseStatus> = {} as Record<PhaseName, PhaseStatus>;
    for (const p of PHASE_NAMES) phaseStatus[p] = 'not_started';

    const deal: Deal = {
      teamId,
      createdBy: uid,
      meta: parsed.data.meta,
      phaseStatus,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const auditEvent: Omit<AuditEvent, 'id'> = {
      dealId,
      teamId,
      actorId: uid,
      actorRole: member.role,
      eventType: 'deal_created',
      targetType: 'deal',
      targetId: dealId,
      diff: { after: { name: parsed.data.meta.name, targetCompany: parsed.data.meta.targetCompany } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(dealRef, deal);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('Deal created', { dealId, teamId, uid, role: member.role });
    return { ok: true, dealId };
  }
);
