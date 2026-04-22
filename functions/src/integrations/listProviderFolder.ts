import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { httpErr } from '../lib/errors.js';
import { getAccessToken, IntegrationExpiredError } from './lib/tokens.js';
import { makeAdapter } from './lib/factory.js';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  MS_OAUTH_CLIENT_ID,
  MS_OAUTH_CLIENT_SECRET,
  DROPBOX_OAUTH_CLIENT_ID,
  DROPBOX_OAUTH_CLIENT_SECRET,
} from '../lib/secrets.js';
import type {
  ListProviderFolderRequest,
  ListProviderFolderResponse,
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
  folderId: z.string().max(2000).optional(),
});

export const listProviderFolder = onCall<
  ListProviderFolderRequest,
  Promise<ListProviderFolderResponse>
>(
  {
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60,
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
    const { provider, folderId } = parsed.data;

    try {
      const token = await getAccessToken(uid, provider);
      const adapter = makeAdapter(provider, token);
      const result = await adapter.listFolder(folderId);
      return { ok: true, items: result.items, breadcrumb: result.breadcrumb };
    } catch (err) {
      if (err instanceof IntegrationExpiredError) {
        throw httpErr.failedPrecondition('Integration has expired. Reconnect required.');
      }
      throw err;
    }
  }
);
