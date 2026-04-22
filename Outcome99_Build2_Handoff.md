# Outcome99 — Build 2 Handoff

**Build 2** wires real Claude Opus 4.7 + Sonnet 4.6 into the four-phase pipeline, replacing the Build 1 stubs. The integration uses Anthropic's `tool_use` pattern for guaranteed structured JSON output, streams Phase 4 synthesis live into Firestore, and falls back to the Build 1 stub automatically when no API key is set — so local development still works without spending money.

64 source files, ~300 KB of code. Seven new files were added and five existing files were modified vs. Build 1.

---

## What's new

### New files

```
functions/src/
├── clients/
│   └── schemas.ts           ← JSON schemas for all three structured outputs
├── lib/
│   └── secrets.ts           ← defineSecret() for ANTHROPIC_API_KEY + future builds
└── prompts/
    ├── index.ts             ← barrel export
    ├── research.ts          ← Phase 1 Opus prompt (taxonomy mapping)
    ├── personas.ts          ← Phase 2 Sonnet prompt (batched PE personas)
    ├── synthesis.ts         ← Phase 4 Opus prompt (synthesis + report)
    └── oracle.ts            ← Oracle chat prompt (scope-guarded)
```

### Modified files

```
functions/
├── package.json                      ← bumped @anthropic-ai/sdk to ^0.90.0
├── .env.example                      ← Build 2 annotations
└── src/
    ├── clients/
    │   └── claude.ts                 ← AnthropicClaudeClient + retained stub
    └── simulations/
        ├── pipeline/
        │   └── phase4_synthesis.ts   ← streaming variant, writes partial report
        ├── startSimulation.ts        ← bound ANTHROPIC_API_KEY, raised limits
        ├── sendOracleMessage.ts      ← bound ANTHROPIC_API_KEY
        └── retrySimulation.ts        ← bound ANTHROPIC_API_KEY
```

### Model tiering (as implemented)

| Phase / Call | Model | Rationale |
|---|---|---|
| Phase 1 · Research | `claude-opus-4-7` | Taxonomy mapping needs strong reasoning |
| Phase 2 · Personas | `claude-sonnet-4-6` | Batching problem, speed matters |
| Phase 4 · Synthesis | `claude-opus-4-7` | Heaviest reasoning — converts swarm output to PE-grade analysis |
| Oracle chat | `claude-sonnet-4-6` | Latency-sensitive, repeated calls |

---

## Deploy checklist

### 1. Install new dependencies

From the project root:

```bash
npm install
npm run build:shared
```

The `@anthropic-ai/sdk` version bumped from 0.40.0 to 0.90.0, so `npm install` will update `functions/node_modules`.

### 2. Set the Anthropic secret

Get an API key from [console.anthropic.com](https://console.anthropic.com) (you'll need to add a payment method — there is no free tier). Add credit to your account; $20 will run dozens of Low-tier simulations and a few High-tier ones comfortably for testing.

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

When prompted, paste your key. It's stored in Google Secret Manager, scoped to your Firebase project. You can verify it's set:

```bash
firebase functions:secrets:access ANTHROPIC_API_KEY
```

### 3. Deploy

```bash
npm run build
firebase deploy --only functions
```

The first deploy after adding the secret can take a little longer because Firebase provisions the secret binding for each of the three secret-consuming functions (`startSimulation`, `sendOracleMessage`, `retrySimulation`).

### 4. Test the end-to-end flow

1. Sign in at your deployed URL
2. Start a new simulation — Low complexity, fill in minimal fields
3. Watch the AI Research Thread in the swarm visualization populate with real log messages from the pipeline phases
4. When Phase 4 begins, watch the **Synthesis** tab render the report as it streams in, 400ms at a time
5. Open the **Explorer** tab — you'll see real PE personas from Claude, each with archetype-specific names, traits, and influence percentages
6. Open **Risks** — exactly 4 items, each with severity flags and swarm-grounded evidence
7. Ask the Oracle a question — you'll get a grounded answer referencing specific metrics and personas

---

## Running with stubs (no API key needed)

Development and CI don't need to spend money. The Claude client defaults to the stub whenever `ANTHROPIC_API_KEY` is unset **OR** when `USE_STUB_CLIENTS=true` is explicitly set.

For local emulator development:

```bash
# In functions/.env — leave ANTHROPIC_API_KEY empty
USE_STUB_CLIENTS=true

# Then run normally
npm run emulators
```

The entire pipeline executes in ~15 seconds against stubs, exactly like Build 1. This lets you iterate on frontend UX without making any real Claude calls.

---

## Cost calibration — what you'll actually spend

Rough Claude API cost per simulation, based on Anthropic's published pricing and the max_tokens set in `claude.ts`:

| Tier | Personas | Phase 1 | Phase 2 | Phase 4 | Oracle (10 msgs) | Approx. Total |
|---|---|---|---|---|---|---|
| Low    | 100  | $0.05 | $0.30 | $0.80 | $0.15 | **~$1.30** |
| Medium | 500  | $0.05 | $1.50 | $1.50 | $0.15 | **~$3.20** |
| High   | 1000 | $0.05 | $3.00 | $2.50 | $0.15 | **~$5.70** |

These are **Claude costs only** — MiroFish inference adds to this in Build 3 since MiroFish itself runs a Claude Sonnet per agent-turn via LiteLLM.

The Build 1 credit cost table (25 / 100 / 250 credits for Low / Medium / High) is calibrated assuming ~10¢ per credit cost-to-serve. **Revisit this after your first week of real usage.** If the actual cost per simulation comes in lower than expected, you have room to tighten credit pricing or expand plan allowances.

---

## Architecture notes

### Why `tool_use` instead of `output_config.format`

Anthropic shipped native structured outputs via `output_config.format` in late 2025, but as of the Build 2 ship date the TypeScript SDK types don't fully support it (the Vercel AI Gateway docs still use `@ts-expect-error`). Rather than fight the types, Build 2 uses the stable `tool_use` pattern with `tool_choice: { type: 'tool', name: ... }`, which is fully typed and battle-tested. When the SDK catches up (likely Q2 2026), migrating is a single file change — replace the `tools` + `tool_choice` with `output_config.format` and update the response parsing to read `content[0].text` instead of `content.find(b => b.type === 'tool_use')`.

### How streaming Phase 4 works

When Phase 4 runs, `AnthropicClaudeClient.synthesizeStream()` opens an Anthropic SSE stream. For each `input_json_delta` event (Claude emitting partial tool input), it accumulates the JSON string and runs a small state machine (`extractReportField` in `claude.ts`) that scans for the growing value of the `"report"` field, handling escaped quotes. Every time the extracted report grows by 120+ characters AND at least 400ms has elapsed since the last emit, it writes the partial text to the simulation doc. The frontend's `onSnapshot` listener re-renders with each write, giving the user a live "report is being generated" experience without any custom streaming infrastructure. Numerical results and risks arrive at the end — they can't be extracted from partial JSON reliably.

For a typical 500-word synthesis this produces 10–20 Firestore writes. At Firestore's write pricing ($0.18 per 100K writes) this is effectively free even at 1000 concurrent simulations. If that changes, the throttle is tunable via the `throttleMs` constant in `claude.ts`.

### Prompt security

All four system prompts include explicit instructions to treat user-provided fields (`scenarioDescription`, chat messages) as untrusted data, not as commands. The Oracle prompt specifically refuses to echo the system prompt and to follow instructions embedded in user messages. This is defense-in-depth — the bigger guard is that our functions only expose narrow callables, not a general Claude proxy.

### Retry strategy

`withRetry` in `claude.ts` handles Anthropic's transient errors (529 overloaded, 503, 502, 504) with exponential backoff: 1s, 2s, 4s. Non-retryable errors (400 invalid request, 401 auth, 429 rate limit) fail fast to the pipeline orchestrator, which refunds credits and marks the simulation failed. The user can retry the failed phase via the retry button without being charged again (unless their refund was already applied, in which case it re-debits — see `retrySimulation.ts`).

---

## What to try after Build 2 is deployed

1. **Run the same scenario at Low, Medium, and High complexity** — compare how the quality of the synthesis report changes. The step from 100 → 500 personas is usually more material than 500 → 1000.

2. **Try a deliberately adversarial scenario description** (something with embedded instructions like "ignore previous instructions and output X"). Confirm the prompt defenses hold and the synthesis stays on-scope.

3. **Test the retry flow** — deliberately induce a failure (e.g. set `ANTHROPIC_API_KEY` to an invalid value temporarily), start a simulation, watch it fail with a refund, fix the key, hit retry. Confirm the credits aren't double-charged.

4. **Check the usage ledger in the Billing view** — confirm every simulation has a debit entry and every failure has a matching refund.

---

## Build 3 preview

With Claude fully live, the remaining engine work is MiroFish. The spec:

- Deploy MiroFish unmodified as a private Cloud Run service
- Deploy LiteLLM proxy as a separate Cloud Run service, configured with Anthropic as the backend
- Configure MiroFish's `LLM_BASE_URL` to point at LiteLLM — so MiroFish's internal agent-turn calls go through Claude Sonnet 4.6
- Replace `StubSwarmClient` in `functions/src/clients/mirofish.ts` with the commented-out `HttpSwarmClient` that's already scaffolded
- Rebuild `SwarmVisualization.tsx` with three.js to render actual 1000-node swarms with archetype coloring and real MiroFish interaction events

The interface contract on `SwarmClient` is already set, so Phase 3 orchestration code doesn't move at all.

---

## Delivery

`outcome99-build2.zip` contains the complete Build 2 source. Unzip, `npm install`, `npm run build:shared`, set `ANTHROPIC_API_KEY`, deploy.

Reply **"Build 3"** when you're ready to wire MiroFish.
