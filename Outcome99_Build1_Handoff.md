# Outcome99 — Build 1 Handoff

**What you have:** A production-ready monorepo scaffold for Outcome99. 57 files, 271 KB of source. The complete pipeline runs end-to-end against stub data, so you can deploy today and watch a simulation flow from sign-in through Dashboard → Form → pre-flight modal → four-phase pipeline → tabbed results → Oracle chat → Billing view, without any external API keys.

---

## File Inventory

```
outcome99/
├── README.md                      ← full project README
├── package.json                   ← npm workspaces root
├── firebase.json                  ← Firebase project config
├── firestore.rules                ← security rules (server-writes only for credits)
├── firestore.indexes.json         ← composite indexes
├── .gitignore
│
├── packages/shared/               ← Types and constants shared across workspaces
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               ← barrel
│       ├── stressTests.ts         ← 13 test taxonomies w/ archetype biases
│       ├── schemas.ts             ← Simulation, UserProfile, UsageEvent, etc.
│       └── plans.ts               ← Free/Pro/Team/Enterprise, credit costs, packs
│
├── functions/                     ← Firebase Cloud Functions (Node 20, TS)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example               ← all future secrets placeheld
│   └── src/
│       ├── index.ts               ← exports all callables
│       ├── lib/
│       │   ├── admin.ts           ← Firebase Admin init
│       │   ├── errors.ts          ← typed HttpsError helpers
│       │   ├── credits.ts         ← atomic debit/refund transactions ★
│       │   └── complexity.ts      ← tier inference heuristic
│       ├── clients/
│       │   ├── claude.ts          ← ClaudeClient interface + StubClaudeClient
│       │   ├── mirofish.ts        ← SwarmClient interface + StubSwarmClient
│       │   └── stripe.ts          ← StripeClient interface + stub
│       ├── auth/
│       │   └── onUserCreate.ts    ← beforeCreate + ensureUserProfile callable
│       ├── simulations/
│       │   ├── startSimulation.ts ← pre-flight debit + async pipeline kickoff ★
│       │   ├── sendOracleMessage.ts  ← rate-limited, context-aware chat
│       │   ├── retrySimulation.ts ← resume failed simulations
│       │   └── pipeline/
│       │       ├── phase1_research.ts    ← Opus taxonomy mapping
│       │       ├── phase2_personas.ts    ← Sonnet batched persona gen
│       │       ├── phase3_swarm.ts       ← MiroFish submit/poll loop
│       │       ├── phase4_synthesis.ts   ← Opus synthesis
│       │       └── orchestrator.ts       ← phase sequencing + refund on failure
│       └── billing/
│           ├── createCheckoutSession.ts  ← Stripe Checkout (stubbed Build 1)
│           ├── stripeWebhook.ts          ← webhook handler (stubbed Build 1)
│           └── resetMonthlyCredits.ts    ← daily 00:05 UTC scheduler
│
└── apps/web/                      ← React 19 + Vite + Tailwind v4 SPA
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html                 ← Inter, Space Grotesk, JetBrains Mono
    ├── .env.example
    └── src/
        ├── main.tsx
        ├── App.tsx                ← top-level shell + routing
        ├── index.css              ← preserves Source-of-Truth design tokens
        ├── lib/
        │   ├── firebase.ts        ← Firebase init + emulator wiring
        │   ├── functions.ts       ← typed callable wrappers
        │   └── utils.ts           ← cn, formatCredits, formatDate, etc.
        ├── hooks/
        │   ├── useAuth.ts         ← Google SSO + ensureUserProfile
        │   ├── useUserProfile.ts  ← real-time user doc
        │   └── useSimulations.ts  ← list + single subscriptions
        └── components/
            ├── LoginScreen.tsx
            ├── Dashboard.tsx      ← sidebar compact + full grid modes
            ├── SimulationForm.tsx ← 2-step wizard + preflight modal
            ├── SimulationView.tsx ← tabbed results (Report/Swarm/Risks/Oracle)
            ├── SwarmVisualization.tsx  ← Canvas 2D particle mesh
            ├── CreditBadge.tsx    ← sidebar balance indicator
            ├── PreflightModal.tsx ← credit cost confirmation
            └── BillingView.tsx    ← plans, top-ups, usage ledger
```

★ = critical files worth reviewing before Build 2.

---

## Setup

### Prerequisites
- Node.js 20+
- `npm install -g firebase-tools`
- A Firebase project with Firestore (Native), Authentication (Google provider enabled), and Cloud Functions available.

### First-time setup

```bash
# 1. Unzip the project
unzip outcome99-build1.zip && cd outcome99

# 2. Install all workspaces
npm install

# 3. Build the shared package (functions and web both import from it)
npm run build:shared

# 4. Copy env templates
cp apps/web/.env.example apps/web/.env.local
cp functions/.env.example functions/.env

# 5. Fill in apps/web/.env.local with your Firebase web config
#    (projectId, appId, apiKey, etc. — get these from Firebase Console)
#    Set VITE_USE_EMULATORS=true for local dev.

# 6. Authenticate Firebase CLI
firebase login
firebase use --add   # select your project and give it an alias "default"

# 7. Deploy Firestore rules + indexes (creates the necessary structure)
firebase deploy --only firestore:rules,firestore:indexes
```

### Local development

```bash
# Terminal 1 — emulators (auth + firestore + functions + UI at :4000)
npm run emulators

# Terminal 2 — web dev server at :3000
npm run dev:web
```

Open `http://localhost:3000`, sign in with a Google account (the emulator accepts any real Google account or lets you create a test user via the emulator UI), and watch the pipeline run end-to-end with stubbed phase data every few seconds.

### Production deploy

```bash
npm run build             # builds shared, functions, and web
firebase deploy           # deploys rules, indexes, functions, and hosting
```

---

## What works today (Build 1)

- ✅ **Google SSO** via Firebase Auth with `onAuthStateChanged` listener
- ✅ **User seeding** — `ensureUserProfile` is called on first login, creates `users/{uid}` with Free plan, 25 monthly credits, and a `signup_grant` entry in `usage_events`
- ✅ **Dashboard** sidebar and full-grid modes, with in-place rename
- ✅ **New simulation wizard** — 13 stress test types, configuration form, complexity tier selector
- ✅ **Pre-flight modal** — shows personas, credit cost, current balance, post-sim balance, with upsell if insufficient
- ✅ **Atomic credit debit** — runs inside a Firestore transaction, refuses on insufficient balance, writes a `usage_events` ledger entry
- ✅ **Four-phase pipeline** — orchestrator runs research → personas → swarm → synthesis sequentially, writes progress to Firestore at each step, refunds credits on any phase failure
- ✅ **Real-time UI updates** — client subscribes to the simulation doc via `onSnapshot` and re-renders as each phase completes
- ✅ **Swarm visualization** — Canvas 2D particle mesh with progress overlay during Phase 3
- ✅ **Tabbed results** — Synthesis (markdown + metric cards), Explorer (agent grid + detail drawer), Risks (evidence table), Oracle (chat)
- ✅ **Oracle chat** — rate-limited (30 msgs/hr per simulation), full context passed to Claude, debits 1 credit per assistant response
- ✅ **Retry** — failed simulations can be retried from the failed phase without re-charging (unless already refunded, in which case it re-debits)
- ✅ **Billing view** — plan status, balance, top-up packs (stubbed checkout URL), usage ledger
- ✅ **Monthly reset** — scheduled daily at 00:05 UTC, resets any user whose anniversary has passed

## What's stubbed (will be replaced in Builds 2-4)

- 🔵 **Claude calls** → returns realistic-shape data after a delay. Build 2 swaps in real `@anthropic-ai/sdk` with structured JSON output and streaming for Phase 4.
- 🔵 **MiroFish calls** → in-memory job store with ~8s completion. Build 3 replaces with HTTP client against self-hosted MiroFish.
- 🔵 **Stripe** → Checkout Session returns a stub URL that just redirects. Build 4 wires real Checkout + webhooks + webhook signature verification.
- 🔵 **WebGL swarm** → Canvas 2D with 60-ish particles. Build 3 upgrades to three.js / WebGL rendering 1000 nodes with archetype-colored edges.

---

## Testing the end-to-end flow

1. Sign in with Google → you land on the dashboard with an empty archive.
2. Check your credit badge — it should show 25/25 monthly credits.
3. Click **New Simulation** → pick any stress test → fill in the form fields → click **Review & Initiate**.
4. The pre-flight modal opens showing 25 credits (Low tier) for 100 personas. Click **Confirm**.
5. You're routed to the Simulation Engine tab. The swarm visualization activates. The AI Research Thread in the bottom-left starts populating with phase logs.
6. Over ~15 seconds, the pipeline runs all four phases. Status transitions: researching → generating → simulating → synthesizing → completed.
7. Tabs appear: **Synthesis** (stub markdown report + 3 metric cards), **Explorer** (100 persona cards, clickable to open detail panel), **Risks** (4-row evidence table), **Oracle** (chat interface).
8. Send an Oracle message → get a stub response back. Credit badge decrements by 1.
9. Navigate to **Billing** → see your plan, remaining balance, usage history with every debit/grant event.
10. Click any top-up pack → stub redirect back to the app.

---

## Build 2 Spec — Real Claude Integration

Build 2 is a contained swap. The `ClaudeClient` interface in `functions/src/clients/claude.ts` is the contract; `StubClaudeClient` becomes `AnthropicClaudeClient`.

### Files to touch

- `functions/src/clients/claude.ts` — replace `StubClaudeClient` with the real impl
- `functions/src/prompts/` (new) — extract system prompts into versioned files for review
- `functions/package.json` — already depends on `@anthropic-ai/sdk`

### Implementation

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

class AnthropicClaudeClient implements ClaudeClient {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  }

  async research(input: ResearchInput): Promise<ResearchData> {
    const response = await this.client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildResearchPrompt(input) }],
      // Use structured output via tool_use for strict schema
      tools: [RESEARCH_SCHEMA_TOOL],
      tool_choice: { type: 'tool', name: 'emit_research' },
    });
    const tool = response.content.find(b => b.type === 'tool_use');
    return tool.input as ResearchData;
  }

  async generatePersonas(input: PersonaInput): Promise<Persona[]> {
    // Batched Sonnet call with tool_use for strict persona array schema
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    // Opus call with streaming for the report markdown
    // Return numericalResults, riskAnalysis, and finalized personas
  }

  async oracleChat(input: OracleChatInput): Promise<string> {
    // Sonnet call with full simulation context in system prompt
  }
}

export const claudeClient: ClaudeClient = new AnthropicClaudeClient();
```

### Secret setup

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
# Update each function's deploy config to bind the secret:
# In functions/src/simulations/startSimulation.ts:
#   onCall({ secrets: [ANTHROPIC_API_KEY], ... }, ...)
```

### Prompts to author (one file each)

- `RESEARCH_SYSTEM_PROMPT` — "You are a PE research analyst. Map the scenario to the taxonomy..."
- `PERSONA_SYSTEM_PROMPT` — "You generate PE-domain personas with specified archetype distribution..."
- `SYNTHESIS_SYSTEM_PROMPT` — "You synthesize swarm convergence data into financial metrics and executive reports..."
- `ORACLE_SYSTEM_PROMPT` — "You are the Omniscient Oracle. Answer strictly from the simulation data provided..."

Each prompt should include the expected output schema inline, because even with `tool_use` the model follows English instructions more reliably than schema alone.

### Streaming Phase 4 (optional polish)

For a better UX, stream Opus synthesis tokens back to the client by writing the growing report to Firestore every ~200 tokens during Phase 4. The `SimulationView.tsx` is already subscribed via `onSnapshot` so it'll re-render naturally.

### Testing checklist

- [ ] Phase 1 produces valid `ResearchData` for all 13 test types
- [ ] Phase 2 generates the correct number of personas per complexity tier
- [ ] Phase 2 respects the archetype distribution (within 20% tolerance)
- [ ] Phase 4 produces all 4 risk items and all output variables from the taxonomy
- [ ] Oracle chat refuses to answer questions outside the simulation context
- [ ] Prompt-injection attempts in `scenarioDescription` don't escape the system prompt

---

## Build 3 Spec — MiroFish + LiteLLM

The `SwarmClient` interface is the boundary. `StubSwarmClient` becomes `HttpSwarmClient` pointing at a Cloud Run deployment of MiroFish.

### Infrastructure

1. Deploy MiroFish to Cloud Run with `docker compose up -d` translated to a Cloud Run YAML. Set `--ingress=internal` so only VPC traffic reaches it.
2. Deploy a LiteLLM proxy to Cloud Run. Configure it with your `ANTHROPIC_API_KEY` and expose OpenAI-compatible endpoints for `claude-sonnet-4-6`.
3. Set MiroFish's `LLM_BASE_URL` to the LiteLLM proxy's internal URL, `LLM_MODEL_NAME=claude-sonnet-4-6`.
4. Spin up a Zep Cloud account, grab `ZEP_API_KEY`, set in MiroFish's env.

### Files to touch

- `functions/src/clients/mirofish.ts` — uncomment the `HttpSwarmClient` and swap it in
- `functions/src/simulations/pipeline/phase3_swarm.ts` — no changes needed (uses the interface)
- `apps/web/src/components/SwarmVisualization.tsx` — rewrite with three.js for 1000-node rendering

### AGPL compliance note

Per our earlier decision: MiroFish runs **unmodified** as a Cloud Run service. Outcome99 code never links against MiroFish source — it only makes HTTP calls. Keep it that way.

---

## Build 4 Spec — Stripe

Straight-forward once the Anthropic and MiroFish paths are proven.

- Replace `StubStripeClient` in `functions/src/clients/stripe.ts` with real SDK calls.
- Implement `stripeWebhook.ts` with signature verification (`stripe.webhooks.constructEvent`), idempotency via `stripe_events/{eventId}` docs, and handlers for `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_failed`.
- Wire subscription success → update `users/{uid}.planId` + grant first month's `monthlyCredits`.
- Wire top-up success → `creditCredits({ bucket: 'purchased', ... })`.
- Add report PDF export via a `exportReport` callable using a simple HTML-to-PDF renderer (Puppeteer on Cloud Run).

---

## What I need you to do

1. **Inspect** the zip — especially `firestore.rules`, `functions/src/lib/credits.ts`, and `packages/shared/src/plans.ts`.
2. **Deploy** to a dev Firebase project and run the end-to-end flow with stubs. This validates the foundation.
3. **Calibrate credit costs** against realistic Anthropic usage once Build 2 is live.
4. **Decide Build 2 scope** — green-light real Claude integration and I'll draft the four system prompts and swap the client.

Everything is in place for an iterative, low-risk path from stub to production.
