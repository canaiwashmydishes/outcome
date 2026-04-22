# Outcome99

**AI-native decision system for live M&A and Private Equity transactions.**

Ingests deal data rooms, extracts workstream-level risk, flags red flags with source-backed evidence, generates follow-up requests, quantifies impact via Claude-native scenario testing, and produces IC-ready deliverables — all under a defensible audit trail.

Target: $30K/year Professional tier. See `Outcome99_v6_Architecture.md` for the full product specification.

---

## Build Status

**Build B2 — Cloud-Storage & VDR Integrations** (current). Users connect Google Drive, SharePoint, or Dropbox via OAuth, browse their folder tree, and import a data room with a single click. The orchestrator walks the provider subtree, deduplicates by SHA-256, stages bytes to GCS, and hands each document to Build B's `processDocument` worker for OCR and classification. VDR providers (Intralinks, Datasite, Firmex) surface a "Request access" flow that notifies the admin — real connectors ship in B2.5 once partner agreements are in place.

- ✅ **Build 0** — v6.0 foundation pivot (deals, teams, subscriptions, audit log)
- ✅ **Build A** — Team management (multi-team, invitations, role management)
- ✅ **Build B** — Document ingestion (OCR + classification + live status)
- ✅ **Build B2** — Cloud-storage + VDR integrations (Drive, SharePoint, Dropbox live; VDR stubs with request flow)
- ⏳ **Build B2.5** — Production Intralinks / Datasite / Firmex connectors (requires partner access)
- ⏳ Build C — Contextual research + workstream extraction + red-flag detection
- ⏳ Build D — Issue tracker + evidence viewer + human review
- ⏳ Build E — Follow-up generation + IC-ready exports
- ⏳ Build F — Claude-native scenario testing swarm
- ⏳ Build G — Trust / audit / permissions hardening
- ⏳ Build H — Stripe billing + onboarding + polish

---

## What works in Build B2

End-to-end flows:

**Manual upload (Build B, still live):** drag-and-drop a folder, SHA-256 dedup, OCR via Google Document AI, Claude Sonnet classifies into nine workstreams.

**Cloud-storage import (Build B2, new):**
1. Open a deal's Phase 1 — Data-Room Ingestion panel
2. Connect Google Drive / SharePoint / Dropbox via OAuth (one-time per user)
3. Browse the provider's folder tree in a modal
4. Click "Import this folder" on a data room root
5. Orchestrator task walks the subtree, downloads each file, dedups by hash, stages to GCS, enqueues `processDocument`
6. Per-doc OCR + classification reuses Build B's pipeline verbatim — zero duplication
7. Live status surfaces in the same IngestionPanel via the existing `useDocuments` subscription

**VDR placeholder:** clicking Intralinks / Datasite / Firmex writes a row to `vdrAccessRequests` collection with the user's email, team, and provider. The admin picks these up in Build H's admin UI.

**Reconnect banner:** when a provider's refresh token fails, the integration is marked `expired` and a red banner appears in the sidebar until the user reconnects.

Every import is audited: `import_initiated`, `import_completed` (or `import_failed`), per-doc `document_uploaded`, `document_failed`, plus `integration_connected` / `integration_disconnected` / `vdr_access_requested`.

---

## Architecture (integration import path)

```
                      ┌────────────┐
  user clicks         │ React SPA  │
  "Import folder" ───▶│            │
                      └─────┬──────┘
                            │ initiateImport callable
                            ▼
               ┌───────────────────────────┐
               │ deals/{id}/imports/{id}   │  status: queued
               │ (Firestore)               │
               └─────────────┬─────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Cloud Tasks queue            │
              │ ingest-documents             │
              └──────────────┬───────────────┘
                             │
                             ▼
         ┌──────────────────────────────────────┐
         │ importOrchestrator (HTTP worker)     │
         │ - refresh access token               │
         │ - adapter.walkSubtree(root)          │
         │ - per file: download, dedup, stage   │
         │ - enqueue processDocument per file   │
         └──────────────┬───────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────────────┐
         │ processDocument (Build B, unchanged) │
         │ Document AI OCR + Claude classify    │
         └──────────────────────────────────────┘
```

---

## Deploy checklist — Build B2 additions

Build B2 reuses all Build B infrastructure (Document AI, Cloud Tasks queue, Firebase Storage). New setup is limited to OAuth provider registration.

### 1. Register OAuth apps with each provider

**Google Drive** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
- Create an OAuth 2.0 Client ID (Web application)
- Add authorized redirect URI: `https://<your-region>-<project>.cloudfunctions.net/oauthCallback`
- Add scopes to your OAuth consent screen: `https://www.googleapis.com/auth/drive.readonly`

**SharePoint / OneDrive** — [Azure App Registration](https://portal.azure.com/):
- Register a new application
- Redirect URI (Web): same URL as above
- API permissions: Microsoft Graph → Delegated → `offline_access`, `Files.Read.All`, `Sites.Read.All`
- Grant admin consent (for multi-tenant)

**Dropbox** — [Dropbox App Console](https://www.dropbox.com/developers/apps):
- Create app with "Scoped access" and "Full Dropbox" (or "App folder" for scoped testing)
- Permissions: `files.metadata.read`, `files.content.read`
- Redirect URI: same URL as above

### 2. Set secrets and env vars

```bash
# OAuth client credentials (secrets — encrypted at rest)
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
firebase functions:secrets:set MS_OAUTH_CLIENT_ID
firebase functions:secrets:set MS_OAUTH_CLIENT_SECRET
firebase functions:secrets:set DROPBOX_OAUTH_CLIENT_ID
firebase functions:secrets:set DROPBOX_OAUTH_CLIENT_SECRET

# Environment variables (functions/.env)
# OAUTH_CALLBACK_URL = https://<region>-<project>.cloudfunctions.net/oauthCallback
# OAUTH_STATE_SECRET = openssl rand -hex 32
# IMPORT_ORCHESTRATOR_URL = https://<region>-<project>.cloudfunctions.net/importOrchestrator
```

### 3. Grant Cloud Tasks invoker on importOrchestrator

```bash
gcloud run services add-iam-policy-binding importOrchestrator \
  --member="serviceAccount:YOUR_PROJECT@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1
```

### 4. Deploy rules, indexes, functions

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

The first deploy surfaces the `oauthCallback` and `importOrchestrator` URLs. Feed those back into the env vars above and redeploy.

See `Outcome99_BuildB2_Handoff.md` for step-by-step commands, troubleshooting, and a test walkthrough.

---

## License

Proprietary. Not for redistribution.
