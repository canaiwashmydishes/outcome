# Outcome99 — Build 0 Handoff

**Build 0 — Foundation Pivot.** The v1/v2 codebase has been mechanically restructured under the v6.0 schema. No new product behavior. This build is the compilation-ready foundation that every subsequent build (A through H) sits on.

51 source files, 62 KB zipped. Down from Build 2's 64 files — the v5.0 simulation-first surface is gone, replaced by a slimmer v6.0 shell.

---

## What changed

### Deleted (v5.0-shaped)

- `packages/shared/src/plans.ts` — per-user credit plans
- `packages/shared/src/schemas.ts` — v5.0 types (`Simulation`, `OracleMessage`, credit fields on `UserProfile`)
- `functions/src/simulations/` — entire directory (pipeline, callables, retry)
- `functions/src/billing/` — entire directory (checkout, webhook stub, monthly reset)
- `functions/src/lib/credits.ts` — atomic debit/refund
- `functions/src/lib/complexity.ts` — tier inference
- `functions/src/clients/mirofish.ts` — Phase 6 goes Claude-native in Build F
- `apps/web/src/components/` — `BillingView`, `CreditBadge`, `Dashboard`, `PreflightModal`, `SimulationForm`, `SimulationView`, `SwarmVisualization`
- `apps/web/src/hooks/useSimulations.ts`

### Rewritten

- `packages/shared/src/schemas.ts` — v6.0 types: `Deal`, `DealDocument`, `Issue`, `Finding`, `Followup`, `Scenario`, `Export`, `DealMessage`, `AuditEvent`, `Team`, `TeamMember`, `Subscription`, trimmed `UserProfile`
- `packages/shared/src/subscriptions.ts` — three-tier annual plans (Starter $10K / Professional $30K / Enterprise $75K+) replacing credit packs
- `firestore.rules` — team-scoped, write-once audit, server-only mutations on credit-bearing paths
- `firestore.indexes.json` — composite indexes for the new collections
- `functions/src/lib/secrets.ts` — Anthropic + OpenAI + Stripe (MiroFish/LiteLLM/Zep dropped)
- `functions/src/auth/onUserCreate.ts` — seeds personal team + Starter subscription instead of credit balance
- `functions/src/index.ts` — exports only Build 0 surface
- `functions/.env.example` — OpenAI + Google Document AI placeholders, MiroFish removed
- `apps/web/src/App.tsx` — Deal Archive / New Deal / Deal Workspace / Billing navigation
- `apps/web/src/lib/functions.ts` — two typed callables: `ensureUserProfile`, `createDeal`
- `apps/web/src/components/LoginScreen.tsx` — v6.0 positioning copy
- `apps/web/index.html` — updated title and description
- `README.md` — v6.0 positioning and Build 0 scope

### New

- `functions/src/lib/entitlements.ts` — subscription quota checks (replaces `credits.ts`). `consumeDealQuota()` runs atomically inside a Firestore transaction.
- `functions/src/deals/createDeal.ts` — the sole active product callable in Build 0. Validates input, resolves team, consumes quota, writes `deals/{dealId}` with all seven phases at `not_started`, writes `auditLog` entry.
- `apps/web/src/hooks/useDeals.ts` — real-time team-scoped deal list + single-deal subscription.
- `apps/web/src/hooks/useSubscription.ts` — real-time subscription state.
- `apps/web/src/components/DealArchive.tsx` — sidebar-compact and full-grid deal list.
- `apps/web/src/components/NewDealForm.tsx` — setup wizard (name, target, sector, structure, size, geography).
- `apps/web/src/components/DealWorkspace.tsx` — seven-phase scaffolded shell, each phase labeled with the Build it activates in.
- `apps/web/src/components/BillingView.tsx` — current plan, quota usage, three-tier comparison (Stripe checkout stub — activates in Build H).
- `apps/web/src/components/PlanBadge.tsx` — sidebar subscription indicator.

### Retained unchanged

- `functions/src/clients/claude.ts` — Anthropic SDK integration, `tool_use` pattern, streaming, retry. Reused in Builds C and F.
- `functions/src/clients/schemas.ts`, `functions/src/clients/stripe.ts` — Build 2 surface preserved.
- `functions/src/prompts/` — four prompt files from Build 2. Prose will be rewritten in Builds C/F but the structure stays.
- `functions/src/lib/admin.ts`, `errors.ts` — framework plumbing.
- `apps/web/src/lib/firebase.ts`, `utils.ts`, `index.css`, `main.tsx` — foundation.
- `apps/web/src/hooks/useAuth.ts`, `useUserProfile.ts` — re-used as-is, new `UserProfile` type flows through naturally.
- `apps/web/src/components/LoginScreen.tsx` — only copy changes.
- `packages/shared/src/stressTests.ts` — the 13-test taxonomy lives inside Phase 6 now, unchanged as a library.

---

## Deploy and test

### Setup (first time)

```bash
# 1. Install and build
npm install
npm run build:shared

# 2. Wire Firebase project
firebase login
firebase use --add   # select your project, alias 'default'

# 3. Deploy rules and indexes (Firestore needs these before anything else)
firebase deploy --only firestore:rules,firestore:indexes

# 4. Copy env templates
cp apps/web/.env.example apps/web/.env.local
cp functions/.env.example functions/.env
# Fill apps/web/.env.local with your Firebase web config from Project Settings
```

### Local dev

```bash
# Terminal 1
npm run emulators

# Terminal 2
npm run dev:web
```

### End-to-end walkthrough

Open `http://localhost:3000`.

1. Click **Initialize Node**. Sign in with any Google account.
2. You land on an empty Deal Archive. The sidebar shows a Starter plan badge with 3 deals remaining.
3. Click **New Deal**. Fill in name ("Project Atlas"), target ("Acme Corp"), sector ("B2B SaaS"), geography ("North America"), pick a structure, click Create.
4. You land on the Deal Workspace. Seven phase cards are shown, each with a description and a "Activates in Build X" marker. Every phase is "not started."
5. Click **Archive** in the top nav — your new deal appears there. Click to reopen its workspace.
6. Rename the deal from the sidebar (hover the name, click the edit icon).
7. Click **Billing** — see your Starter plan, 1 of 3 deals used, and the three-tier comparison grid. Upgrade button is present but wired to a stub (Build H).
8. Try creating 3 more deals — the 4th attempt returns "Annual deal quota reached" and offers an Upgrade link in the error banner.

### What you should verify in Firestore

Open the Firebase console or emulator UI at `http://localhost:4000/firestore`.

- `users/{uid}` — exists with `primaryTeamId` set
- `teams/{teamId}` — one team per user, `ownerId` matches uid
- `teams/{teamId}/members/{uid}` — status `active`, role `partner`
- `subscriptions/{subId}` — tier `starter`, status `trialing`, `dealsUsedThisYear` counting correctly
- `deals/{dealId}` — each created deal, `phaseStatus` with all seven phases at `not_started`
- `deals/{dealId}/auditLog/{eventId}` — one `deal_created` event per deal
- `teamAuditLog/{eventId}` — one `member_invited` event per user signup

---

## Known stubs and deferrals

- **BillingView upgrade buttons** — no Stripe Checkout yet. Activates in Build H.
- **Team invitations** — `ensureUserProfile` creates a personal team, no invite flow. Build A.
- **Role resolution in createDeal audit event** — hardcoded to `partner` right now. Resolves against team membership in Build G.
- **Phase kickoffs** — nothing runs automatically after deal creation. Builds B through F add them.
- **Deletions** — `archiveDeal` callable exists only in specification. Can be added in Build A if needed for demos.

---

## Next up: Build A

Build A (1 week) delivers the deal setup wizard enhancements and team invitation flow. Specifically:

- Team creation beyond the personal team (for shared team workspaces)
- `inviteMember` and `acceptInvite` callables with audit logging
- Role assignment UI for team management (partner only)
- Enhanced setup wizard: data-room connection hints (for Build B), expected close date, risk appetite notes

None of this requires any new backend phases; it's building out the pre-ingestion workflow. Say "start Build A" when you're ready.

### Open questions deferred to specific builds

From the architecture doc §12:

- **Build B:** OCR cost ceiling per deal? Google Document AI is ~$1.50/1000 pages.
- **Build C:** Rule library — pure TS expressions, or a DSL for non-engineer authoring?
- **Build E:** IC memo template — house style or match a specific firm's format?
- **Build F:** Scenario impact as distribution (e.g., "12–18% at 80% confidence") or point estimate?
- **Build H:** Free trial mechanism — seeded demo deal with sample data room?

Each can wait until its build.

---

## Delivery

`outcome99-build0.zip` contains the complete Build 0 source. Unzip, `npm install`, `npm run build:shared`, deploy rules, run emulators, test the flow above.
