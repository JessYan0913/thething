// ============================================================================
// System Prompt Module - Main Entry Point
// ============================================================================
//
// This module provides a modular, composable system for building system prompts.
// Inspired by Claude Code's dynamic system prompt assembly.
//
// Architecture:
// - types.ts: Core type definitions
// - builder.ts: Main prompt assembly logic
// - sections/: Individual prompt sections
//   - identity.ts: Who the agent is
//   - capabilities.ts: What the agent can do
//   - rules.ts: Behavioral rules
//   - tools.ts: Tool registry and descriptions
//   - user-preferences.ts: User-specific settings
//   - project-context.ts: THING.md multi-level merging
//   - session.ts: Dynamic per-conversation content
//
// Usage:
//   import { buildSystemPrompt } from '@/system-prompt';
//
//   const { prompt, includedSections, estimatedTokens } = await buildSystemPrompt({
//     includeProjectContext: true,
//     conversationMeta: { messageCount: 5, isNewConversation: false, conversationStartTime: Date.now() }
//   });
//
// ============================================================================

// Re-export types
export type {
  SystemPromptSection,
  BuildSystemPromptOptions,
  BuiltSystemPrompt,
  UserPreferences,
  ConversationMeta,
  AgentIdentity,
} from "./types";

// Re-export builder functions
export {
  buildSystemPrompt,
  buildSimpleSystemPrompt,
  buildTitleGenerationPrompt,
  buildIdentityOnlyPrompt,
  buildBasicPrompt,
  getAvailableSections,
} from "./builder";

// Re-export section factories for advanced usage
export {
  createIdentitySection,
  getAgentIdentity,
  updateAgentIdentity,
  AGENT_NAME,
  AGENT_ROLE,
} from "./sections/identity";
export {
  createCapabilitiesSection,
  createSelectiveCapabilitiesSection,
  CAPABILITY_CATEGORIES,
} from "./sections/capabilities";
export {
  createRulesSection,
  createLanguageRulesSection,
} from "./sections/rules";
export {
  createUserPreferencesSection,
  createResponseStyleSection,
  RESPONSE_STYLES,
} from "./sections/user-preferences";
export {
  createProjectContextSection,
  loadProjectContext,
  clearProjectContextCache,
  reloadProjectContext,
  getCachedProjectContext,
} from "./sections/project-context";
export { createSkillsSection } from "./sections/skills";
export {
  createSessionGuidanceSection,
  createFirstMessageGuidance,
  createSystemContextSection,
  DYNAMIC_BOUNDARY,
} from "./sections/session";

// ============================================================================
// Convenience Re-exports
// ============================================================================

import { buildSystemPrompt as _buildSystemPrompt } from "./builder";
import type { BuildSystemPromptOptions } from "./types";

/**
 * Convenience function: Build a complete system prompt with default options.
 */
export async function getSystemPrompt(
  options?: BuildSystemPromptOptions,
): Promise<string> {
  const result = await _buildSystemPrompt(options);
  return result.prompt;
}

import { buildIdentityOnlyPrompt } from "./builder";

/**
 * Convenience function: Build a minimal system prompt for quick responses.
 */
export function getMinimalSystemPrompt(): string {
  return buildIdentityOnlyPrompt();
}

// ============================================================================
// Module Information
// ============================================================================

/**
 * Module version following semver.
 * Update this when breaking changes are introduced.
 */
export const SYSTEM_PROMPT_MODULE_VERSION = "1.0.0";

/**
 * Feature flags for the system prompt module.
 */
export const FEATURES = {
  /** Whether THING.md multi-level merging is supported */
  MULTI_LEVEL_CONTEXT: true,

  /** Whether dynamic boundary splitting is supported */
  DYNAMIC_BOUNDARY: true,

  /** Whether user preferences are supported */
  USER_PREFERENCES: true,

  /** Whether session guidance is supported */
  SESSION_GUIDANCE: true,

  /** Whether simple mode is supported */
  SIMPLE_MODE: true,
} as const;
