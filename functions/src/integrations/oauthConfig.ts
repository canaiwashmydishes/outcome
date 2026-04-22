import type { IntegrationProvider } from '@outcome99/shared';

/**
 * OAuth configuration per provider.
 *
 * All three cloud-storage providers (Google, Microsoft, Dropbox) use
 * OAuth 2.0 authorization code flow with refresh tokens. The shapes are
 * similar enough to share scaffolding but the endpoints and scope strings
 * are provider-specific.
 *
 * The redirect URI is the deployed `oauthCallback` HTTP function. It must
 * be registered verbatim with each provider's developer console.
 */

export interface ProviderOauthConfig {
  /** Display name shown in the UI. */
  displayName: string;
  /** Category — cloud_storage or vdr. */
  category: 'cloud_storage' | 'vdr';
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Space-separated scopes to request. */
  scopes: string;
  /** Whether the provider issues refresh tokens by default. */
  issuesRefreshToken: boolean;
  /** Extra query params to append to the authorization URL. */
  extraAuthParams?: Record<string, string>;
}

/**
 * Build the redirect URI the client registers with each provider.
 * Stays consistent across all providers — only the `provider` path param
 * changes at callback time (we encode it in the `state` parameter rather
 * than the URL to simplify redirect-URI registration with each provider).
 */
export function getOauthRedirectUri(): string {
  const url = process.env.OAUTH_CALLBACK_URL;
  if (!url) {
    // Keep the failure loud so deploys catch missing config.
    throw new Error(
      'OAUTH_CALLBACK_URL env var not set. ' +
        'Set to the deployed oauthCallback HTTP function URL.'
    );
  }
  return url;
}

export const PROVIDER_OAUTH_CONFIG: Partial<Record<IntegrationProvider, ProviderOauthConfig>> = {
  gdrive: {
    displayName: 'Google Drive',
    category: 'cloud_storage',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    // Read-only scope for files and metadata. We don't need write access.
    scopes: 'https://www.googleapis.com/auth/drive.readonly',
    issuesRefreshToken: true,
    extraAuthParams: {
      access_type: 'offline', // issue refresh token
      prompt: 'consent', // force refresh token even on re-consent
    },
  },
  sharepoint: {
    displayName: 'SharePoint',
    category: 'cloud_storage',
    // The v2 common endpoint works for most tenants; Enterprise deployments
    // may swap in a tenant-specific endpoint in Build G.
    authorizationEndpoint:
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes:
      'offline_access https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Sites.Read.All',
    issuesRefreshToken: true,
    extraAuthParams: {
      response_mode: 'query',
    },
  },
  dropbox: {
    displayName: 'Dropbox',
    category: 'cloud_storage',
    authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
    tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.metadata.read files.content.read',
    issuesRefreshToken: true,
    extraAuthParams: {
      token_access_type: 'offline',
    },
  },
  // VDR providers are placeholders in B2 — they surface in the UI so customers
  // can request access, but connectProvider short-circuits to the VDR access
  // request flow rather than starting an OAuth dance.
  intralinks: {
    displayName: 'Intralinks',
    category: 'vdr',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scopes: '',
    issuesRefreshToken: false,
  },
  datasite: {
    displayName: 'Datasite',
    category: 'vdr',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scopes: '',
    issuesRefreshToken: false,
  },
  firmex: {
    displayName: 'Firmex',
    category: 'vdr',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    scopes: '',
    issuesRefreshToken: false,
  },
};

export function getProviderConfig(provider: IntegrationProvider): ProviderOauthConfig {
  const cfg = PROVIDER_OAUTH_CONFIG[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  return cfg;
}
