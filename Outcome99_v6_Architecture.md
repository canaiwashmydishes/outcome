# Outcome99 v6.0 — Technical Architecture

**Product:** AI-native decision system for live M&A and Private Equity transactions.
**Commercial anchor:** $30K/year Professional tier.
**Source of truth:** `Outcome99_Source_Of_Truth_V6.docx`.
**Status of Builds 1–2:** Superseded by the v6.0 pivot. Foundation code (auth, billing spine, design language, Claude integration pattern) survives. Product surface (simulation-first UX, `simulations/{id}` schema, four-phase pipeline) is replaced.

---

## 1. Product One-Pager

Outcome99 v6.0 does the work of a deal team. A user uploads a target's data room. Within 24 hours, Outcome99 returns a structured red-flag report: every material risk surfaced across nine diligence workstreams, each finding citing the source document at page and clause level, each tagged with deal-impact (price chip, escrow, indemnity, walk-away). The analyst reviews, approves, or dismisses findings from a single issue tracker, produces a follow-up request list for the seller, and exports IC-ready deliverables on one click. For the material risks, the analyst launches agent-based scenario tests that quantify deal impact in basis points or dollar terms.

At the $30K price point, the buyer writes the cheque for: time saved across 10–20 deals per year, money protected through better pricing and risk avoidance, and an enterprise-grade audit trail that holds up at IC and in post-close disputes.

---

## 2. Product Decisions Locked In

These are the decisions you confirmed. Everything downstream flows from them.

| # | Decision | Implication |
|---|---|---|
| 1 | **GPT-4o allowed for batch persona generation.** Claude-only is not mandatory. | We integrate OpenAI for Phase 6 persona batches. Claude remains the primary reasoning engine for Phases 2, 3, 5, and 7. |
| 2 | **Google Document AI for OCR.** | Pay-per-page, high quality, no infrastructure. We bill this as a cost-of-goods-sold against per-deal unit economics. |
| 3 | **VDR integrations (Intralinks, Datasite, Firmex) in v1 launch.** | Adds ~2 weeks to the timeline. We bundle them into the ingestion phase with a shared OAuth abstraction. |
| 4 | **Claude-native swarm in Phase 6. No MiroFish.** | We build our own agent-based scenario engine with PE-specific agent behavior. Hero differentiator. |
| 5 | **SOC 2 in a 2-week budget for v1.** | We adopt a SOC 2-ready posture (controls, documentation, audit logs) rather than pursuing a Type II audit in v1. Type II audit is post-launch. |

---

## 3. Product Pillars and Where They Live in the Code

The six pillars from the Source of Truth map to specific subsystems in the codebase.

| Pillar | Primary subsystem | Key files (planned) |
|---|---|---|
| Workstream Risk Extraction | `phases/extract/` | Per-workstream extractors, shared schema |
| Red-Flag Detection Engine | `phases/detect/` | Versioned rule library + LLM layer |
| Source-Backed Findings | `trust/evidence.ts` | Snippet linking, citation preservation |
| Follow-Up Request Generator | `phases/followup/` | Per-workstream seller-request generator |
| IC / Memo-Ready Outputs | `phases/export/` | Seven templated deliverables |
| Quantification Layer | `phases/scenario/` | Claude-native swarm, on-demand per finding |

---

## 4. Seven-Phase Pipeline

v5.0's four-phase pipeline is replaced by a seven-phase flow. Phases 1–5 and 7 are new. Phase 6 is the repositioned swarm engine.

### Phase 1 — Data-Room Ingestion
**Inputs:** user-uploaded files, VDR connections, Google Drive / SharePoint / Dropbox connections.
**Work:** OCR (Google Document AI), folder recognition, classification by workstream (Claude Sonnet), dedup, metadata indexing.
**Outputs:** `deals/{dealId}/documents/{docId}` written with `workstream`, `pages`, `ocrText`, `classifier`, `hash`, `sourceChannel`.
**Infra:** Cloud Run job for batch OCR (off-thread from user requests); Firestore for metadata; Firebase Storage for originals.
**SLA target:** 1,000-document data room in under 2 hours.

### Phase 2 — Contextual Research
**Inputs:** deal metadata from setup wizard (sector, size, structure, geography), first pass of classified documents.
**Work:** Claude Opus 4.7 maps deal context to the applicable red-flag library subset and identifies which workstreams are in scope. Sector-specific rule activation happens here.
**Outputs:** `deals/{dealId}` updated with `contextMap`, `activeWorkstreams`, `activeRules`, `complexityEstimate`.
**Infra:** Single Cloud Functions callable, Opus with structured output via `tool_use`.
**Expected latency:** 30–60 seconds.

### Phase 3 — Workstream Risk Extraction
**Inputs:** classified documents by workstream, active rules from Phase 2.
**Work:** Nine workstream extractors (legal, financial, tax, HR, cyber/IT, commercial, customer, supplier, operations/integration). Each extractor: per-doc Claude Opus pass to extract issue objects with citations; shared schema for issue structure; confidence scoring per issue.
**Outputs:** `deals/{dealId}/issues/{issueId}` — one row per extracted issue (may or may not become a red flag).
**Infra:** Parallel Cloud Run jobs, one per workstream. Opus calls are heavily parallelized because each doc is independent.
**Expected latency:** 1–4 hours for a 1,000-doc data room, depending on parallelism budget.

### Phase 4 — Red-Flag Detection
**Inputs:** issues from Phase 3.
**Work:** Deterministic rule library (versioned in code) runs first — catches high-confidence deterministic flags (CoC clauses, customer concentration bands, revenue-recognition anomalies). LLM layer runs second, detecting patterns the rule library can't express. Both produce Finding objects. Severity, likelihood, and deal-impact tag are assigned here.
**Outputs:** `deals/{dealId}/findings/{findingId}` — Finding objects with source-backed evidence chain.
**Infra:** Cloud Functions callable triggers the rule library; Claude Opus for the LLM pattern layer.
**Expected latency:** 5–15 minutes after Phase 3 completes.

### Phase 5 — Follow-Up Generation
**Inputs:** open findings from Phase 4.
**Work:** Claude Opus produces a prioritized list of seller-facing clarifications and missing-document requests, grouped by workstream.
**Outputs:** `deals/{dealId}/followups/{followupId}` with per-item workstream, priority, status, and draft text.
**Infra:** Single Cloud Functions callable.
**Expected latency:** 1–2 minutes.

### Phase 6 — Scenario Testing (Claude-Native Swarm)
**Inputs:** one specific Finding selected by the analyst, plus deal context.
**Work:** Launches an agent-based simulation (100 / 500 / 1000 personas, scaled to scenario complexity). Agents are PE / M&A personas with mandate-specific behavior. Personas generated in batches by GPT-4o. Agent-turn reasoning by Claude Sonnet. Convergence data is aggregated into basis-point impact or dollar-term outputs and attached back to the originating Finding.
**Outputs:** `deals/{dealId}/scenarios/{scenarioId}` linked to a `findingId`; Finding gets a new `quantifiedImpact` field.
**Infra:** Cloud Run job for long-running sims (>9-min budget); Cloud Tasks orchestration for Medium and High tiers.
**Expected latency:** Low ~2 min, Medium ~5 min, High ~10 min (matches Path B estimates).

### Phase 7 — Synthesis and Export
**Inputs:** findings, follow-ups, scenario outputs, analyst notes.
**Work:** Claude Opus produces seven export artifacts: IC memo, top-10 red-flag pack, unresolved-issues tracker, valuation implications, integration implications, follow-up request list, deal summary. Each in the format the buyer expects (PDF / Word / Excel).
**Outputs:** `deals/{dealId}/exports/{exportId}` with format, generated URL, version, generatedBy.
**Infra:** Cloud Functions + Cloud Run (Puppeteer for PDF; docx-js for Word; ExcelJS for spreadsheets).
**Expected latency:** 30–120 seconds per artifact.

---

## 5. Data Model

The `simulations` collection from Builds 1–2 is retired. The root collection becomes `deals`.

### 5.1 Firestore schema

```
deals/{dealId}
  ├─ meta                              (deal metadata)
  │   ├─ name, sector, size, structure, geography
  │   ├─ ownerId, teamId
  │   ├─ createdAt, updatedAt
  │   └─ phaseStatus (map of Phase → status)
  ├─ contextMap                        (Phase 2 output)
  ├─ activeWorkstreams                 (array)
  ├─ activeRules                       (array of {ruleId, version})
  ├─ complexityEstimate                (Low/Medium/High)
  │
  ├─ documents/{docId}                 (Phase 1 output)
  │   ├─ name, path, hash, sourceChannel
  │   ├─ workstream, pages, mimeType
  │   ├─ ocrText, classifier
  │   └─ uploadedBy, uploadedAt
  │
  ├─ issues/{issueId}                  (Phase 3 output — pre-flag)
  │   ├─ workstream, title, description
  │   ├─ sourceDocs[] (docId, pageNum, clauseRef, snippet)
  │   ├─ confidence, extractorVersion
  │   └─ extractedAt
  │
  ├─ findings/{findingId}              (Phase 4 output — the Finding object)
  │   ├─ workstream, title, description, rationale
  │   ├─ sourceDocuments[] (bidirectional links to documents)
  │   ├─ confidenceScore (0.0–1.0)
  │   ├─ modelVersion, ruleVersion
  │   ├─ severity (Low/Medium/High/Critical)
  │   ├─ likelihood (0.0–1.0)
  │   ├─ dealImpactTag (Price Chip / Escrow / Indemnity / Confirmatory Diligence / Integration Plan / Walk-Away)
  │   ├─ status (Open / Under Review / Resolved / Needs Seller Response / Dismissed)
  │   ├─ owner (uid or teamId)
  │   ├─ quantifiedImpact (optional — populated by Phase 6)
  │   └─ auditLogRef (subcollection or external)
  │
  ├─ followups/{followupId}            (Phase 5 output)
  │   ├─ workstream, priority, text, sellerDueDate
  │   ├─ linkedFindings[]
  │   └─ status (Draft / Sent / Received / Closed)
  │
  ├─ scenarios/{scenarioId}            (Phase 6 output)
  │   ├─ findingId (link back)
  │   ├─ personaCount, tier (low/medium/high)
  │   ├─ agents[] (persona data)
  │   ├─ convergenceData
  │   ├─ quantifiedImpact (bps, dollar amounts)
  │   └─ runStatus
  │
  ├─ exports/{exportId}                (Phase 7 output)
  │   ├─ type (IC_MEMO / TOP_10 / TRACKER / VALUATION / INTEGRATION / FOLLOWUP / SUMMARY)
  │   ├─ format (PDF / DOCX / XLSX)
  │   ├─ storagePath, generatedAt, generatedBy
  │   └─ version
  │
  ├─ messages/{msgId}                  (deal-scoped chat — replaces Oracle)
  │   └─ role, content, createdAt, author
  │
  └─ auditLog/{eventId}                (IMMUTABLE — every action)
      ├─ actorId, actorRole
      ├─ eventType (CREATE / UPDATE / STATUS_CHANGE / EXPORT / VIEW)
      ├─ target (findingId / documentId / exportId)
      ├─ before, after (diff)
      └─ timestamp, ipAddress, sessionId

teams/{teamId}                         (NEW — org-level for Professional+)
  ├─ name, billingEmail, plan
  ├─ members/{uid} (role: Partner / Associate / External Counsel / Consultant / Observer)
  └─ seatsAllocated, seatsMax

users/{uid}                            (retained from Build 1)
  ├─ email, displayName, photoURL
  ├─ teamId (primary team)
  ├─ role (per-team role lives under teams/{teamId}/members/{uid})
  └─ (credit fields removed — billing moves to team-level annual)

subscriptions/{subscriptionId}         (NEW — replaces per-user credit plan)
  ├─ teamId, tier (Starter / Professional / Enterprise)
  ├─ stripeSubscriptionId
  ├─ dealsUsedThisYear, dealsIncluded
  ├─ seatsMax, seatsUsed
  ├─ anniversaryDate
  └─ status

rule_library/{workstream}/rules/{ruleId}   (CODE-FIRST, mirrored here for audit)
  ├─ version, title, expression
  ├─ severity default, likelihood default
  └─ deactivatedAt (soft delete)
```

### 5.2 Schema notes

- **`users` loses credit fields.** v6.0 billing is annual team subscriptions with deal and seat quotas, not per-user credits. The `usage_events` collection is retired.
- **`auditLog` is write-once.** Firestore security rules enforce no updates. Every mutation to a Finding writes a new event.
- **Rules are code-first.** The rule library lives in `packages/rules/` as TypeScript, version-controlled. `rule_library` in Firestore is a read-only mirror for audit and for admin UI. Deploys bump the rule version.
- **`teams/` is new.** The unit of billing is the team, not the individual. Users belong to one primary team and can be invited to others.

### 5.3 Migration from Builds 1–2

The existing code has `simulations/{id}` with `ownerId`, `inputs`, etc. Migration is clean because no production data exists yet (everything was dev/stub). Rename and restructure happen in Build 0 (see §11).

---

## 6. Code Architecture

Monorepo structure evolves from Builds 1–2. Added packages and apps are in bold.

```
outcome99/
├── apps/
│   ├── web/                      (retained, heavily rebuilt UI)
│   └── admin/ (NEW)              (internal ops console for rules + support)
│
├── packages/
│   ├── shared/                   (retained; expanded types)
│   ├── rules/ (NEW)              (rule library, versioned, TS)
│   ├── extractors/ (NEW)         (workstream extractors + prompts)
│   ├── exports/ (NEW)            (IC memo / top-10 / etc. template renderers)
│   └── swarm/ (NEW)              (Claude-native agent simulation)
│
├── functions/                    (retained; Phase 6 callables remain here)
│
├── services/ (NEW)               (Cloud Run jobs — long-running work)
│   ├── ingest/                   (Phase 1 OCR + classification)
│   ├── extract-worker/           (Phase 3 per-doc workers)
│   ├── scenario-runner/          (Phase 6 swarm execution)
│   └── export-renderer/          (Phase 7 PDF/DOCX/XLSX rendering)
│
├── firebase.json                 (retained; + new runtime configs)
├── firestore.rules               (retained; heavily rewritten for new collections)
└── firestore.indexes.json        (retained; expanded indexes)
```

### 6.1 Subsystem boundaries

**Functions (short, synchronous work)** — all the `onCall` handlers: start deal, approve finding, generate follow-up, export. These are user-facing callables that return in <60s.

**Services (long-running work)** — OCR, extraction per-workstream, scenario runs. These run on Cloud Run Jobs or Cloud Tasks; communicate status via Firestore; are invoked by Functions but never awaited by them.

**Packages (pure logic, no infra)** — shared types, rules, extractors' prompts and schemas, export template definitions, swarm engine logic. These are the files engineers edit day-to-day.

**Apps** — web (the customer-facing SPA), and a new thin admin app for ops to manage rule activations, impersonate for support, and review audit logs.

### 6.2 What carries over from Builds 1–2

- `packages/shared/src/schemas.ts` — the base `UserProfile` pattern survives, re-scoped to `teams`. `Simulation` is deleted.
- `packages/shared/src/plans.ts` — deleted. Replaced by `packages/shared/src/subscriptions.ts`.
- `packages/shared/src/stressTests.ts` — **retained**. The 13-test taxonomy lives inside Phase 6 scenario testing.
- `functions/src/clients/claude.ts` — **retained and extended.** The `AnthropicClaudeClient`, structured output via `tool_use`, streaming, and retry logic all survive. New prompts are added to `functions/src/prompts/` for the new phases.
- `functions/src/lib/admin.ts`, `errors.ts`, `secrets.ts` — retained.
- `functions/src/lib/credits.ts` — **deleted.** Replaced by quota-based entitlement checks in `lib/entitlements.ts`.
- `functions/src/auth/onUserCreate.ts` — retained, extended to auto-create a personal team on first login.
- `apps/web/src/index.css` — retained. Design tokens (Inter / Space Grotesk / JetBrains Mono / border-thin / black-on-white) are the product identity.
- `apps/web/src/App.tsx`, sidebar, dashboard shell — conceptually retained, but the word "simulation" is replaced by "deal" and the New Simulation button becomes New Deal.

---

## 7. The Finding Object — State Machine

Findings are the center of gravity. Their state machine drives the issue tracker UX.

```
                  Detection (Phase 4)
                         │
                         ▼
                       ┌────┐
                       │Open│◄─────────┐
                       └─┬──┘          │
                         │ analyst     │
                         ▼             │
                  ┌──────────────┐     │
                  │ Under Review │     │
                  └─┬─────────┬──┘     │
                    │         │        │
          ┌─────────┘         └────────┼─────┐
          ▼                            ▼     ▼
  ┌──────────────┐              ┌──────────┐ ┌───────────┐
  │   Resolved   │              │Dismissed │ │ Needs Seller│
  │              │              │(rationale│ │  Response   │
  │(rationale    │              │ required)│ │             │
  │ optional)    │              │          │ │             │
  └──────┬───────┘              └─────┬────┘ └──────┬──────┘
         │                            │             │
         └──► audit log ◄──────────────┴────────────┘
                 │
                 ▼
              immutable
```

**Rules:**
- Status transitions write to `auditLog` atomically (Firestore transaction).
- Dismissal requires a free-text rationale stored on the audit event.
- Escalation is a status change to `Under Review` with owner reassignment.
- Once a Finding is linked to a scenario (Phase 6), the scenario's `quantifiedImpact` populates the Finding's `quantifiedImpact` field. Findings can have at most one scenario link per version.
- Severity and `dealImpactTag` can be changed by analysts; every change is audit-logged.

---

## 8. Claude-Native Swarm (Phase 6)

This is the Path B work, re-scoped to Phase 6 only. It's no longer the product's hero feature; it's an on-demand capability reached from a specific Finding.

### 8.1 What changes from Path B's original scope

- Triggered per-Finding, not per-simulation. User clicks "Stress test this" on a customer-concentration finding → swarm runs scenario-aligned personas → basis-point impact returns attached to the finding.
- Scenario context is narrower (one risk, not a user-authored prose scenario). This makes persona archetype selection easier and outputs more focused.
- GPT-4o does batched persona generation (per your decision #1). Claude Sonnet does agent-turn reasoning. Claude Opus synthesizes the final quantified impact.
- The 13-test taxonomy from v5.0 is preserved; one test type is auto-selected per Finding's workstream (e.g. a customer-concentration finding triggers a Concentration Risk test).

### 8.2 Three-stage swarm flow

1. **Scenario setup (seconds).** Claude Opus reads the Finding and selects the test type from the taxonomy, drafts the agent archetype distribution, and sets rounds/persona count from complexity tier.
2. **Persona batch (tens of seconds).** GPT-4o generates 100/500/1000 personas in parallel batches of 50 per call. Each persona has archetype, role, traits, mandate-specific motivations. PE-specific archetypes (institutional LP, debt holder, portfolio manager, secondary buyer, etc.) are used.
3. **Agent-turn loop (minutes).** For N rounds (3/5/10 by tier), every persona acts in parallel each round. Each agent-turn is a Claude Sonnet call: given the scenario, the current shared state, and a summary of peer actions last round, emit a structured action (stance, confidence, rationale, optional signal to another archetype). End of round aggregates actions into updated state. At the end of N rounds, Claude Opus synthesizes convergence data into `quantifiedImpact`.

### 8.3 Cost and performance

Per your Path B pricing confirmation (option 1), credit costs for scenarios:
- Low (100 personas × 3 rounds): ~$0.90 Claude + small OpenAI persona cost ≈ **$1.20 total**
- Medium (500 × 5): ~$7.50 + persona ≈ **$9.00 total**
- High (1000 × 10): ~$30 + persona ≈ **$33 total**

Scenario runs are not separately credited — they're included in the Professional and Enterprise tiers as part of the deal quota. Starter tier doesn't include scenarios.

### 8.4 Infrastructure

- **Low tier:** runs in a single Cloud Functions callable (within 9-min budget).
- **Medium/High tier:** kicks off a Cloud Run Job via Cloud Tasks; writes progress to Firestore every 10s; client polls via `onSnapshot` as before.

---

## 9. Trust, Audit, and Permissions

Non-negotiable at $30K ACV. Built into the foundation, not bolted on.

### 9.1 Evidence chain (bidirectional linking)

Every Finding references its source documents at `(docId, pageNum, clauseRef, snippet)`. Every Document can retrieve the list of Findings that reference it. The link survives exports — IC memos show "Source: Contract_X.pdf p.14" and the PDF reader on that document shows the annotation.

Implementation: `findings.sourceDocuments[]` stores forward links. A denormalized `documents/{docId}.linkedFindings[]` stores reverse links, maintained by a Cloud Functions trigger on Finding create/update.

### 9.2 Audit log

Every mutation is an event in `deals/{dealId}/auditLog/{eventId}`. Events are immutable (Firestore rules forbid update and delete). Event types: `CREATE`, `STATUS_CHANGE`, `OWNER_ASSIGN`, `SEVERITY_CHANGE`, `IMPACT_TAG_CHANGE`, `DISMISS` (with rationale), `EXPORT`, `VIEW` (exports and sensitive docs only). Each event captures actor, role, timestamp, before/after diff, and IP/session metadata.

The audit UI surfaces the log as a filterable timeline per deal. Exports include a cryptographic hash of the log state at export time.

### 9.3 Role-based access control

Four roles defined at the team/deal level:

| Role | Permissions |
|---|---|
| Partner | Full access on their deals. Can assign any other role to team members per-deal. Can approve/dismiss/export. |
| Associate | Create, edit, approve/dismiss findings. Cannot export final IC-ready deliverables. Cannot manage team. |
| External Counsel / Consultant | Read-only on assigned deals, plus comment on findings. Cannot see billing or the rest of the team's deals. |
| Observer | Read-only. Cannot comment. |

SSO/SAML for Enterprise tier authenticates against the firm's IdP; roles still enforced at the deal level.

### 9.4 Data isolation

Per-deal workspace isolation is enforced at the Firestore rules layer. No query can ever cross deals; users are explicit members of deals they can access. Cross-deal reporting (portfolio monitoring, Enterprise tier only) uses Cloud Functions with admin-SDK escalation, never direct client queries.

### 9.5 SOC 2-ready posture (2-week v1 budget)

What we build in v1:
- Access logs for all data reads (in addition to mutations).
- Encryption at rest (Firestore default) and in transit (TLS).
- Per-deal encryption keys via Google Cloud KMS — one key per deal, key rotation supported.
- Documented controls for change management, access provisioning, and incident response (in `docs/soc2/`).
- Third-party vendor list with DPAs (Anthropic, OpenAI, Google, Stripe).

What we defer to post-v1:
- Actual Type II audit (6-month observation period, audit firm engagement).
- Penetration testing.
- SOC 2 bridge letter process.

---

## 10. Pricing and Entitlements

Per the Source of Truth § 10. Pricing replaces the per-user credit model from Builds 1–2.

| | Starter ($10K) | Professional ($30K) | Enterprise ($75K+) |
|---|---|---|---|
| Deals per year | 3 | 10–20 | Unlimited |
| Seats | 5 | Unlimited (fair use) | Unlimited + SSO |
| Workstreams | Legal + Financial | All 9 | All + custom |
| Red-flag library | Default | Default + firm rules | Fully custom |
| Scenario testing | No | Up to 500 personas | Up to 1000 personas |
| Exports | PDF | PDF + Word + Excel | + API |
| Integrations | Manual upload | SharePoint + Drive + Dropbox + VDRs | + custom API |
| Portfolio monitoring | No | No | Yes |
| Onboarding | Self-serve | White-glove first deal | CSM + SLA |

Billing: annual subscriptions via Stripe. Usage tracked as `dealsUsedThisYear` against `dealsIncluded`. Overage policy for v1: deals beyond quota are blocked with a "contact sales to upgrade" modal. No metered overage for v1.

---

## 11. Build Plan — Phase A through H

The build is 10–12 weeks with 2–3 engineers, 16 weeks serial. Each build (A–H) is an independent, shippable milestone.

### Build 0 — Foundation Pivot (1 week)
**Goal:** The v1/v2 codebase compiles under the v6.0 schema. No new product behavior.

Work:
- Rename `simulations` → `deals` throughout.
- Replace `packages/shared/src/plans.ts` → `subscriptions.ts`. Delete `credits.ts`, `usage_events` types.
- Rewrite `firestore.rules` against new collections.
- Retire the simulation form and results view. Stub them with "coming in Build X."
- New sidebar primary CTA: "New Deal."
- Deal Archive page replaces Simulation Archive (same visual pattern, new labels).

Deliverable: empty Deal Workspace UI, auth and billing-spine plumbing intact, nothing functional in any phase yet.

### Build A — Deal Workspace + Setup Wizard (1 week)
**Goal:** Users can create a deal and enter its context metadata.

Work:
- New Deal Setup Wizard (sector, size, structure, geography, target workstreams).
- Deal Workspace shell with phase-status progression indicators.
- `teams/` collection, team creation on first login, team invitation flow.
- Subscription entitlement checks (deals per year).

Deliverable: usable deal-creation flow. No document ingestion yet.

### Build B — Document Ingestion (2 weeks)
**Goal:** Phase 1 end-to-end.

Work:
- Bulk upload UI with folder recognition, progress panel.
- Cloud Run ingest service: Google Document AI OCR, classification via Claude Sonnet, dedup by hash.
- `documents/{docId}` Firestore writes with workstream tags.
- **Deferred to Build B2 (later):** VDR integrations (Intralinks, Datasite, Firmex) and SharePoint/Drive/Dropbox OAuth flows. Manual upload ships in Build B.

Deliverable: users can upload a data room and see classified documents appear in the workspace.

### Build B2 — VDR + Cloud Storage Integrations (1 week)
**Goal:** Integrations that weren't in Build B.

Work:
- OAuth flows for SharePoint, Drive, Dropbox (shared abstraction).
- VDR connectors for Intralinks, Datasite, Firmex (each provider requires their own SDK).

Deliverable: one-click import from VDR or cloud storage.

### Build C — Extraction + Detection (3 weeks)
**Goal:** Phases 2, 3, 4 end-to-end.

Week 1: Phase 2 contextual research. Active-rule selection based on deal context.
Week 2: Nine workstream extractors — shared schema, per-workstream prompts, parallel Cloud Run workers.
Week 3: Red-flag detection — rule library in `packages/rules/`, LLM pattern layer, Finding object materialization.

Deliverable: users see findings populate in the issue tracker after document ingestion.

### Build D — Issue Tracker, Evidence Viewer, Human Review (2 weeks)
**Goal:** Findings are actionable.

Week 1: Issue tracker UI (workstream-grouped, filterable, bulk actions, status lifecycle).
Week 2: Evidence viewer (split-pane document rendering — PDF and DOCX support via `pdf.js` and `mammoth`). Approval / dismissal / escalation flow. Audit log wiring.

Deliverable: a deal team can triage findings to completion.

### Build E — Follow-Ups and Exports (2 weeks)
**Goal:** Phases 5 and 7.

Week 1: Follow-up generator (Phase 5). Editable list view, per-item status, send-to-seller workflow.
Week 2: Export renderers (Phase 7). Cloud Run service. Seven templates across PDF / DOCX / XLSX.

Deliverable: IC-ready deliverables on one click.

### Build F — Scenario Testing Swarm (2 weeks)
**Goal:** Phase 6 — the Claude-native swarm.

Week 1: Swarm engine in `packages/swarm/` — scenario setup, GPT-4o persona batches, agent-turn loop, Claude Sonnet driving per-turn reasoning, Claude Opus synthesis.
Week 2: Cloud Run scenario-runner service. Integration into Finding detail panel ("Stress test this" button). WebGL visualization of the running swarm.

Deliverable: analysts can quantify deal impact for any flagged finding.

### Build G — Trust, Audit, Permissions (2 weeks)
**Goal:** Enterprise-grade controls threaded through everything above.

Week 1: Audit log infrastructure, `auditLog/` subcollection, access-event logging for document reads and exports, immutability rules. Per-deal encryption keys via Cloud KMS.
Week 2: Role-based access control (four roles), team invitations, SSO/SAML integration for Enterprise tier, per-deal permission overrides.

Deliverable: SOC 2-ready posture documented in `docs/soc2/`.

### Build H — Billing, Onboarding, Polish (2 weeks)
**Goal:** Commercially launchable.

Week 1: Stripe integration for three-tier annual subscriptions; entitlement enforcement (deals-per-year, seats, feature gates); overage block modals.
Week 2: Onboarding flow, first-deal white-glove mode, admin app (`apps/admin/`) for ops, support impersonation, final QA sweep.

Deliverable: v1 launch-ready.

### Build I (post-launch) — SOC 2 Type II and Type II audit observation period

Not in the v1 budget. Separate engagement with an audit firm; six-month observation period; penetration testing; remediations.

---

## 12. Open Questions Deferred to Each Build

These are smaller decisions that don't block the architecture but need answers before the build they affect.

- **Build B:** Preferred ingestion cost ceiling per deal? (Google Document AI is ~$1.50 per 1000 pages, so a 1000-doc data room is ~$1.50–$15.00 of OCR cost.)
- **Build C:** Rule library format — pure TS expressions, or a DSL authors can edit without deploying? Answer shapes whether rule editing is a post-v1 capability or v1.
- **Build E:** IC memo template style — does the firm you're selling to have a preferred template we should match, or do we design a clean house style?
- **Build F:** Does the swarm's quantified impact render as a distribution (e.g., "15–22% EBITDA impact at 80% confidence") or a point estimate? Materiality matters here — distributions are more honest but harder to show in an IC slide.
- **Build H:** Free trial / demo deal included? If yes, what's the mechanism — a seeded sample data room?

---

## 13. What I Need From You Before Shipping Code

Three items.

**1. Confirm the build sequence.** Do A through H as ordered above, or do you want to reorder — e.g., push VDR integrations (B2) earlier to unblock sales demos, or pull scenario testing (F) earlier as a marketing differentiator?

**2. Team shape.** Is this a solo build, a two-engineer team, or a three-engineer team? If solo, the 10–12 week estimate stretches to 16–18 weeks. If three, we can parallelize Builds C (extraction) and D (UI) and Build F (swarm) somewhat.

**3. Build 0 green light.** Build 0 (foundation pivot) is the smallest and most contained. It renames and restructures Builds 1–2 under the new schema without introducing any new product behavior. It's the right next step regardless of everything else and unblocks every subsequent build.

Say "start Build 0" and I'll begin with the rename, schema rewrite, and security rules update in the next turn. Say "revise the plan" if anything in this document is wrong or needs adjusting.
