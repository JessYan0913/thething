// ============================================================================
// System Prompt Module - Types
// ============================================================================

/**
 * A section of the system prompt that can be dynamically assembled.
 * Each section has a name for identification and a cache strategy.
 */
export interface SystemPromptSection {
  /** Unique identifier for this section */
  name: string;

  /** The actual content of this section */
  content: string | null; // null means section should be skipped

  /**
   * Cache strategy for this section.
   * - 'static': Content rarely or never changes (e.g., identity, capabilities)
   * - 'session': Content changes per session but not per message (e.g., project context)
   * - 'dynamic': Content may change every message (e.g., enabled tools)
   */
  cacheStrategy: 'static' | 'session' | 'dynamic';

  /** Priority - lower numbers are included first */
  priority: number;
}

/**
 * Options for building the complete system prompt.
 */
export interface BuildSystemPromptOptions {
  /** Override the entire system prompt (bypasses all other sections) */
  override?: string | null;

  /** Custom instructions to append or replace */
  customInstructions?: string | null;

  /** User preferences loaded from storage */
  userPreferences?: UserPreferences | null;

  /** Whether to include project context (CLAUDE.md files) */
  includeProjectContext?: boolean;

  /** Whether to include tools section */
  includeTools?: boolean;

  /** Current conversation metadata for session guidance */
  conversationMeta?: ConversationMeta | null;
}

/**
 * User preferences that influence agent behavior.
 */
export interface UserPreferences {
  /** Preferred language for responses */
  language?: string;

  /** User's professional domain */
  domain?: string;

  /** Preferred response style */
  responseStyle?: 'concise' | 'detailed' | 'balanced';

  /** Custom system prompt additions from user */
  customSystemPrompt?: string;
}

/**
 * Metadata about the current conversation for session-level guidance.
 */
export interface ConversationMeta {
  /** Number of messages in this conversation so far */
  messageCount: number;

  /** Unix timestamp when the conversation started */
  conversationStartTime: number;

  /** Whether this is a new conversation */
  isNewConversation: boolean;
}

/**
 * Result of building a system prompt.
 */
export interface BuiltSystemPrompt {
  /** The assembled system prompt string */
  prompt: string;

  /** All sections that were included (for debugging/inspection) */
  includedSections: string[];

  /** Estimated token count (approximate) */
  estimatedTokens: number;
}

/**
 * Tool definition for the tools section.
 */
export interface ToolDefinition {
  /** Unique name of the tool */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** Example usage (optional) */
  example?: string;

  /** Whether this tool is enabled for the current session */
  enabled: boolean;
}

/**
 * Agent identity configuration.
 */
export interface AgentIdentity {
  /** Agent's display name */
  name: string;

  /** Agent's role/role description */
  role: string;

  /** Additional identity traits */
  traits?: string[];
}
