# Getting Started

This repo is a **multi-build monorepo**. Everything through Build B2 is on `main`. Before you can test it, you need to provision cloud infrastructure — this is not a "`git clone` then `npm start`" project.

Plan for **2–4 hours** of setup the first time, most of it waiting for Google Cloud / Firebase / OAuth consoles.

---

## Minimum testing path (recommended first run)

If you want to see the app working end-to-end as quickly as possible, do **only** the steps needed to test manual upload + document ingestion. Skip Build B2 OAuth setup until later.

### 1. Local repo setup

```bash
git clone https://github.com/canaiwashmydishes/outcome.git
cd outcome
npm install
npm run build:shared
```

### 2. Firebase project

- Go to [console.firebase.google.com](https://console.firebase.google.com) → Add project
- Enable: Authentication (Google provider), Firestore (native mode, multi-region `us`), Storage, Functions
- Upgrade to Blaze plan — Functions and Cloud Tasks require it
- Note your project ID

### 3. Firebase CLI

```bash
npm install -g firebase-tools
firebase login
firebase use --add
# Select your project, alias it 'default'
```

### 4. Google Cloud APIs

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable documentai.googleapis.com
gcloud services enable cloudtasks.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
```

### 5. Document AI processor

```bash
gcloud documentai processors create \
  --location=us \
  --type=OCR_PROCESSOR \
  --display-name="outcome99-ocr"
```

Save the processor ID from the output.

### 6. Cloud Tasks queue

```bash
gcloud tasks queues create ingest-documents \
  --location=us-central1 \
  --max-concurrent-dispatches=20 \
  --max-dispatches-per-second=10
```

### 7. Anthropic API key

Get a key from [console.anthropic.com](https://console.anthropic.com).

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
# Paste your key.
```

### 8. Web app config

Copy `apps/web/.env.example` to `apps/web/.env` and fill in your Firebase web config (Project Settings → General → SDK setup).

### 9. First deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

From the output, capture these URLs:
- `processDocument` — `https://<region>-<project>.cloudfunctions.net/processDocument`
- `importOrchestrator` — same pattern (only needed for Build B2 OAuth imports)

### 10. Set function env vars

Create `functions/.env` (do NOT commit):

```
DOCUMENT_AI_PROCESSOR_ID=<from step 5>
PROCESS_DOCUMENT_URL=<from step 9>
IMPORT_ORCHESTRATOR_URL=<from step 9>
DOCUMENT_AI_LOCATION=us
CLOUD_TASKS_LOCATION=us-central1
```

Redeploy:

```bash
firebase deploy --only functions
```

### 11. Grant Cloud Tasks invoker roles

```bash
gcloud run services add-iam-policy-binding processDocument \
  --member="serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1

gcloud run services add-iam-policy-binding importOrchestrator \
  --member="serviceAccount:YOUR_PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1
```

### 12. Run the web app

```bash
cd apps/web
npm run dev
```

Open the local URL, sign in with Google, create a deal, drag-drop PDFs to test ingestion.

---

## Optional — Build B2 OAuth integrations (Drive / SharePoint / Dropbox)

See `Outcome99_BuildB2_Handoff.md` for step-by-step OAuth app registration with each provider. Summary:

1. Register an OAuth app with each of Google, Microsoft, Dropbox
2. Set the redirect URI to your `oauthCallback` function URL (from step 9)
3. Set the six OAuth secrets: `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MS_OAUTH_CLIENT_ID/SECRET`, `DROPBOX_OAUTH_CLIENT_ID/SECRET`
4. Generate and set `OAUTH_CALLBACK_URL` + `OAUTH_STATE_SECRET` env vars
5. Redeploy

---

## Per-build context

Each build has a dedicated handoff document in this repo root describing what it shipped, design decisions, test walkthroughs, and known limitations:

- `Outcome99_BuildB_Handoff.md` — Document ingestion (OCR + classification)
- `Outcome99_BuildB2_Handoff.md` — Cloud-storage integrations

For the full product specification, see `Outcome99_v6_Architecture.md`.

---

## What to expect after deploy

**Working:** create a deal, invite members, drag-drop upload, connect Google Drive / SharePoint / Dropbox, browse folders, import a subtree, watch documents OCR and classify live in the workspace.

**Not working (intentional, builds out ahead):** red-flag detection, scenario testing, exports, Stripe billing, VDR connectors (Intralinks / Datasite / Firmex — these show a "Request access" flow backed by `vdrAccessRequests` in Firestore).

**Common first-deploy failures:**

- "Document AI not configured" — missing `DOCUMENT_AI_PROCESSOR_ID` env var
- Documents stuck at `uploaded` — Cloud Tasks missing invoker role on `processDocument`
- OAuth consent redirect mismatch — redirect URL registered with provider doesn't exactly match `OAUTH_CALLBACK_URL`
- Function deploy fails — Blaze plan not enabled

---

## Cost expectations

Once deployed, ingestion costs are roughly:

| Data room size | Cost per ingestion |
|---|---|
| 50 docs | ~$1 |
| 200 docs | ~$4 |
| 1,000 docs | ~$25 |

Storage is pennies per deal per month. Empty Firebase project costs ≈ $0/mo at rest.

---

## Need a walkthrough?

The handoff docs in repo root are written as if a second engineer is picking up from where each build left off. Read `Outcome99_BuildB2_Handoff.md` first — it's the most current.
