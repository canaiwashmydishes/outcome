# Outcome99 — Build B2 Handoff

**Build B2 — Cloud-Storage & VDR Integrations.** The platform now accepts data rooms from Google Drive, SharePoint (via Microsoft Graph), and Dropbox via OAuth. Users connect a provider once, browse their folder tree in a modal, and import a subtree with a single click. The orchestrator walks the provider, dedups by SHA-256, stages bytes to GCS, and hands each document to Build B's `processDocument` worker for OCR and classification — zero pipeline duplication. VDR providers (Intralinks, Datasite, Firmex) surface a "Request access" flow backed by the `vdrAccessRequests` collection; production connectors ship in B2.5 once partner agreements close.

96 source files, 146 KB zipped. +19 files vs. Build B across OAuth scaffolding, three real provider adapters, one VDR stub, seven callables, one HTTP worker, four web surfaces.

---

## Scope: what's real vs. what's a stub

This is worth being explicit about before testing.

**Production-quality, real API integrations:**
- **Google Drive** — OAuth 2.0, files.list with shared-drive support, Workspace file export (Docs/Sheets/Slides → Office), shortcut resolution, paginated folder walks. Backed by the official `/drive/v3` endpoints.
- **SharePoint / OneDrive** — Microsoft Graph v1.0, OAuth 2.0 via common tenant, personal OneDrive default in v1 (`/me/drive/...`), folder browsing, pagination via `@odata.nextLink`, content streaming through Graph redirect.
- **Dropbox** — OAuth 2.0 with offline tokens, `/2/files/list_folder` + `continue` cursor, `recursive: true` for subtree walks, content download via `content.dropboxapi.com`.

**Deliberate stubs (B2.5 replacement targets):**
- **Intralinks, Datasite, Firmex** — clicking "Connect" is intercepted by `connectProvider` which rejects VDR categories; users see a "Request access" button instead that writes to `vdrAccessRequests`. The `VdrStubAdapter` produces a mock 5-folder data-room tree (Legal/Financial/Tax/HR/Commercial) for UI smoke-testing. `downloadFile` throws with a clear "ships in B2.5" message, so if a test somehow reaches import against a VDR provider, individual docs fail cleanly.

---

## What shipped

### Schemas

`packages/shared/src/schemas.ts`:
- `IntegrationProvider` union (6 providers)
- `IntegrationCategory` (`cloud_storage` | `vdr`)
- `IntegrationStatus` lifecycle (`connected` | `disconnected` | `expired` | `error`)
- `Integration` interface at `users/{uid}/integrations/{provider}`
- `ProviderItem` (browsable folder/file for the UI modal)
- `IntegrationImport` + `IntegrationImportStatus` at `deals/{dealId}/imports/{importId}`
- `VdrAccessRequest` at `vdrAccessRequests/{id}`
- Audit events: `integration_connected`, `integration_disconnected`, `integration_token_refreshed`, `integration_error`, `import_initiated`, `import_completed`, `import_failed`, `vdr_access_requested`
- Callable request/response shapes for the 5 new callables

### Firestore

`firestore.rules`:
- `users/{uid}/integrations/{provider}` — read-self, server-only write
- `deals/{dealId}/imports/{importId}` — team-member read, server-only write
- `vdrAccessRequests/{id}` — server-only both directions

`firestore.indexes.json`:
- Collection index on `imports` by `(status, startedAt)` for per-deal import history

### Functions — integrations module

- `functions/src/lib/ingestConfig.ts` — extended with `importOrchestratorUrl`
- `functions/src/lib/secrets.ts` — six new OAuth secret declarations
- `functions/src/integrations/oauthConfig.ts` — per-provider auth endpoints, scopes, extra query params
- `functions/src/integrations/lib/tokens.ts` — Firestore token storage, transparent refresh with 60-sec expiry buffer, `IntegrationExpiredError` typed exception
- `functions/src/integrations/lib/adapters.ts` — `ProviderAdapter` interface (`listFolder`, `walkSubtree`, `downloadFile`, `resolveAccountLabel`)
- `functions/src/integrations/lib/factory.ts` — central adapter resolution
- `functions/src/integrations/providers/gdrive.ts` — Google Drive adapter (pagination, shared drives, Workspace export, shortcuts)
- `functions/src/integrations/providers/sharepoint.ts` — Microsoft Graph adapter
- `functions/src/integrations/providers/dropbox.ts` — Dropbox adapter with flat-path model
- `functions/src/integrations/providers/vdr_stub.ts` — reference mock for B2.5 replacement
- `functions/src/integrations/connectProvider.ts` — builds authorization URL with HMAC-signed state
- `functions/src/integrations/oauthCallback.ts` — HTTP endpoint for provider redirect; exchanges code, resolves account label, persists connection
- `functions/src/integrations/disconnectProvider.ts` — strips tokens, writes audit
- `functions/src/integrations/listProviderFolder.ts` — browses connected provider
- `functions/src/integrations/initiateImport.ts` — creates `imports` row, enqueues orchestrator task
- `functions/src/integrations/importOrchestrator.ts` — HTTP worker invoked by Cloud Tasks; walks subtree, dedups, stages to GCS, dispatches per-doc `processDocument` tasks
- `functions/src/integrations/requestVdrAccess.ts` — captures VDR access requests for the admin queue
- `functions/src/ingest/cloudTasks.ts` — added `enqueueImportOrchestrator` helper

### Web

- `apps/web/src/lib/functions.ts` — 5 new typed callable wrappers
- `apps/web/src/hooks/useIntegrations.ts` — per-user real-time integration state keyed by provider
- `apps/web/src/components/IntegrationsPanel.tsx` — six-card provider grid with connect/disconnect/import/request flows
- `apps/web/src/components/ProviderBrowser.tsx` — folder navigation modal with breadcrumb + "Import this folder" action
- `apps/web/src/components/ReconnectBanner.tsx` — sidebar banner surfaced when any provider is expired/error
- `apps/web/src/components/IngestionPanel.tsx` — mounts `IntegrationsPanel` above the dropzone
- `apps/web/src/components/DealWorkspace.tsx` — threads `user` + `integrations` into `IngestionPanel`
- `apps/web/src/App.tsx` — mounts `useIntegrations` hook, renders `ReconnectBanner` in sidebar, passes integrations through to `DealWorkspace`

---

## Design decisions worth flagging

**One orchestrator task, then per-doc child tasks.** Rather than fanning out 1,000 tasks from the `initiateImport` callable, we enqueue a single orchestrator task that paginates the provider and dispatches per-doc work as it walks. This keeps the callable fast, keeps provider API rate limits centralized, and means a large import doesn't overwhelm Cloud Tasks at enqueue time. The orchestrator task itself has a 30-min timeout — enough for a 5,000-doc data room.

**Reuse `processDocument` verbatim.** The orchestrator stages bytes to GCS at the same path structure browser uploads use (`deals/{dealId}/uploads/{documentId}/{filename}`), creates a `DealDocument` row in `uploaded` state, and enqueues `processDocument`. From that point forward, OCR + classification + status transitions are identical whether the bytes came from drag-and-drop or from a Drive API call. Zero pipeline duplication, one code path to maintain.

**Dedup happens at the orchestrator, not the adapter.** Adapters return file streams; the orchestrator computes the SHA-256 post-download. This means dedup works regardless of provider — a file copied from Drive to Dropbox and imported via both would still be recognized as the same content. Provider-native dedup IDs would have been faster but inconsistent.

**HMAC-signed OAuth state.** The `state` parameter is a base64-encoded JSON payload (`{uid, provider, nonce, returnTo}`) with an HMAC-SHA256 signature using a deployment-specific secret (`OAUTH_STATE_SECRET`). The callback verifies the signature before acting. This prevents a malicious site from crafting a callback URL that would connect an arbitrary provider to an arbitrary user.

**Firestore token storage, not Secret Manager.** Access + refresh tokens live in `users/{uid}/integrations/{provider}` in Firestore with rules allowing only the owning user to read. This is fine for v1. Build G migrates these to Google Secret Manager with per-user keys — the `tokens.ts` interface (getAccessToken / saveConnection / clearConnection) doesn't change at the call-site level, so the migration is localized.

**Transparent token refresh with a 60-second buffer.** `getAccessToken` checks `accessTokenExpiresAt - 60s > now` before using the cached token; otherwise it swaps in the refresh token. Callers (orchestrator, listProviderFolder) never see expiry logic. If refresh fails, the integration is marked `expired` and callers receive a typed `IntegrationExpiredError` that maps to HTTP `failed-precondition`, which the UI displays as the reconnect banner.

**VDR access requests, not VDR stubs that look real.** The UI clearly labels Intralinks/Datasite/Firmex as "VDR — production connector ships in B2.5", and "Connect" is replaced with "Request access". This is deliberately unambiguous — I don't want a customer to be surprised that a feature they think they connected is actually a mock. The `vdrAccessRequests` collection doubles as market signal: which VDR partnership should we prioritize closing?

---

## Deploy checklist

Build B2 reuses all Build B infrastructure. New setup is OAuth registration per provider plus two new env vars.

### Prerequisites

Build B must already be deployed and working. In particular: Document AI processor created, `ingest-documents` Cloud Tasks queue exists, `ANTHROPIC_API_KEY` secret set, Storage bucket configured.

### 1. Register OAuth apps

For each cloud-storage provider, register a new OAuth app and capture the client ID + secret.

**Google Drive** — Google Cloud Console → APIs & Services → Credentials:
- Create OAuth 2.0 Client ID (Web application)
- Authorized redirect URIs: add your deployed `oauthCallback` URL (e.g. `https://us-central1-outcome99.cloudfunctions.net/oauthCallback`)
- Scopes on the OAuth consent screen: `https://www.googleapis.com/auth/drive.readonly`

**SharePoint / OneDrive** — Azure Portal → App registrations:
- New registration → Web → redirect URI = your oauthCallback URL
- API permissions → Microsoft Graph → Delegated → `offline_access`, `Files.Read.All`, `Sites.Read.All`
- Grant admin consent (for multi-tenant usage)

**Dropbox** — Dropbox App Console:
- Create app → Scoped access → Full Dropbox (or App folder for testing)
- Permissions tab: `files.metadata.read`, `files.content.read`
- OAuth 2 → Redirect URIs → add your oauthCallback URL

### 2. First functions deploy (to obtain URLs)

```bash
npm install
npm run build:shared
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

Capture these URLs from the deploy output:
- `oauthCallback` — register this with each OAuth provider (step 1)
- `importOrchestrator` — needed for `IMPORT_ORCHESTRATOR_URL` env var

### 3. Set secrets

```bash
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
firebase functions:secrets:set MS_OAUTH_CLIENT_ID
firebase functions:secrets:set MS_OAUTH_CLIENT_SECRET
firebase functions:secrets:set DROPBOX_OAUTH_CLIENT_ID
firebase functions:secrets:set DROPBOX_OAUTH_CLIENT_SECRET
```

### 4. Set env vars

Append to `functions/.env`:

```
OAUTH_CALLBACK_URL=https://<region>-<project>.cloudfunctions.net/oauthCallback
OAUTH_STATE_SECRET=<output of: openssl rand -hex 32>
IMPORT_ORCHESTRATOR_URL=https://<region>-<project>.cloudfunctions.net/importOrchestrator
```

### 5. Grant Cloud Tasks invoker on importOrchestrator

```bash
gcloud run services add-iam-policy-binding importOrchestrator \
  --member="serviceAccount:YOUR_PROJECT@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1 \
  --project=YOUR_PROJECT
```

(Repeat for `processDocument` if you didn't grant it during Build B.)

### 6. Redeploy functions with the new env vars

```bash
firebase deploy --only functions
```

---

## Test walkthrough

### Happy path — Google Drive

1. Sign in to the deployed app
2. Open any deal, click Phase 1 — Data-Room Ingestion
3. At the top of the ingestion view, see six provider cards
4. Click **Connect** on Google Drive — redirected to Google's consent screen
5. Authorize the `outcome99` app — redirected back to `/integrations` (or returnTo if set)
6. The Google Drive card now shows "Connected" with your email address
7. Click **Import** — ProviderBrowser modal opens listing My Drive
8. Navigate into a folder containing a test data room
9. Click **Import this folder**
10. Modal closes after 1.5s with "Import started"
11. Below, the existing IngestionPanel document list starts populating as files arrive
12. Each document cycles: queued → OCR → classifying → done with a workstream tag
13. Within 5 minutes, Phase 1 transitions to completed (via Build B's scheduled sweep)

### Happy path — SharePoint & Dropbox

Same flow; the provider card + browser adapts to each provider's API.

### VDR placeholder flow

1. Click **Request access** on Intralinks / Datasite / Firmex
2. See "Access request sent. You'll hear from us shortly."
3. In Firestore, `vdrAccessRequests/{newId}` row exists with `status: 'open'`, the user's email, teamId, provider, and requestedAt

### Reconnect flow

1. Connect Google Drive
2. Revoke the OAuth grant from [your Google Account's third-party access page](https://myaccount.google.com/connections)
3. Trigger an API call — e.g. open the ProviderBrowser and try to list a folder
4. Server-side, `getAccessToken` fails to refresh → integration marked `expired`
5. Client surfaces the ReconnectBanner in the sidebar
6. Click the banner — navigates to the workspace (or archive), user clicks the IntegrationsPanel Google Drive card, "Reconnect" button
7. Re-authorize → integration back to connected

### Edge cases worth testing

- **Import a folder with a Google Doc** — should be exported to .docx and processed normally
- **Import a folder containing a shortcut** — shortcut target resolved + ingested; shortcut file itself skipped
- **Import the same data room twice** — first import gets all files, second gets all files as `skipped_duplicate` against the first
- **Import a 200MB+ file** — orchestrator logs a skip, doesn't blow up
- **Disconnect mid-import** — in-flight orchestrator finishes using the cached access token; subsequent imports need reconnect

---

## What's NOT in Build B2

Deliberate deferrals:

- **Production Intralinks / Datasite / Firmex connectors** — Build B2.5, once partner access is in place. The `VdrStubAdapter` is the reference implementation template.
- **Granular file selection** — you pick a folder, everything inside imports. File-by-file selection adds complexity without clear value for data-room ingestion.
- **Cross-deal dedup** — a file imported to two different deals gets processed twice. Per-deal dedup works. Cross-deal dedup would require global hash indexing.
- **Continuous sync** — imports are one-shot. "Keep this folder synced" is a different product surface (ongoing OAuth refresh + delta queries + notification webhooks). Post-v1.
- **SharePoint drive picker** — Build B2 defaults to the user's personal OneDrive (`/me/drive`). SharePoint site document libraries work via the Graph API but aren't exposed in the UI yet. Users with access can paste a specific site URL — a drive picker in the ProviderBrowser is a half-day follow-up.
- **Token encryption at rest** — Firestore stores tokens plaintext. Only the user can read their own row. Build G migrates to Secret Manager with KMS-backed encryption.
- **Revoke on team removal** — when a user is removed from a team, their OAuth tokens stay connected (they're per-user, not per-team). This is correct — the user may still use Outcome99 on a different team. Future: add a "revoke all tokens" action on the user settings page.
- **OAuth PKCE** — not needed for confidential clients (server-side exchange), not used. If we ever ship a pure client-side OAuth flow we'd add PKCE.
- **Import progress UI beyond counts** — the orchestrator updates `totalFilesDiscovered` / `totalFilesDispatched` every 10 files but the UI doesn't render these yet; per-doc progress via the existing document list is richer. A dedicated "imports in progress" panel is easy to add if needed.

---

## Failure modes and runbooks

### "Redirect URI mismatch" on OAuth consent

Cause: the URL registered with the provider doesn't byte-for-byte match `OAUTH_CALLBACK_URL`.

Fix: check both. Common mistakes — trailing slash, `http://` vs `https://`, function name case.

### OAuth state signature invalid

Cause: `OAUTH_STATE_SECRET` changed between issuing the URL and receiving the callback (e.g. secret rotated, or different values between local dev and production).

Fix: the user retries `Connect`. Each call issues a fresh signed state.

### Import stuck at `listing` or `dispatching`

Cause: orchestrator crashed or the Cloud Tasks dispatch deadline exceeded (30 min).

Fix: check logs; if the orchestrator hung on a slow provider API, bump the deadline or split the import. For now, deleting the `imports/{id}` row and re-running is safe — dedup ensures no double-ingest.

### `IntegrationExpiredError` loops

Cause: the refresh token itself expired (Google: ~6 months of inactivity; Microsoft: 90 days).

Fix: user reconnects via the banner.

### Workspace file import fails with "File too large"

Cause: Google Workspace exports have no size hint at list time; if the exported .docx exceeds the 200 MB cap, orchestrator skips the file.

Fix: inform the user; or raise `MAX_FILE_BYTES` if you've bumped the Document AI cap accordingly.

### Per-file errors surfacing as "failed" documents

Every per-file error in the orchestrator is logged, incremented on `perFileErrors`, and the doc row gets `status: 'failed'` with `failureReason`. The import still completes. These show up in the UI's Failed filter. Common causes: unsupported MIME type, download timeout, provider revoked a specific file permission.

---

## Cost expectations

Build B2 adds negligible cost on top of Build B. Provider API calls during browsing are free (all three providers offer generous read-only quotas). The import path's OCR + classification cost is identical to Build B (1,000 docs ≈ $25 total).

The only new cost is network egress from GCS when the orchestrator stages files — roughly $0.01 per GB, or $0.20 for a 20 GB data room.

---

## Delivery

`outcome99-buildb2.zip` contains the complete Build B2 source. Unzip, run through the deploy checklist, and test the happy-path flow with Google Drive first (easiest OAuth setup), then SharePoint, then Dropbox.

Next build options:
- **Build B2.5** — production Intralinks / Datasite / Firmex connectors. Blocked on partnerships. ~1 week when unblocked.
- **Build C** — contextual research + workstream extraction + red-flag detection. 3 weeks. The big one that makes the product commercially real.

Say "start Build C" or "wait on B2.5" when ready.
