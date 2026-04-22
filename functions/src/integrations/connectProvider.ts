import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { randomBytes, createHmac } from 'node:crypto';
import { httpErr } from '../lib/errors.js';
import { getOauthRedirectUri, getProviderConfig } from './oauthConfig.js';
import { readOauthCredentials } from './lib/tokens.js';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  MS_OAUTH_CLIENT_ID,
  MS_OAUTH_CLIENT_SECRET,
  DROPBOX_OAUTH_CLIENT_ID,
  DROPBOX_OAUTH_CLIENT_SECRET,
} from '../lib/secrets.js';
import type {
  ConnectProviderRequest,
  ConnectProviderResponse,
  IntegrationProvider,
} from '@outcome99/shared';

/**
 * POST /connectProvider
 *
 * Builds an OAuth 2.0 authorization URL for the requested provider and
 * returns it to the client, which redirects the user there.
 *
 * Security: the `state` parameter is an HMAC-signed payload carrying the
 * uid, provider, and a nonce. The oauthCallback HTTP function verifies
 * the signature before acting on the callback, preventing a malicious
 * site from crafting a callback URL.
 *
 * VDR providers (intralinks, datasite, firmex) don't have OAuth flows in
 * Build B2 — the client calls requestVdrAccess instead. connectProvider
 * rejects them with a clear error.
 */

const RequestSchema = z.object({
  provider: z.enum([
    'gdrive',
    'sharepoint',
    'dropbox',
    'intralinks',
    'datasite',
    'firmex',
  ]),
  returnTo: z.string().max(500).optional(),
});

/** 64-byte random for state nonces. */
function nonce(): string {
  return randomBytes(32).toString('hex');
}

/** Read OAUTH_STATE_SECRET from env — set at deploy. */
function getStateSecret(): string {
  const s = process.env.OAUTH_STATE_SECRET;
  if (!s || s.length < 32) {
    throw httpErr.failedPrecondition(
      'OAUTH_STATE_SECRET env var not set or too short (min 32 chars).'
    );
  }
  return s;
}

/** HMAC-sign a state payload — returned to the client, round-tripped through the provider. */
export function signState(payload: {
  uid: string;
  provider: IntegrationProvider;
  nonce: string;
  returnTo?: string;
}): string {
  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = createHmac('sha256', getStateSecret()).update(base64).digest('base64url');
  return `${base64}.${sig}`;
}

export function verifyState(state: string):
  | { uid: string; provider: IntegrationProvider; nonce: string; returnTo?: string }
  | null {
  const [base64, sig] = state.split('.');
  if (!base64 || !sig) return null;
  const expected = createHmac('sha256', getStateSecret()).update(base64).digest('base64url');
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(base64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export const connectProvider = onCall<
  ConnectProviderRequest,
  Promise<ConnectProviderResponse>
>(
  {
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET,
      MS_OAUTH_CLIENT_ID,
      MS_OAUTH_CLIENT_SECRET,
      DROPBOX_OAUTH_CLIENT_ID,
      DROPBOX_OAUTH_CLIENT_SECRET,
    ],
  },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw httpErr.unauthenticated();

    const parsed = RequestSchema.safeParse(req.data);
    if (!parsed.success) {
      throw httpErr.invalidArg(parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { provider, returnTo } = parsed.data;

    const cfg = getProviderConfig(provider);
    if (cfg.category === 'vdr') {
      throw httpErr.failedPrecondition(
        `${cfg.displayName} access is not yet available. Please request access instead.`
      );
    }

    // Ensure OAuth credentials are configured before returning a URL the
    // callback will fail on.
    const { clientId } = readOauthCredentials(provider);

    const state = signState({ uid, provider, nonce: nonce(), returnTo });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getOauthRedirectUri(),
      response_type: 'code',
      scope: cfg.scopes,
      state,
      ...(cfg.extraAuthParams ?? {}),
    });

    const authorizationUrl = `${cfg.authorizationEndpoint}?${params.toString()}`;
    logger.info('Built OAuth authorization URL', { uid, provider });
    return { ok: true, authorizationUrl, state };
  }
);
