import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions/v2';
import type {
  Persona,
  ResearchData,
  RiskItem,
  StressTestId,
} from '@outcome99/shared';
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  PERSONA_SYSTEM_PROMPT,
  buildPersonaUserPrompt,
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
  ORACLE_SYSTEM_PROMPT,
  buildOracleUserPrompt,
  buildOracleContextBlock,
  CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierUserPrompt,
} from '../prompts/index.js';
import {
  RESEARCH_TOOL,
  PERSONA_TOOL,
  SYNTHESIS_TOOL,
  CLASSIFIER_TOOL,
} from './schemas.js';

/**
 * Claude client
 *
 * Model tiering (per Source of Truth + our architecture decisions):
 *   Phase 1 (research)    → claude-opus-4-7        (reasoning-heavy)
 *   Phase 2 (personas)    → claude-sonnet-4-6      (batching, speed)
 *   Phase 4 (synthesis)   → claude-opus-4-7        (reasoning-heavy)
 *   Oracle chat           → claude-sonnet-4-6      (latency-sensitive)
 *
 * Structured output is produced via the tool_use pattern (forcing a single
 * tool) rather than the newer output_config.format, because the TS SDK types
 * fully support tool_use today. Migration to output_config is a single-file
 * change when the SDK stabilizes.
 *
 * STUB MODE:
 *   Set USE_STUB_CLIENTS=true in env (or don't set ANTHROPIC_API_KEY) to
 *   run against StubClaudeClient. This preserves the Build 1 end-to-end
 *   flow for local dev and for CI.
 */

// ============================================================================
// Public types
// ============================================================================

export interface ResearchInput {
  simulationName: string;
  testType: StressTestId;
  testName: string;
  preliminaryInquiry: string;
  userInputs: Record<string, string>;
  scenarioDescription: string;
  archetypeBias: Record<string, number>;
}

export interface PersonaInput {
  simulationName: string;
  testType: StressTestId;
  testName: string;
  scenarioDescription: string;
  archetypeDistribution: Record<string, number>;
  targetCount: number;
}

export interface SynthesisInput {
  simulationName: string;
  testType: StressTestId;
  testName: string;
  outputVariables: string[];
  scenarioDescription: string;
  userInputs: Record<string, string>;
  personas: Persona[];
  rawConvergenceData: unknown;
}

export interface SynthesisOutput {
  numericalResults: Record<string, string | number>;
  riskAnalysis: RiskItem[];
  report: string;
  personas: Persona[];
}

export interface OracleChatInput {
  simulationContext: string;
  userMessage: string;
  priorMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ClassifyDocumentInput {
  filename: string;
  folderPath?: string;
  ocrExcerpt: string;
}

export interface ClassifyDocumentOutput {
  workstream:
    | 'legal'
    | 'financial'
    | 'tax'
    | 'hr'
    | 'cyber_it'
    | 'commercial'
    | 'customer'
    | 'supplier'
    | 'operations_integration';
  confidence: number;
  rationale: string;
}

export interface ClaudeClient {
  research(input: ResearchInput): Promise<ResearchData>;
  generatePersonas(input: PersonaInput): Promise<Persona[]>;
  synthesize(input: SynthesisInput): Promise<SynthesisOutput>;
  /**
   * Streaming variant of synthesize. Emits partial report updates via the
   * onPartialReport callback as tokens stream in. Other fields (results,
   * risks, personas) arrive only at the end since the tool_use block must
   * complete before it can be parsed.
   */
  synthesizeStream(
    input: SynthesisInput,
    onPartialReport: (partial: string) => Promise<void>
  ): Promise<SynthesisOutput>;
  oracleChat(input: OracleChatInput): Promise<string>;
  /** Build B — classify a single document into one of the nine workstreams. */
  classifyDocument(input: ClassifyDocumentInput): Promise<ClassifyDocumentOutput>;
}

// ============================================================================
// Model configuration
// ============================================================================

const MODELS = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
} as const;

const MAX_TOKENS = {
  research: 2048,
  personas: 16384,
  synthesis: 16384,
  oracle: 1500,
  classifier: 256,
} as const;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ============================================================================
// Real AnthropicClaudeClient
// ============================================================================

class AnthropicClaudeClient implements ClaudeClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async research(input: ResearchInput): Promise<ResearchData> {
    const raw = await this.callWithTool<{
      questions: string[];
      taxonomyMapping: {
        primaryTest: string;
        secondaryTests: string[];
        rationale: string;
      };
      archetypeDistribution: Record<string, number>;
    }>({
      model: MODELS.opus,
      maxTokens: MAX_TOKENS.research,
      system: RESEARCH_SYSTEM_PROMPT,
      userPrompt: buildResearchUserPrompt(input),
      tool: RESEARCH_TOOL,
    });

    const normalized = this.normalizeDistribution(raw.archetypeDistribution);

    return {
      questions: raw.questions.slice(0, 5),
      taxonomyMapping: {
        primaryTest: raw.taxonomyMapping.primaryTest as StressTestId,
        secondaryTests: raw.taxonomyMapping.secondaryTests as StressTestId[],
        rationale: raw.taxonomyMapping.rationale,
      },
      archetypeDistribution: normalized,
      synthesizedAt: new Date().toISOString(),
    };
  }

  async generatePersonas(input: PersonaInput): Promise<Persona[]> {
    const raw = await this.callWithTool<{
      personas: Array<{
        name: string;
        role: string;
        archetype: string;
        persona: string;
        traits: string[];
        preferences: string;
      }>;
    }>({
      model: MODELS.sonnet,
      maxTokens: MAX_TOKENS.personas,
      system: PERSONA_SYSTEM_PROMPT,
      userPrompt: buildPersonaUserPrompt(input),
      tool: PERSONA_TOOL,
    });

    return raw.personas.map((p, i) => ({
      ...p,
      id: `p_${Date.now().toString(36)}_${i.toString().padStart(4, '0')}`,
    }));
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    return this.synthesizeStream(input, async () => {});
  }

  async synthesizeStream(
    input: SynthesisInput,
    onPartialReport: (partial: string) => Promise<void>
  ): Promise<SynthesisOutput> {
    let lastEmittedLength = 0;
    let partialReport = '';
    const throttleMs = 400;
    let lastEmitAt = 0;

    const result = await this.callWithToolStreaming<{
      numericalResults: Record<string, string>;
      riskAnalysis: RiskItem[];
      personas: Array<Persona & { influence: number }>;
      report: string;
    }>({
      model: MODELS.opus,
      maxTokens: MAX_TOKENS.synthesis,
      system: SYNTHESIS_SYSTEM_PROMPT,
      userPrompt: buildSynthesisUserPrompt(input),
      tool: SYNTHESIS_TOOL,
      onPartialInput: async (partial) => {
        const extracted = extractReportField(partial);
        if (!extracted) return;
        partialReport = extracted;
        const now = Date.now();
        if (
          partialReport.length - lastEmittedLength >= 120 &&
          now - lastEmitAt >= throttleMs
        ) {
          lastEmittedLength = partialReport.length;
          lastEmitAt = now;
          try {
            await onPartialReport(partialReport);
          } catch (err) {
            logger.warn('onPartialReport threw (continuing)', { err: String(err) });
          }
        }
      },
    });

    if (result.report && result.report.length > lastEmittedLength) {
      try {
        await onPartialReport(result.report);
      } catch (err) {
        logger.warn('final onPartialReport threw', { err: String(err) });
      }
    }

    return {
      numericalResults: result.numericalResults,
      riskAnalysis: result.riskAnalysis,
      report: result.report,
      personas: result.personas,
    };
  }

  async oracleChat(input: OracleChatInput): Promise<string> {
    const system =
      ORACLE_SYSTEM_PROMPT + buildOracleContextBlock(input.simulationContext);

    const messages: Anthropic.MessageParam[] = [
      ...input.priorMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user' as const, content: buildOracleUserPrompt(input) },
    ];

    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: MODELS.sonnet,
        max_tokens: MAX_TOKENS.oracle,
        system,
        messages,
      })
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) throw new Error('Oracle returned empty response.');
    return text;
  }

  async classifyDocument(input: ClassifyDocumentInput): Promise<ClassifyDocumentOutput> {
    const raw = await this.callWithTool<{
      workstream: ClassifyDocumentOutput['workstream'];
      confidence: number;
      rationale: string;
    }>({
      model: MODELS.sonnet,
      maxTokens: MAX_TOKENS.classifier,
      system: CLASSIFIER_SYSTEM_PROMPT,
      userPrompt: buildClassifierUserPrompt(input),
      tool: CLASSIFIER_TOOL,
    });

    // Post-parse clamp on confidence — belt and suspenders.
    const confidence = Math.max(0, Math.min(1, raw.confidence));
    return {
      workstream: raw.workstream,
      confidence,
      rationale: raw.rationale.slice(0, 200),
    };
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private async callWithTool<T>(params: {
    model: string;
    maxTokens: number;
    system: string;
    userPrompt: string;
    tool: Anthropic.Tool;
  }): Promise<T> {
    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        tools: [params.tool],
        tool_choice: { type: 'tool', name: params.tool.name },
        messages: [{ role: 'user', content: params.userPrompt }],
      })
    );

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === params.tool.name
    );
    if (!toolUse) {
      logger.error('Expected tool_use block missing', {
        model: params.model,
        stop_reason: response.stop_reason,
      });
      throw new Error(`Claude did not emit the required ${params.tool.name} tool call.`);
    }
    return toolUse.input as T;
  }

  private async callWithToolStreaming<T>(params: {
    model: string;
    maxTokens: number;
    system: string;
    userPrompt: string;
    tool: Anthropic.Tool;
    onPartialInput: (partialJson: string) => Promise<void>;
  }): Promise<T> {
    return this.withRetry(async () => {
      const stream = this.client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        tools: [params.tool],
        tool_choice: { type: 'tool', name: params.tool.name },
        messages: [{ role: 'user', content: params.userPrompt }],
      });

      let partialJson = '';
      let activeToolName: string | null = null;

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          activeToolName = event.content_block.name;
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'input_json_delta' &&
          activeToolName === params.tool.name
        ) {
          partialJson += event.delta.partial_json;
          await params.onPartialInput(partialJson);
        } else if (event.type === 'content_block_stop') {
          activeToolName = null;
        }
      }

      const final = await stream.finalMessage();
      const toolUse = final.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === params.tool.name
      );
      if (!toolUse) {
        throw new Error(`Claude did not emit ${params.tool.name} during stream.`);
      }
      return toolUse.input as T;
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status;
        const retryable = status === 529 || status === 503 || status === 502 || status === 504;
        if (!retryable || attempt === MAX_RETRIES - 1) break;
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn('Anthropic retryable error; backing off', {
          status,
          attempt,
          backoffMs: backoff,
        });
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  private normalizeDistribution(d: Record<string, number>): Record<string, number> {
    const clipped: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) {
      clipped[k] = Math.max(0.05, Math.min(0.5, v));
    }
    const sum = Object.values(clipped).reduce((a, b) => a + b, 0);
    if (sum === 0) return d;
    const normalized: Record<string, number> = {};
    for (const [k, v] of Object.entries(clipped)) {
      normalized[k] = v / sum;
    }
    return normalized;
  }
}

/**
 * Extract the current value of the `report` field from an in-progress JSON
 * string during streaming. JSON is incomplete mid-stream so we cannot parse
 * it, but we can scan for the report field with a simple state machine that
 * handles escaped quotes.
 */
function extractReportField(partial: string): string | null {
  const key = '"report"';
  const idx = partial.indexOf(key);
  if (idx === -1) return null;
  let i = idx + key.length;
  while (i < partial.length && partial[i] !== ':') i++;
  if (i >= partial.length) return null;
  i++;
  while (
    i < partial.length &&
    (partial[i] === ' ' || partial[i] === '\n' || partial[i] === '\r' || partial[i] === '\t')
  ) {
    i++;
  }
  if (i >= partial.length || partial[i] !== '"') return null;
  i++;
  let out = '';
  while (i < partial.length) {
    const ch = partial[i];
    if (ch === '\\' && i + 1 < partial.length) {
      const next = partial[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i++;
  }
  return out;
}

// ============================================================================
// Stub implementation (retained for local dev and CI)
// ============================================================================

const ARCHETYPE_CATALOG = [
  { archetype: 'institutionalLP', role: 'Institutional LP', names: ['CalPERS delegate', 'Wellcome Trust PM', 'GIC director', 'CPPIB analyst'] },
  { archetype: 'retailInvestor', role: 'Retail Investor', names: ['R. Carter', 'M. Nakamura', 'S. Pérez', 'A. Whitman'] },
  { archetype: 'debtHolder', role: 'Debt Holder', names: ['Apollo credit desk', 'Oaktree distressed', 'Goldman leveraged finance', 'Barings direct lending'] },
  { archetype: 'portfolioManager', role: 'Portfolio Manager', names: ['J. Ostrowski', 'K. Das', 'V. Ilyin', 'L. Mbeki'] },
  { archetype: 'regulator', role: 'Regulator', names: ['SEC examiner', 'FCA supervisor', 'BaFin reviewer', 'MAS officer'] },
];

const TRAIT_POOL = [
  'Risk averse', 'Return hungry', 'Analytical', 'Impulsive', 'Contrarian',
  'Momentum-driven', 'Liquidity conscious', 'Yield seeking', 'Mandate bound',
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickMany<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
function delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

class StubClaudeClient implements ClaudeClient {
  async research(input: ResearchInput): Promise<ResearchData> {
    await delay(1200);
    return {
      questions: [
        `What were liquidity conditions during comparable events to "${input.scenarioDescription.slice(0, 60)}..."?`,
        `Which peer funds in the ${input.testName} space have published post-mortem data?`,
        `What macro indices correlate most strongly with the user's stated variables?`,
        `Have regulators issued guidance on this scenario class?`,
        `What is the historical base rate for the loss threshold implied?`,
      ],
      taxonomyMapping: {
        primaryTest: input.testType,
        secondaryTests: [],
        rationale: `Scenario aligns with ${input.testName} based on inputs. [STUB]`,
      },
      archetypeDistribution: input.archetypeBias,
      synthesizedAt: new Date().toISOString(),
    };
  }

  async generatePersonas(input: PersonaInput): Promise<Persona[]> {
    await delay(800);
    const personas: Persona[] = [];
    const archetypes = Object.keys(input.archetypeDistribution);
    for (let i = 0; i < input.targetCount; i++) {
      const r = Math.random();
      let cum = 0;
      let chosen = archetypes[0];
      for (const a of archetypes) {
        cum += input.archetypeDistribution[a];
        if (r < cum) { chosen = a; break; }
      }
      const catalog = ARCHETYPE_CATALOG.find((c) => c.archetype === chosen) ?? ARCHETYPE_CATALOG[0];
      personas.push({
        id: `p_${i.toString().padStart(4, '0')}`,
        name: `${pick(catalog.names)} #${(i + 1).toString().padStart(4, '0')}`,
        role: catalog.role,
        archetype: chosen,
        persona: `[STUB] ${catalog.role} with exposure to the scenario.`,
        traits: pickMany(TRAIT_POOL, 3),
        preferences: `[STUB] Prioritizes downside protection.`,
      });
    }
    return personas;
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    return this.synthesizeStream(input, async () => {});
  }

  async synthesizeStream(
    input: SynthesisInput,
    onPartialReport: (partial: string) => Promise<void>
  ): Promise<SynthesisOutput> {
    await delay(500);
    const results: Record<string, string | number> = {};
    for (const v of input.outputVariables) {
      const seed = v.length * 17;
      if (v.toLowerCase().includes('%') || v.toLowerCase().includes('rate')) {
        results[v] = `${(seed % 40 - 10).toFixed(2)}%`;
      } else if (v.toLowerCase().includes('var') || v.toLowerCase().includes('value')) {
        results[v] = `$${(seed * 1.3).toFixed(1)}M`;
      } else {
        results[v] = (seed / 10).toFixed(2);
      }
    }
    const report = `# [STUB] Executive Synthesis — ${input.simulationName}\n\n## Scenario\n${input.scenarioDescription}\n\n## Headline Findings\nStub synthesis — Build 2 replaces this with Claude Opus output.\n`;
    const chunks = 5;
    for (let i = 1; i <= chunks; i++) {
      const partial = report.slice(0, Math.floor((report.length / chunks) * i));
      await onPartialReport(partial);
      await delay(200);
    }
    return {
      numericalResults: results,
      riskAnalysis: [
        { risk: 'Liquidity cascade (stub)', evidence: 'Stub evidence.', severity: 'high' },
        { risk: 'Covenant pressure (stub)', evidence: 'Stub evidence.', severity: 'high' },
        { risk: 'Valuation markdown (stub)', evidence: 'Stub evidence.', severity: 'medium' },
        { risk: 'Regulatory risk (stub)', evidence: 'Stub evidence.', severity: 'medium' },
      ],
      report,
      personas: input.personas.map((p, i) => ({
        ...p,
        influence: Math.max(1, Math.round(95 * Math.exp(-i * 0.15))),
      })),
    };
  }

  async oracleChat(input: OracleChatInput): Promise<string> {
    await delay(800);
    return `[STUB response] "${input.userMessage.slice(0, 80)}" — Build 2 wires real Claude Sonnet here.`;
  }

  async classifyDocument(input: ClassifyDocumentInput): Promise<ClassifyDocumentOutput> {
    await delay(100);
    // Deterministic keyword heuristic so stub runs produce useful-looking
    // classifications without spending on Claude. Matches filename, folder,
    // and content against short keyword lists for each workstream.
    const haystack = `${input.filename} ${input.folderPath ?? ''} ${input.ocrExcerpt.slice(0, 2000)}`.toLowerCase();
    const rules: Array<{ workstream: ClassifyDocumentOutput['workstream']; terms: string[] }> = [
      { workstream: 'legal', terms: ['contract', 'agreement', 'litigation', 'bylaw', 'article', 'ip '] },
      { workstream: 'financial', terms: ['ebitda', 'revenue', 'financial statement', 'quality of earnings', 'qoe'] },
      { workstream: 'tax', terms: ['tax return', 'nexus', 'transfer pricing', 'deferred tax', 'nols'] },
      { workstream: 'hr', terms: ['employment', 'severance', 'benefit', 'headcount', 'retention'] },
      { workstream: 'cyber_it', terms: ['cyber', 'vulnerability', 'penetration test', 'erp', 'saas', 'license'] },
      { workstream: 'customer', terms: ['customer', 'concentration', 'churn', 'receivable'] },
      { workstream: 'supplier', terms: ['supplier', 'vendor', 'supply chain', 'single-source'] },
      { workstream: 'commercial', terms: ['market', 'pricing', 'competitive', 'roadmap'] },
      { workstream: 'operations_integration', terms: ['tsa', 'carve-out', 'integration', 'migration'] },
    ];
    let bestMatch = { workstream: 'legal' as ClassifyDocumentOutput['workstream'], hits: 0 };
    for (const rule of rules) {
      const hits = rule.terms.filter((t) => haystack.includes(t)).length;
      if (hits > bestMatch.hits) bestMatch = { workstream: rule.workstream, hits };
    }
    return {
      workstream: bestMatch.workstream,
      confidence: bestMatch.hits > 0 ? Math.min(0.8, 0.4 + bestMatch.hits * 0.1) : 0.3,
      rationale: `[STUB] Matched ${bestMatch.hits} keyword${bestMatch.hits === 1 ? '' : 's'} for ${bestMatch.workstream}.`,
    };
  }
}

// ============================================================================
// Client resolution
// ============================================================================

/**
 * Returns a concrete ClaudeClient. Resolves lazily so secrets are read at
 * call time (not module load), which matters for Firebase Cloud Functions
 * secret binding where secrets are only available after invocation starts.
 */
export function getClaudeClient(): ClaudeClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const useStub = process.env.USE_STUB_CLIENTS === 'true' || !apiKey;
  if (useStub) {
    if (!apiKey) {
      logger.info('ANTHROPIC_API_KEY not set; using StubClaudeClient.');
    }
    return new StubClaudeClient();
  }
  return new AnthropicClaudeClient(apiKey);
}

/**
 * Back-compat export matching the Build 1 surface. This proxy resolves a
 * fresh ClaudeClient on every property access so secrets bound per-callable
 * are honored.
 */
export const claudeClient: ClaudeClient = new Proxy({} as ClaudeClient, {
  get(_target, prop: keyof ClaudeClient) {
    const impl = getClaudeClient();
    const value = impl[prop];
    if (typeof value === 'function') return (value as Function).bind(impl);
    return value;
  },
});
