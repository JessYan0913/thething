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
  override?: string | null;
  customInstructions?: string | null;
  userPreferences?: UserPreferences | null;
  includeProjectContext?: boolean;
  conversationMeta?: ConversationMeta | null;
  memoryContext?: {
    userId: string;
    teamId?: string;
    recalledMemoriesContent?: string;
  };
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

  /**
   * The raw sections array, ordered and filtered.
   * Cache-aware consumers (e.g. Anthropic TextBlockParam[]) can use this
   * to attach cache_control per section based on cacheStrategy.
   */
  sections: SystemPromptSection[];

  /** All sections that were included (for debugging/inspection) */
  includedSections: string[];

  /** Estimated token count (approximate) */
  estimatedTokens: number;
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
