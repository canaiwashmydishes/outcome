import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../lib/admin.js';
import { getOauthRedirectUri, getProviderConfig } from './oauthConfig.js';
import { readOauthCredentials, saveConnection } from './lib/tokens.js';
import { makeAdapter } from './lib/factory.js';
import { verifyState } from './connectProvider.js';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  MS_OAUTH_CLIENT_ID,
  MS_OAUTH_CLIENT_SECRET,
  DROPBOX_OAUTH_CLIENT_ID,
  DROPBOX_OAUTH_CLIENT_SECRET,
} from '../lib/secrets.js';
import type { AuditEvent } from '@outcome99/shared';

/**
 * GET /oauthCallback?code=...&state=...
 *
 * The provider redirects here after the user authorizes. We:
 *   1. Verify the HMAC signature on `state` to confirm the request originated
 *      from our connectProvider callable.
 *   2. Exchange the code for access + refresh tokens.
 *   3. Resolve the account label (email/display name) via the provider API.
 *   4. Persist via saveConnection.
 *   5. Write an integration_connected audit event.
 *   6. Redirect the user back to the `returnTo` URL encoded in state.
 *
 * Failure paths render a short HTML page with the error rather than a JSON
 * response, since users land here directly in their browser.
 */

export const oauthCallback = onRequest(
  {
    cors: false,
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
  async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const providerError = req.query.error as string | undefined;

    if (providerError) {
      renderError(res, `Provider returned error: ${providerError}`);
      return;
    }
    if (!code || !state) {
      renderError(res, 'Missing code or state parameter.');
      return;
    }

    const verified = verifyState(state);
    if (!verified) {
      renderError(res, 'State signature invalid. Please retry the connection.');
      return;
    }
    const { uid, provider, returnTo } = verified;

    const cfg = getProviderConfig(provider);
    if (!cfg.tokenEndpoint) {
      renderError(res, `Provider ${provider} is not configured for OAuth.`);
      return;
    }

    try {
      const { clientId, clientSecret } = readOauthCredentials(provider);
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getOauthRedirectUri(),
      });
      const tokenRes = await fetch(cfg.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        logger.error('oauth token exchange failed', {
          provider,
          status: tokenRes.status,
          body: body.slice(0, 400),
        });
        renderError(res, 'Token exchange failed. Please retry.');
        return;
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      // Best-effort account label resolution via the adapter.
      let accountLabel: string | undefined;
      try {
        const adapter = makeAdapter(provider, tokenJson.access_token);
        accountLabel = await adapter.resolveAccountLabel();
      } catch (err) {
        logger.warn('Could not resolve account label', { provider, err: String(err) });
      }

      await saveConnection({
        uid,
        provider,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        expiresInSec: tokenJson.expires_in,
        scopes: tokenJson.scope ? tokenJson.scope.split(/\s+/) : cfg.scopes.split(/\s+/),
        accountLabel,
      });

      // Audit — integrations are per-user, but the audit log is team-scoped
      // for rule enforcement. Resolve the user's primary team; if missing
      // (shouldn't happen outside cold-start races) fall back to uid so the
      // row still lands.
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
        eventType: 'integration_connected',
        targetType: 'integration',
        targetId: provider,
        diff: { after: { provider, accountLabel } },
        timestamp: FieldValue.serverTimestamp(),
      };
      await auditRef.set(auditEvent);

      logger.info('Integration connected', { uid, provider, accountLabel });

      const redirect = returnTo && isSafeReturnTo(returnTo) ? returnTo : '/integrations';
      res.redirect(302, redirect);
    } catch (err) {
      logger.error('oauthCallback failed', { err: String(err) });
      renderError(res, 'Unexpected error completing the connection.');
    }
  }
);

function renderError(res: { status: (code: number) => { send: (body: string) => void } }, message: string) {
  res.status(400).send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Connection failed</title>
<style>
 body{font-family:ui-monospace,monospace;padding:40px;max-width:640px;margin:auto;color:#111}
 h1{font-weight:400;font-size:18px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px}
 p{font-size:13px;line-height:1.6;color:#444}
 a{color:#000;font-weight:600}
</style></head>
<body>
<h1>Connection failed</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/integrations">Return to Outcome99</a></p>
</body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/**
 * Only allow same-origin path redirects to prevent open-redirect abuse.
 */
function isSafeReturnTo(returnTo: string): boolean {
  return returnTo.startsWith('/') && !returnTo.startsWith('//');
}
