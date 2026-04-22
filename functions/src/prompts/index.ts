/**
 * System Prompts
 *
 * Versioned, code-reviewed prompts for each Claude touchpoint in the pipeline.
 * Every change to a prompt must come with (a) a version bump in the comment
 * block at the top of the file, (b) a changelog entry, and (c) a run through
 * the golden-output test suite (see docs/testing.md — Build 3+).
 *
 * Prompts live separately from the client so they can be edited without
 * touching orchestration code, and so the LLM engineer and the platform
 * engineer can work in parallel.
 */

export { RESEARCH_SYSTEM_PROMPT, buildResearchUserPrompt } from './research.js';
export { PERSONA_SYSTEM_PROMPT, buildPersonaUserPrompt } from './personas.js';
export { SYNTHESIS_SYSTEM_PROMPT, buildSynthesisUserPrompt } from './synthesis.js';
export { ORACLE_SYSTEM_PROMPT, buildOracleUserPrompt } from './oracle.js';
export { CLASSIFIER_SYSTEM_PROMPT, buildClassifierUserPrompt } from './classifier.js';
