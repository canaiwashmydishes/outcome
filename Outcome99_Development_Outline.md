# Outcome99 — Full Development Outline

**Version:** 1.0
**Source Documents:** `Outcome99_Source_Of_Truth_V5.pdf`, `Outcome99_AIStudio_Mockup_Files.zip`
**Scope:** Convert the AI Studio mockup into a production-grade, multi-tenant SaaS web application for Private Equity stress-test simulation, backed by Claude + Claude Opus + MiroFish, Google auth, and a monthly credit system with top-ups.

---

## 1. Product Summary

Outcome99 is a professional stress-testing terminal for Private Equity. A user describes a scenario (historical, hypothetical, liquidity, leverage, reverse, etc.), the system spins up a **MiroFish swarm** of 100–1000 synthetic personas, those personas interact under the scenario constraints, and the platform returns institutional-grade output: NAV trajectories, VaR/CVaR, Valley-of-Death cashflow curves, sensitivity tornadoes, and an executive synthesis report. The professional can then cross-examine the results through an "Oracle" chat layer that has full context of the swarm.

The product is gated behind Google SSO and metered by a monthly credit allowance, with in-app top-up purchases.

---

## 2. Technology Stack

The stack extends what is already in the mockup rather than replacing it, so the visual layer carries over cleanly.

**Frontend:** React 19, Vite, TypeScript, Tailwind v4 (keep the existing `border-thin` / Inter / Space Grotesk / Mono palette verbatim — it is the product identity), Motion for transitions, Lucide icons, React Markdown for report rendering, D3 and/or three.js for the WebGL swarm canvas (replacing the current 40-particle Canvas 2D implementation), Recharts for tornado/NAV/VaR charts.

**Backend:** Firebase — Firestore for the primary data store, Firebase Auth with Google provider, Cloud Functions (2nd gen, Node 20) for all privileged operations (LLM calls, MiroFish orchestration, credit accounting, Stripe webhooks), Firebase Storage for user-uploaded `.xlsx` portfolio data and exported PDF reports, App Check to block bot traffic.

**LLM layer:** Anthropic SDK (`@anthropic-ai/sdk`) for both `claude-sonnet-4-6` (fast batched persona generation, Oracle chat) and `claude-opus-4-7` (Phase 1 contextual research, Phase 4 synthesis — these are the reasoning-heavy phases where Opus earns its premium). The PDF's reference to "Claude 3.5 Opus / GPT-4o" is treated as a starting pattern; the production build uses Claude-only tiering as requested.

**Swarm engine:** MiroFish. The integration approach depends on what MiroFish provides (open question — see §13). The plan below assumes an HTTPS API surface; if it is a self-hosted package, it runs on Cloud Run with a gRPC or REST interface invoked from Cloud Functions.

**Payments:** Stripe — subscriptions for monthly plans, Checkout Sessions for credit top-ups, webhooks for entitlement updates.

**Hosting:** Firebase Hosting for the SPA, Cloud Run for any long-running swarm orchestration that exceeds the 9-minute Cloud Functions limit.

**Observability:** Firebase Performance, Cloud Logging, Sentry for client-side errors, a lightweight `usage_events` Firestore collection as the source of truth for credit consumption audits.

---

## 3. System Architecture

At a high level the request path is: browser → Firebase Auth token → Cloud Functions endpoint → credit check → LLM / MiroFish fan-out → Firestore write → real-time listener update back in the browser.

Nothing user-facing ever holds an API key. The existing mockup pattern of calling `generateAnalysis` from the client (`src/lib/gemini.ts`) is replaced by a thin `callFunction("runPhaseN", {...})` wrapper. This is non-negotiable for security and for the credit system — credit debits must happen server-side, inside the same transaction that initiates the billable work.

The four pipeline phases from the Source of Truth map one-to-one onto four Cloud Functions, each of which writes its output to the simulation document and updates `status`. The client subscribes via `onSnapshot` and re-renders as each phase completes, which preserves the live-update feel of the mockup.

---

## 4. Core Integrations

### 4.1 Claude (Sonnet 4.6) + Claude Opus 4.7

Phase 1 (Contextual Research) and Phase 4 (Synthesis) use **Opus 4.7**. These are the phases where reasoning quality dominates cost — mapping a qualitative scenario to the 13-test taxonomy, generating research queries, and synthesizing a swarm of 1,000 interactions into a professional report are exactly the tasks Opus is best at.

Phase 2 (Identity Generation) and the Oracle chat use **Sonnet 4.6**. Persona generation is a batching problem — 100–1000 structured JSON objects — and Sonnet's speed and cost profile make it the right tier. The Oracle is a conversational follow-up layer where latency matters more than peak reasoning.

Implementation notes: use `response_format` style structured output with strict JSON schemas for persona arrays and risk tables, because the mockup's current `replace(/```json|```/g, '')` string-munging is brittle. Stream Opus synthesis back to the client for the report tab so users see it build live. Keep the system prompts versioned in `functions/src/prompts/` — prompts are product code and should be code-reviewed.

### 4.2 MiroFish Swarm Engine

MiroFish consumes the persona array from Phase 2 plus the scenario context and runs the high-concurrency interactions described in the PDF ("billions of human-to-human preference interactions" per the SimulationView.tsx language). It returns convergence data — an aggregated state after the swarm has stabilized — which Phase 4 then synthesizes into financial metrics.

Until the MiroFish interface is confirmed, the integration is abstracted behind a `SwarmClient` interface with methods `submit(scenario, personas) → jobId`, `poll(jobId) → status | result`, and `stream(jobId) → progress events`. This lets the build proceed with a mock implementation and swap in the real one without touching the rest of the pipeline.

### 4.3 Google Auth

Already wired in the mockup via `GoogleAuthProvider` + `signInWithPopup`. Production hardening adds: restricting authorized domains in the Firebase console, enforcing email verification, and gating the `users/{uid}` document creation through a Cloud Function trigger that seeds the user's initial credit balance and default plan. Optionally add Google Workspace domain restrictions for enterprise tenants later.

---

## 5. Credit System

The credit system is the commercial spine of the product. Everything bills through it.

**Units.** One "credit" corresponds to a bounded unit of work. A simulation costs credits based on its complexity tier, which matches the PDF's scalable identity architecture:

| Complexity | Persona count | Indicative credit cost |
|---|---|---|
| Low | 100 | ~10 credits |
| Medium | 500 | ~40 credits |
| High | 1,000+ | ~100 credits |

Oracle chat messages cost a small fraction of a credit each (roughly 0.5–1 depending on token consumption). Final pricing calibration is a business decision and should be set after running a week of usage telemetry on beta users — the numbers above are defensible defaults, not final.

**Monthly entitlement.** Each plan grants a monthly credit allowance that resets on the billing anniversary. Unused credits do not roll over by default (standard SaaS pattern, simpler accounting), but this is a policy toggle in the `plans` collection.

**Top-ups.** Users can purchase credit packs outside the subscription cycle via Stripe Checkout. Purchased credits are non-expiring and are consumed *after* the monthly allowance is exhausted (monthly-first policy keeps accounting clean and avoids users hoarding paid credits).

**Atomicity.** Before any billable operation starts, the initiating Cloud Function runs a Firestore transaction that (1) reads the user's current balance, (2) refuses the operation if insufficient, (3) debits the projected cost, and (4) writes a `usage_events` record. If the underlying job fails, a reconciliation refund is issued. This prevents the race condition where two parallel simulation submissions could both pass the balance check and overspend.

**Plans.** A sensible starting tier structure: Free (25 credits/month, Low complexity only, email watermark on reports), Professional (500/month, all complexities, PDF export), Team (2,500/month, shared workspace, multi-seat), Enterprise (custom, with SSO and usage-based billing).

**Stripe surface.** Products and prices defined in Stripe Dashboard, mirrored into Firestore via the Stripe Firebase Extension or custom webhook handler. Events to handle: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded`, `invoice.payment_failed` (soft-lock the account, don't hard-delete).

---

## 6. Data Model (Firestore)

The mockup already has `simulations/{simId}` and a `messages` subcollection. The production schema expands this.

`users/{uid}` holds profile, plan reference, Stripe customer ID, current credit balance (split into `monthlyCredits` and `purchasedCredits`), `monthlyResetAt` timestamp, and role for team support. Never expose or trust client writes to this document — all mutations go through Cloud Functions.

`simulations/{simId}` keeps the existing shape (`name`, `testType`, `inputs`, `scenarioDescription`, `status`, `researchData`, `agents[]`, `results`, `riskAnalysis[]`, `report`, `createdAt`) and adds `ownerId`, `complexityTier`, `personaCount`, `creditsCharged`, `miroFishJobId`, `phase1CompletedAt`, `phase2CompletedAt`, `phase3CompletedAt`, `phase4CompletedAt` for observability.

`simulations/{simId}/messages/{msgId}` remains as in the mockup for Oracle chat.

`usage_events/{eventId}` is a ledger: `{uid, type: 'simulation' | 'oracle_message' | 'top_up_purchase' | 'monthly_reset', credits: ±N, simId?, stripeEventId?, createdAt}`. This is the auditable source of truth; the balance on `users/{uid}` is a materialized view of these events and can be rebuilt from them.

`plans/{planId}` is config (credit allowance, feature flags, Stripe price IDs). Editable by admins only.

`stripe_webhook_events/{eventId}` stores processed webhook IDs for idempotency.

The mockup's `firestore.rules` file already has a solid pattern and extends naturally: keep `isOwner` and `isValidSimulation`, add rules forbidding client writes to `users/{uid}` credit fields, `usage_events`, and `plans`. All credit-adjacent writes happen server-side with admin SDK.

---

## 7. Pipeline Implementation (The 4 Phases)

Each phase is a Cloud Function. The client writes a `simulations/{simId}` document with `status: 'draft'`, then invokes `startSimulation(simId)`. That function runs the credit check, then orchestrates the four phases.

**Phase 1 — Contextual Research (Claude Opus 4.7).** Input: scenario description, selected test type, user inputs. Output: the structured "preliminary inquiries" list (5 research questions per the mockup), a mapping from the free-form scenario to the stress-test taxonomy, and a specification for the persona archetype distribution (e.g., "30% institutional LPs, 40% retail consumers, 20% debt holders, 10% regulators"). Writes `status: 'researching'` then `researchData` on completion.

**Phase 2 — Identity Generation (Claude Sonnet 4.6, batched).** Input: archetype spec from Phase 1, target persona count from the complexity tier. Output: array of N persona objects matching the schema already in `firebase-blueprint.json` (name, role, persona, traits, preferences, influence placeholder). Batched in groups of ~50 per request with `Promise.all` for parallelism. Writes `agents[]` as it streams in, so the client can show the swarm populating in real time.

**Phase 3 — Swarm Execution (MiroFish).** Submits personas + scenario to MiroFish, polls for progress, streams progress events to the client via a Firestore `progress` field that the UI animates. This is the phase that replaces the current `setProgress(i)` mock loop in `SimulationView.tsx`. On completion, the raw convergence data is stored (not shown to the user) for Phase 4 to consume.

**Phase 4 — Synthesis (Claude Opus 4.7, streaming).** Input: Phase 3 convergence data, Phase 1 taxonomy mapping, user's original scenario. Output: the four artifacts the UI already expects — `numericalResults` keyed to the taxonomy's output variables, `riskAnalysis[]` (exactly 4 items per mockup spec), `report` (streamed markdown), and finalized `agents[]` with computed `influence` percentages. On completion, sets `status: 'completed'` and the client's tabbed results view becomes fully populated.

Fail-fast behavior: any phase that errors refunds credits, marks `status: 'failed'` with a `failureReason`, and the UI shows a retry button that re-runs from the failed phase onward without re-charging.

---

## 8. UI/UX Workflow

The mockup's UX is strong and should be preserved intact. The workflow (Dashboard → Input Configuration → Simulation Engine with tabbed results) is the product. Changes are additive.

**Branding:** Rename every "APEX" reference to "Outcome99" across `App.tsx`, `index.html`, and `metadata.json`. Keep the `border-thin` / black-on-white / Inter + Space Grotesk + Mono palette exactly as specified in the PDF.

**New UI surfaces to add:**

A **credit badge** in the sidebar above the logout button showing current monthly + purchased balance, with a progress bar against the monthly allowance. It links to the Billing view.

A **Billing view** (`/billing`) with three panels: current plan and reset date, a usage history table sourced from `usage_events`, and credit pack top-up tiles that open Stripe Checkout. This is a new top-level route — add it to the nav alongside Dashboard / Input Configuration.

A **pre-flight credit confirmation modal** before the "Initiate Swarm" button in `SimulationForm.tsx`. It displays the complexity tier, persona count, projected credit cost, and post-simulation balance. The Source of Truth PDF's emphasis on scalable identity architecture means the complexity tier selection needs to be surfaced here — either inferred from scenario complexity (Opus makes the call during Phase 1 pre-check) or let the user override.

An **empty-balance gate** — if the user's projected cost exceeds their balance, the modal swaps to a top-up prompt.

**Swarm visualization upgrade.** The current 40-particle canvas is a stand-in. Rebuild with three.js or WebGL to render the actual persona count (up to 1000 nodes), color-coded by archetype, with edges drawn when MiroFish reports interaction events between nodes. This is the visual centerpiece of the product and worth investing in.

Everything else — the stepped form, the tabbed results (Synthesis / Explorer / Risks / Oracle), the Agent Identity Card slide-up panel — carries over unchanged.

---

## 9. API Surface (Cloud Functions)

The callable function surface is intentionally small. All of these are HTTPS callable functions with App Check enforcement.

`onUserCreate` (Auth trigger) — seeds `users/{uid}` with the Free plan and initial credits.

`startSimulation({simId})` — runs the credit pre-check, kicks off Phase 1, returns immediately. The rest of the pipeline runs in background Cloud Tasks to avoid client timeout.

`sendOracleMessage({simId, message})` — debits a fractional credit, calls Sonnet with the full simulation context already assembled in `SimulationView.tsx`'s current context block, writes the response to the messages subcollection.

`createCheckoutSession({priceId, type: 'subscription' | 'topup'})` — returns a Stripe Checkout URL.

`stripeWebhook` (HTTPS, not callable) — handles subscription lifecycle and top-up fulfillment, idempotent via `stripe_webhook_events`.

`exportReport({simId, format: 'pdf' | 'docx'})` — generates a branded report from the `report` markdown + `results` + `riskAnalysis`. Free tier gets watermarked output; paid tiers get clean exports.

`resetMonthlyCredits` (scheduled, daily) — iterates users whose `monthlyResetAt` has passed, resets their monthly balance, writes a `usage_events` record.

`retrySimulationPhase({simId, fromPhase})` — restart a failed simulation from a specific phase without re-charging the successful phases.

---

## 10. Development Roadmap

A realistic build plan assumes two engineers and a ten-week timeline to a production beta.

**Weeks 1–2 — Foundation.** Set up the production Firebase project (separate from the AI Studio dev one), wire up App Check, migrate the existing mockup code, rename APEX → Outcome99, replace all Gemini calls with stub Cloud Functions that return fixtures, establish the prompt versioning structure in `functions/src/prompts/`, set up Stripe in test mode.

**Weeks 3–4 — Claude integration.** Build Phase 1 (Opus research) and Phase 2 (Sonnet batched personas) behind Cloud Functions, replace the mockup's client-side generation path, add structured output schemas, implement streaming for the report generation. Phase 4 synthesis can also be built against a mocked Phase 3 output at this stage.

**Weeks 5–6 — MiroFish integration and swarm visualization.** Implement the `SwarmClient` abstraction, wire in the real MiroFish API, rebuild the swarm canvas with WebGL rendering at 100/500/1000 node scales, stream progress from MiroFish back to the client.

**Weeks 7–8 — Credit system and Stripe.** Build `users/{uid}` schema, transactional credit debits, the `usage_events` ledger, the Billing view, Stripe Checkout for both subscriptions and top-ups, webhook handlers, the pre-flight credit modal, the scheduled monthly reset job.

**Week 9 — Polish and hardening.** Firestore rules review, App Check enforcement, rate limiting on Oracle chat, error boundary UI, PDF export, onboarding flow for first-time users, empty states.

**Week 10 — Beta and telemetry.** Deploy to staging with a closed beta group, instrument the `usage_events` telemetry, calibrate credit costs against real usage, fix the first wave of production issues.

A Phase 2 post-beta roadmap covers team/multi-seat support, SSO beyond Google (Okta / SAML for enterprise), annual billing, usage analytics dashboard for users, a Slack integration for simulation alerts, and API access for programmatic simulation submission.

---

## 11. Security and Compliance

PE data is sensitive. The design assumptions: never store uploaded portfolio files unencrypted, never pass PII to LLMs in the clear, and maintain an audit trail.

**API keys** live in Secret Manager, never in `.env` files committed to source or shipped to the client. The mockup's `firebase-applet-config.json` approach of committing the Firebase web config is fine (those keys are public identifiers), but the Anthropic, MiroFish, and Stripe keys are strictly server-side.

**Firestore rules** default-deny everything, then allow reads/writes based on the `isOwner` pattern already in the mockup. Credit-bearing fields on `users/{uid}` are server-write-only.

**App Check** (reCAPTCHA v3 for web) blocks scraped clients from hitting Cloud Functions directly.

**Rate limiting** on Oracle chat (e.g., 30 messages per simulation per hour) prevents credit-drain attacks even from authenticated users.

**Audit trail** is the `usage_events` ledger — every credit movement is recorded with its cause, enabling both user-facing usage history and internal financial audits.

**Privacy:** user-uploaded `.xlsx` portfolio files are stored in Firebase Storage under per-user paths with IAM enforcement, and are not sent to Claude or MiroFish unless the user explicitly opts in on a per-simulation basis. For enterprise tenants, offer a data-processing agreement and zero-retention configuration with Anthropic.

**Compliance posture:** SOC 2 Type II is the obvious target for enterprise sales but is out of scope for beta. GDPR / CCPA deletion flows should be built into the Cloud Functions surface from day one (a `deleteUserAccount` function that scrubs all documents and Storage objects) — retrofitting this later is painful.

---

## 12. Testing and QA

Unit tests on Cloud Functions with Jest, covering the credit transaction logic (the highest-risk code in the system) with property-based tests for atomicity. Integration tests using the Firebase Emulator Suite for end-to-end simulation flows against mocked LLM/MiroFish responses. Visual regression on the tabbed results views using Playwright + percy-style snapshots, since the design is as much a product feature as the logic.

LLM output testing is its own category: maintain a golden-output suite of scenario inputs and assert that Phase 4 synthesis contains the expected output variables from the taxonomy table, without asserting exact text (which will vary). This catches prompt regressions without being brittle.

---

## 13. Open Questions Requiring Decisions

Before implementation starts, these need answers from the product owner.

**MiroFish interface.** Is MiroFish an HTTPS API, an SDK, a self-hosted container, or something else? The Source of Truth PDF references a "MiroFish GitHub Repository" but no endpoint spec. The answer changes the infrastructure footprint (Cloud Run vs simple function calls) and the latency profile.

**Credit calibration.** The indicative costs above (10 / 40 / 100 per complexity tier) are engineering defaults. Final pricing needs a business input — target revenue per user, expected monthly volume, margin over Anthropic + MiroFish costs.

**Plan structure.** The Free/Professional/Team/Enterprise tiers are a starting point. Does the product want a freemium hook (generous free tier) or a professional-only positioning (free tier is trial-only)?

**Complexity tier assignment.** Should the user pick Low/Medium/High explicitly, or should Claude Opus infer it from the scenario in Phase 1? The mockup doesn't expose complexity — defaulting to inferred is more elegant but removes user control over cost.

**Team features in v1.** The PDF doesn't mention multi-seat but Team/Enterprise sales almost always require it. Is shared workspace collaboration in scope for the v1 launch or for the post-beta roadmap?

**Report export formats.** PDF is the obvious professional format. Is Word/docx also required? Excel export of the `results` and `riskAnalysis` tables?

**Data residency.** Any enterprise PE firm will ask where their scenario data lives. Firebase defaults to US multi-region — is a EU / APAC option needed, and if so when?

**Brand name.** The repo says "APEX Stress Test Simulation Tool" and the PDF says "Outcome99." Confirming the external brand locks down domain, logo, and marketing copy work that otherwise blocks launch.

---

## 14. Deliverable Summary

At the end of the build the product consists of: a Firebase-hosted React SPA visually identical to the AI Studio mockup but rebranded and credit-gated, a Cloud Functions backend orchestrating Claude Opus 4.7 + Claude Sonnet 4.6 + MiroFish across the four-phase pipeline, a Stripe-backed monthly credit system with top-ups, Google SSO with per-user credit ledgers, a WebGL swarm visualization scaling to 1000 personas, and a tabbed results surface (Synthesis / Explorer / Risks / Oracle) matching the PDF's UI specification.

Everything in the mockup that is good stays. Everything that is a stub (client-side LLM calls, 40-particle swarm, missing billing) becomes real.
