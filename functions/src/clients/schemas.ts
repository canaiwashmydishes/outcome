/**
 * Tool schemas for Claude structured output.
 *
 * We use the tool_use pattern (not yet the newer output_config.format) because
 * the TypeScript SDK types fully support tool_use today. When Anthropic's TS
 * SDK stabilizes output_config types, migration is a single-file change.
 *
 * Design rules:
 *   • additionalProperties: false — Claude sometimes invents extra keys
 *     otherwise.
 *   • required: [] lists every field that must be present. Optional fields
 *     are still declared but omitted from required.
 *   • Do NOT include constraints like minLength, pattern, minimum, or format
 *     in the schema — Anthropic strips some of them and they can cause 400s.
 *     Validate constraints post-parse in Zod if needed.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// Phase 1 — Research
// ============================================================================

export const RESEARCH_TOOL: Tool = {
  name: 'emit_research',
  description:
    'Emit the contextual research output for this stress test configuration. Use this tool and only this tool; do not reply in prose.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        description:
          'Exactly 5 high-signal research questions a professional analyst would ask before running this stress test.',
        items: { type: 'string' },
      },
      taxonomyMapping: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primaryTest: {
            type: 'string',
            description: 'The primary stress-test id.',
          },
          secondaryTests: {
            type: 'array',
            description: 'Up to 2 secondary test ids if the scenario is multi-faceted. Empty array if not.',
            items: { type: 'string' },
          },
          rationale: {
            type: 'string',
            description: 'One paragraph under 80 words explaining why this test type fits the scenario.',
          },
        },
        required: ['primaryTest', 'secondaryTests', 'rationale'],
      },
      archetypeDistribution: {
        type: 'object',
        description:
          'Refined persona archetype weights summing to 1.0. Keys must come from the closed archetype set; values between 0.05 and 0.50.',
        additionalProperties: { type: 'number' },
      },
    },
    required: ['questions', 'taxonomyMapping', 'archetypeDistribution'],
  },
};

// ============================================================================
// Phase 2 — Personas
// ============================================================================

export const PERSONA_TOOL: Tool = {
  name: 'emit_personas',
  description:
    'Emit the batch of PE personas for swarm injection. Use this tool and only this tool; do not reply in prose.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      personas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
            archetype: { type: 'string' },
            persona: { type: 'string' },
            traits: {
              type: 'array',
              items: { type: 'string' },
            },
            preferences: { type: 'string' },
          },
          required: ['name', 'role', 'archetype', 'persona', 'traits', 'preferences'],
        },
      },
    },
    required: ['personas'],
  },
};

// ============================================================================
// Phase 4 — Synthesis
// ============================================================================

export const SYNTHESIS_TOOL: Tool = {
  name: 'emit_synthesis',
  description:
    'Emit the four synthesis deliverables: numerical results, 4-item risk analysis, personas with finalized influence, and the executive report.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      numericalResults: {
        type: 'object',
        description: 'Keyed by the exact output variable names from the taxonomy. Values are human-readable strings.',
        additionalProperties: { type: 'string' },
      },
      riskAnalysis: {
        type: 'array',
        description: 'Exactly 4 strategic risk items.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            risk: { type: 'string' },
            evidence: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
          },
          required: ['risk', 'evidence', 'severity'],
        },
      },
      personas: {
        type: 'array',
        description:
          'All input personas re-emitted with an additional integer influence field (1-100). Use original persona ids and names.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            archetype: { type: 'string' },
            persona: { type: 'string' },
            traits: { type: 'array', items: { type: 'string' } },
            preferences: { type: 'string' },
            influence: { type: 'integer' },
          },
          required: ['id', 'name', 'role', 'archetype', 'persona', 'traits', 'preferences', 'influence'],
        },
      },
      report: {
        type: 'string',
        description: 'Executive markdown report, 400-600 words, following the 4-section structure from the system prompt.',
      },
    },
    required: ['numericalResults', 'riskAnalysis', 'personas', 'report'],
  },
};

// ============================================================================
// Build B — Document Classifier
// ============================================================================

export const CLASSIFIER_TOOL: Tool = {
  name: 'classify_document',
  description:
    'Emit the workstream classification for the provided document. Use this tool and only this tool; do not reply in prose.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      workstream: {
        type: 'string',
        description: 'One of the nine workstream ids.',
        enum: [
          'legal',
          'financial',
          'tax',
          'hr',
          'cyber_it',
          'commercial',
          'customer',
          'supplier',
          'operations_integration',
        ],
      },
      confidence: {
        type: 'number',
        description: 'Confidence in the classification, 0.0–1.0.',
      },
      rationale: {
        type: 'string',
        description: 'One short sentence (under 20 words) justifying the classification.',
      },
    },
    required: ['workstream', 'confidence', 'rationale'],
  },
};
