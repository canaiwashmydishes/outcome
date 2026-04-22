# Outcome99 — Build B Handoff

**Build B — Document Ingestion.** The platform now accepts real data rooms. Users drag-and-drop a folder, Outcome99 dedups, OCRs every document via Google Document AI, classifies each into one of nine M&A diligence workstreams via Claude Sonnet, and surfaces live processing status to the workspace. Phase 1 of the seven-phase pipeline is live end-to-end.

77 source files, 110 KB zipped. +12 files vs. Build A across ingestion infrastructure, worker, UI, and scheduled completion sweep.

---

## What shipped

### Backend

- `functions/src/lib/ingestConfig.ts` — typed config for Document AI, Cloud Tasks, Storage. Fail-fast validator catches missing env vars at invocation time rather than mid-pipeline.
- `functions/src/ingest/documentAI.ts` — Google Document AI wrapper. Uses the sync processor (up to 30 pages per call); returns `{text, pageCount, pages[]}` with per-page text extracted from text-anchor spans.
- `functions/src/ingest/cloudTasks.ts` — per-document task enqueuer. Each task is an OIDC-authenticated HTTP request to `processDocument`; Cloud Tasks handles retries, backoff, and concurrency capping.
- `functions/src/prompts/classifier.ts` — Claude Sonnet classifier prompt. Grounded in Source of Truth §4 (nine workstreams). Enforces structured output via the `classify_document` tool.
- `functions/src/clients/schemas.ts` — `CLASSIFIER_TOOL` JSON schema with `enum`-constrained workstream values.
- `functions/src/clients/claude.ts` — added `classifyDocument()` to the `ClaudeClient` interface. Real implementation uses Claude Sonnet with post-parse confidence clamping. Stub uses deterministic keyword matching so offline/CI runs produce plausible classifications.
- `functions/src/deals/initiateDocumentUpload.ts` — dedup check → signed URL + pre-created Firestore row. Dedup uses SHA-256 collision on the same deal (not cross-deal). Rejects files exceeding the 200 MB cap and files with unsupported MIME types.
- `functions/src/deals/finalizeDocumentUpload.ts` — verifies the GCS object landed, transitions the doc to `uploaded`, enqueues the Cloud Task, writes the `document_uploaded` audit event, and moves the deal's `phaseStatus.ingestion` from `not_started` to `in_progress` on first upload. All atomic.
- `functions/src/deals/processDocument.ts` — the worker. HTTP-triggered by Cloud Tasks. Runs OCR → classify → persist. Inlines OCR text under 40K chars; spills larger extracts to `deals/{id}/ocr/{docId}.txt` in GCS. Any failure marks the doc `failed` with `failureReason` and writes an audit event, returning 200 so Cloud Tasks doesn't retry non-transient errors.
- `functions/src/deals/sweepIngestionStatus.ts` — scheduled every 5 minutes. For any deal with `phaseStatus.ingestion == 'in_progress'`, checks whether any docs remain in processing states. If the queue has drained and at least one doc reached a terminal state, transitions the deal to `completed` and writes an `ingestion_completed` audit event.

### Frontend

- `apps/web/src/lib/uploadClient.ts` — client orchestrator. SHA-256 digest, parallel upload pool (4 concurrent), XHR progress events, per-file state callback for UI updates.
- `apps/web/src/hooks/useDocuments.ts` — real-time doc subscription. Computes a summary object with per-status counts and per-workstream distribution.
- `apps/web/src/components/DocumentUploadDropzone.tsx` — drag-and-drop surface. Supports folder drops via `webkitGetAsEntry` (preserving folder paths), single-file picker, and folder picker (`webkitdirectory`). Per-file progress rows with status transitions.
- `apps/web/src/components/IngestionPanel.tsx` — the Phase 1 UI. Dropzone + summary tiles + per-workstream distribution + filterable document list.
- `apps/web/src/components/DealWorkspace.tsx` — restructured with `overview` vs `ingestion` sub-views. The Phase 1 card is now clickable.

### Schema & rules

- `DocumentStatus` lifecycle: `queued` → `uploaded` → `ocr_in_progress` → `classifying` → `completed` | `failed` | `skipped_duplicate`
- `DealDocument` extended with `status`, `failureReason`, `folderPath`, `classifierRationale`
- Audit events added: `document_failed`, `document_reprocessed`, `ingestion_started`, `ingestion_completed`
- New index on `documents` by `(status, createdAt)` for filtered queries

### Retained

- Claude Opus prompts from Build 2 (`research.ts`, `personas.ts`, `synthesis.ts`, `oracle.ts`) — unchanged; they reactivate in Builds C and F.
- All Build A team callables and UI surfaces — untouched.

---

## Deploy checklist

This is the first build with real third-party infrastructure. Follow the steps in order.

### 1. Enable Google Cloud APIs

```bash
gcloud services enable documentai.googleapis.com
gcloud services enable cloudtasks.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
# (storage + firestore already enabled via Firebase)
```

### 2. Create the Document AI processor

```bash
gcloud documentai processors create \
  --location=us \
  --type=OCR_PROCESSOR \
  --display-name="outcome99-ocr"
```

Copy the processor ID from the output (it looks like `1a2b3c4d5e6f7890`). You'll need it in step 5.

### 3. Create the Cloud Tasks queue

```bash
gcloud tasks queues create ingest-documents \
  --location=us-central1 \
  --max-concurrent-dispatches=20 \
  --max-dispatches-per-second=10
```

The concurrency cap prevents runaway Claude/Document AI costs during large data room uploads. Twenty concurrent workers is a reasonable default — adjust up if you observe user-visible queueing delays.

### 4. Set the Anthropic secret

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
# Paste your key when prompted.
```

### 5. First deploy — get the processDocument URL

```bash
# Install deps and build
npm install
npm run build:shared

# Deploy rules, indexes, and functions (first pass — no PROCESS_DOCUMENT_URL yet)
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

The deploy output will include the URL of every function. Note the `processDocument` URL — it looks like `https://us-central1-YOUR_PROJECT.cloudfunctions.net/processDocument` (or Cloud Run `run.app` for Gen 2).

### 6. Set env vars and redeploy

The `finalizeDocumentUpload` callable needs `PROCESS_DOCUMENT_URL` to know where Cloud Tasks should dispatch to. Set it along with the Document AI processor ID:

```bash
# Set env vars for the functions runtime. Two options:
#  Option A — environment file (simpler, committed):
echo "DOCUMENT_AI_PROCESSOR_ID=YOUR_PROCESSOR_ID" >> functions/.env
echo "PROCESS_DOCUMENT_URL=https://us-central1-YOUR_PROJECT.cloudfunctions.net/processDocument" >> functions/.env
echo "CLOUD_TASKS_LOCATION=us-central1" >> functions/.env
echo "DOCUMENT_AI_LOCATION=us" >> functions/.env

# Redeploy so the new env vars ship.
firebase deploy --only functions
```

### 7. Grant Cloud Tasks the invoker role on processDocument

Cloud Tasks uses OIDC authentication. The default App Engine service account needs permission to invoke the `processDocument` endpoint:

```bash
# For Functions Gen 2 (recommended, default for new projects):
gcloud run services add-iam-policy-binding processDocument \
  --member="serviceAccount:YOUR_PROJECT@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1 \
  --project=YOUR_PROJECT

# For Functions Gen 1 (older projects):
gcloud functions add-iam-policy-binding processDocument \
  --member="serviceAccount:YOUR_PROJECT@appspot.gserviceaccount.com" \
  --role="roles/cloudfunctions.invoker" \
  --region=us-central1
```

### 8. Verify

```bash
# Check the scheduler is registered
gcloud scheduler jobs list --location=us-central1

# Tail logs during a test upload
firebase functions:log --only processDocument
```

---

## Test walkthrough

1. Sign in to the deployed app.
2. Create a deal (`Create deal workspace`). Land in the workspace overview.
3. Click the first phase card — **Data-Room Ingestion**. The ingestion panel appears.
4. Drag a folder of test PDFs onto the dropzone. Suggested test set:
   - 3–5 small PDFs (under 5 pages each) — should complete in 30–60 seconds
   - 1 large PDF (20+ pages) — should complete in 60–120 seconds
   - 2 duplicate copies of the same file (identical content in different folders) — one should be deduped
5. Watch the per-file progress rows update during upload (hashing → initiating → uploading % → finalizing → done or duplicate).
6. Once uploaded, the document list below shows each row transitioning: `queued → OCR → classifying → done` with a workstream label.
7. Failed docs surface with a red indicator and the failure reason.
8. The per-workstream tiles populate as classifications complete.
9. Within 5 minutes, the deal's Phase 1 card transitions from **in progress** to **completed** (driven by the scheduled sweep).

### What to verify in Firestore

Open the Firestore console.

- `deals/{dealId}` — `phaseStatus.ingestion` transitioned from `not_started` → `in_progress` → `completed`
- `deals/{dealId}/documents/{docId}` — each doc has:
  - `status: 'completed'`
  - `workstream` set (one of the nine)
  - `classifierConfidence` between 0 and 1
  - `classifierRationale` populated
  - `pages` > 0
  - `ocrText` (if short) or `ocrStoragePath` (if long)
- `deals/{dealId}/documents/{docId}` where `status: 'skipped_duplicate'` — `duplicateOf` points to a completed doc
- `deals/{dealId}/auditLog/*` — entries for `document_uploaded`, `document_failed` (if any), `ingestion_completed`

---

## Cost expectations

Per your decision to trust user uploads without a cap, here's what a realistic deal costs Outcome99 in ingestion fees:

| Data room size | Document AI (~$1.50/1000 pp) | Claude Sonnet classify (~$0.002/doc) | Storage (first month) | Total |
|---|---|---|---|---|
| 50 docs, ~500 pages | ~$0.75 | ~$0.10 | ~$0.01 | **~$0.86** |
| 200 docs, ~2,500 pages | ~$3.75 | ~$0.40 | ~$0.05 | **~$4.20** |
| 1,000 docs, ~15,000 pages | ~$22.50 | ~$2.00 | ~$0.20 | **~$24.70** |
| Pathological: 5,000 docs, ~80,000 pages | ~$120.00 | ~$10.00 | ~$1.00 | **~$131** |

Context for these numbers:
- Professional tier = $30K / 20 deals ≈ $1,500 cost-to-serve budget per deal. Build B consumes 0.3–1.7% of that. The rest goes to Builds C–F (extraction, detection, scenarios) and Build G (KMS, audit storage).
- The pathological case (5,000-doc data room) would exceed the per-deal cost budget for Phase 1 alone. In practice I'd expect these to be rare and we can revisit a cost cap in a post-v1 pass if abuse patterns emerge.
- Document AI pricing is the dominant cost. If volume grows, consider committing to the Document AI autoscaling SKU which discounts heavy users.

---

## Known limitations and deliberate deferrals

- **30-page OCR cap.** The sync Document AI processor is capped at 30 pages per request. Documents longer than 30 pages fail with a clear `failureReason` and don't block the rest of the deal. A ~1-day follow-up migrates to the batch processor (async, 500 pages, long-running operation) for v1.1.
- **No client-side resumable uploads.** If a user navigates away mid-upload, the in-flight file is lost. They can retry — the dedup check prevents double-ingest of successfully uploaded files. Resumable uploads are 2–3 days of code; deferred.
- **No reprocess UI.** A failed doc currently stays failed. Reprocessing requires the Build D human-review UI where we can expose "retry classification" actions.
- **Classifier confidence isn't surfaced visually beyond a percentage tick.** Low-confidence results (< 0.5) should flag for review; Build D implements the review queue.
- **Dedup is per-deal, not cross-deal.** Two different deal workspaces that receive the same file will OCR it twice. Cross-deal dedup would require per-hash indexing at the team or global level — defer to post-v1.
- **Folder path is informational only in Build B.** It's stored on every doc but not yet used by the classifier as a prior (the prompt mentions it, but the classifier can't query adjacent docs' folder paths yet). Build C's contextual research will exploit folder structure more aggressively.
- **No bulk re-upload.** If a user wants to replace a file, they delete and re-upload. Replace-in-place would require a versioned doc model — out of v1 scope.
- **VDR integrations.** Intralinks, Datasite, Firmex, SharePoint, Google Drive, Dropbox all ship in Build B2 (1 week). The upload pathway is abstracted at the `sourceChannel` enum level so B2 just adds alternative initiators that still enqueue the same `processDocument` worker.

---

## Failure modes and runbooks

### "Document AI not configured" error on upload

Cause: `DOCUMENT_AI_PROCESSOR_ID` env var not set. The fail-fast check in `ingestConfig.ts` surfaces this at `processDocument` invocation, marking the doc `failed` with a clear message.

Fix: set the env var and redeploy.

### Doc stuck at `uploaded` indefinitely

Cause: Cloud Tasks couldn't reach `processDocument`. Most common reasons:
1. `PROCESS_DOCUMENT_URL` env var wrong on `finalizeDocumentUpload`
2. Cloud Tasks service account lacks invoker role on `processDocument`
3. `processDocument` was redeployed to a different URL

Fix: check `gcloud tasks queues describe ingest-documents` for dead letters; verify the URL matches; re-grant the invoker role.

### All docs from a specific user failing with `HTTP 401`

Cause: signed URL expired (15-minute TTL). The user took longer than 15 minutes between `initiateDocumentUpload` and actually uploading the file.

Fix: upload client auto-retries internally; persistent failures usually mean a client-side retry loop isn't firing. Check browser console.

### Scheduled sweep not transitioning deals

Cause: Cloud Scheduler not enabled, or the deploy of `sweepIngestionStatus` didn't register the schedule.

Fix: `gcloud scheduler jobs list --location=us-central1` should show `firebase-schedule-sweepIngestionStatus-us-central1`. If missing, redeploy functions and check the Firebase Functions console.

### Budget alarm fires

Google Cloud billing alerts are the v1 cost guardrail. If you see unexpected Document AI charges, check the `documents` collection for a deal with an unusually large page count and consider temporarily pausing the Cloud Tasks queue:

```bash
gcloud tasks queues pause ingest-documents --location=us-central1
# Investigate, then resume:
gcloud tasks queues resume ingest-documents --location=us-central1
```

---

## Next up: Build B2 or Build C

Two options for the next build, both valid:

**Build B2 — VDR and cloud-storage integrations (1 week).** OAuth flows for SharePoint, Google Drive, Dropbox. Connector SDKs for Intralinks, Datasite, Firmex. All reuse the Build B ingestion pipeline; they add alternative initiators that call `initiateDocumentUpload` with a different `sourceChannel`. Marketing-impactful — sales can demo a live VDR import.

**Build C — Contextual research + workstream extraction + red-flag detection (3 weeks).** The heaviest build in the plan. Nine workstream extractors, rule library in `packages/rules/`, LLM pattern detection, Finding object materialization. This is where the product starts producing commercially material output.

My recommendation: **Build B2 first.** Shorter, unblocks sales demos, and lets us test the ingestion pipeline against real VDRs before we commit to Build C's three-week push.

Say "start Build B2" or "start Build C" when ready.

---

## Delivery

`outcome99-buildb.zip` contains the complete Build B source. Unzip, run the deploy checklist, test the walkthrough.
