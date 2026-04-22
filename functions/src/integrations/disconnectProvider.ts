import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { db } from '../lib/admin.js';
import { httpErr } from '../lib/errors.js';
import { clearConnection } from './lib/tokens.js';
import type {
  AuditEvent,
  DisconnectProviderRequest,
  DisconnectProviderResponse,
} from '@outcome99/shared';

const RequestSchema = z.object({
  provider: z.enum([
    'gdrive',
    'sharepoint',
    'dropbox',
    'intralinks',
    'datasite',
    'firmex',
  ]),
});

export const disconnectProvider = onCall<
  DisconnectProviderRequest,
  Promise<DisconnectProviderResponse>
>(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { provider } = parsed.data;

    await clearConnection(uid, provider);

    // Resolve user's primary team for audit scoping.
    let auditTeamId: string = uid;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      const teamId = (userSnap.data() as { primaryTeamId?: string } | undefined)?.primaryTeamId;
      if (teamId) auditTeamId = teamId;
    } catch {
      // Non-fatal — keep fallback.
    }

    const auditRef = db.collection('teamAuditLog').doc();
    const auditEvent: Omit<AuditEvent, 'id'> = {
      teamId: auditTeamId,
      actorId: uid,
      actorRole: 'partner',
      eventType: 'integration_disconnected',
      targetType: 'integration',
      targetId: provider,
      timestamp: FieldValue.serverTimestamp(),
    };
    await auditRef.set(auditEvent);

    logger.info('Integration disconnected', { uid, provider });
    return { ok: true };
  }
);
