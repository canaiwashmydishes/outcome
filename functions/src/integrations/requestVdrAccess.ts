import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import type {
  AuditEvent,
  RequestVdrAccessRequest,
  RequestVdrAccessResponse,
  UserProfile,
  VdrAccessRequest,
} from '@outcome99/shared';

/**
 * POST /requestVdrAccess
 *
 * Writes a row to `vdrAccessRequests` that the admin (you) will pick up.
 * In Build H the admin UI will list open requests and the provisioning
 * flow will flip them to 'contacted' / 'provisioned'.
 *
 * Why callable, not email: keeps everything in-system so we have a single
 * audit trail of customer interest by VDR. Helpful for prioritizing which
 * VDR partnership to close first in Build B2.5.
 */

const RequestSchema = z.object({
  provider: z.enum(['intralinks', 'datasite', 'firmex']),
  note: z.string().max(2000).optional(),
});

export const requestVdrAccess = onCall<
  RequestVdrAccessRequest,
  Promise<RequestVdrAccessResponse>
>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { provider, note } = parsed.data;

    // Resolve user's email + primary team for context.
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw httpErr.notFound('User profile missing.');
    const user = userSnap.data() as UserProfile;

    const requestRef = db.collection('vdrAccessRequests').doc();
    const request: VdrAccessRequest = {
      uid,
      email: user.email,
      teamId: user.primaryTeamId,
      provider,
      note,
      status: 'open',
      requestedAt: FieldValue.serverTimestamp(),
    };

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId: user.primaryTeamId,
      actorId: uid,
      actorRole: 'partner',
      eventType: 'vdr_access_requested',
      targetType: 'vdr_access_request',
      targetId: requestRef.id,
      diff: { after: { provider, note: note?.slice(0, 200) } },
      timestamp: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(requestRef, request);
    batch.set(auditRef, auditEvent);
    await batch.commit();

    logger.info('VDR access requested', { uid, provider, requestId: requestRef.id });
    return { ok: true };
  }
);
