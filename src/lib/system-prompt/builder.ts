import type {
  SystemPromptSection,
  BuildSystemPromptOptions,
  BuiltSystemPrompt,
} from "./types";

import { createIdentitySection } from "./sections/identity";
import { createCapabilitiesSection } from "./sections/capabilities";
import {
  createRulesSection,
  createLanguageRulesSection,
} from "./sections/rules";
import {
  createUserPreferencesSection,
  createResponseStyleSection,
} from "./sections/user-preferences";
import {
  createSessionGuidanceSection,
  createFirstMessageGuidance,
  createSystemContextSection,
  DYNAMIC_BOUNDARY,
} from "./sections/session";
import { createProjectContextSection } from "./sections/project-context";
import { createSkillsSection } from "./sections/skills";
import { createMemorySection, createRecalledMemorySection } from "./sections/memory";

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: BuildSystemPromptOptions = {
  override: null,
  customInstructions: null,
  userPreferences: null,
  includeProjectContext: true,
  conversationMeta: null,
};

// ============================================================================
// Section Factories
// ============================================================================

/**
 * Registry of section factories.
 * Each factory is responsible for creating its section.
 */
interface SectionFactory {
  name: string;
  create: (
    options: BuildSystemPromptOptions,
  ) => SystemPromptSection | Promise<SystemPromptSection>;
  cacheStrategy: "static" | "session" | "dynamic";
}

/**
 * Static section factories - content rarely changes.
 */
const STATIC_SECTION_FACTORIES: SectionFactory[] = [
  {
    name: "identity",
    create: () => createIdentitySection(),
    cacheStrategy: "static",
  },
  {
    name: "capabilities",
    create: () => createCapabilitiesSection(),
    cacheStrategy: "static",
  },
  {
    name: "rules",
    create: () => createRulesSection(),
    cacheStrategy: "static",
  },
];

/**
 * Session-level section factories - content changes per session.
 */
const SESSION_SECTION_FACTORIES: SectionFactory[] = [
  {
    name: "language-rules",
    create: (options) =>
      createLanguageRulesSection(options.userPreferences?.language),
    cacheStrategy: "session",
  },
  {
    name: "response-style",
    create: (options) =>
      options.userPreferences?.responseStyle
        ? createResponseStyleSection(
            options.userPreferences.responseStyle as
              | "concise"
              | "detailed"
              | "balanced",
          )
        : {
            name: "response-style",
            content: null,
            cacheStrategy: "session" as const,
            priority: 15,
          },
    cacheStrategy: "session",
  },
  {
    name: "user-preferences",
    create: (options) =>
      createUserPreferencesSection(options.userPreferences ?? null),
    cacheStrategy: "session",
  },
  {
    name: "project-context",
    create: () => createProjectContextSection(),
    cacheStrategy: "session",
  },
  {
    name: "skills",
    create: () => createSkillsSection(),
    cacheStrategy: "session",
  },
  {
    name: "memory-guidelines",
    create: async (options) => {
      if (options.memoryContext?.userId) {
        const section = await createMemorySection(options.memoryContext.userId, options.memoryContext.teamId);
        return section ?? { name: "memory-guidelines", content: null, cacheStrategy: "session" as const, priority: 45 };
      }
      return { name: "memory-guidelines", content: null, cacheStrategy: "session" as const, priority: 45 };
    },
    cacheStrategy: "session",
  },
  {
    name: "recalled-memories",
    create: async (options) => {
      if (options.memoryContext?.recalledMemoriesContent) {
        const section = await createRecalledMemorySection(options.memoryContext.recalledMemoriesContent);
        return section ?? { name: "recalled-memories", content: null, cacheStrategy: "dynamic" as const, priority: 46 };
      }
      return { name: "recalled-memories", content: null, cacheStrategy: "dynamic" as const, priority: 46 };
    },
    cacheStrategy: "dynamic",
  },
];

/**
 * Dynamic section factories - content may change every message.
 */
const DYNAMIC_SECTION_FACTORIES: SectionFactory[] = [
  {
    name: "system-context",
    create: () => createSystemContextSection(),
    cacheStrategy: "dynamic",
  },
  {
    name: "session-guidance",
    create: (options) =>
      options.conversationMeta
        ? createSessionGuidanceSection(options.conversationMeta)
        : {
            name: "session-guidance",
            content: null,
            cacheStrategy: "dynamic" as const,
            priority: 100,
          },
    cacheStrategy: "dynamic",
  },
  {
    name: "first-message-guidance",
    create: (options) =>
      options.conversationMeta?.isNewConversation
        ? createFirstMessageGuidance()
        : {
            name: "first-message-guidance",
            content: null,
            cacheStrategy: "dynamic" as const,
            priority: 99,
          },
    cacheStrategy: "dynamic",
  },
];

// ============================================================================
// Priority Levels
// ============================================================================

const PRIORITY = {
  IDENTITY: 1,
  CAPABILITIES: 2,
  RULES: 3,
  LANGUAGE_RULES: 4,
  RESPONSE_STYLE: 15,
  USER_PREFERENCES: 20,
  TOOLS: 30,
  MEMORY_GUIDELINES: 45,
  RECALLED_MEMORIES: 46,
  DYNAMIC_BOUNDARY: 50,
  PROJECT_CONTEXT: 60,
  SESSION_GUIDANCE: 100,
  FIRST_MESSAGE: 101,
} as const;

// ============================================================================
// Main Builder Function
// ============================================================================

/**
 * Builds the complete system prompt from all sections.
 *
 * Priority order (lower number = comes first):
 * 1. Identity
 * 2. Capabilities
 * 3. Rules
 * 4. Language Rules
 * 5. Response Style
 * 6. User Preferences
 * 7. Tools
 * [DYNAMIC_BOUNDARY]
 * 8. Project Context (if enabled)
 * 9. Session Guidance
 * 10. First Message Guidance (if new conversation)
 *
 * Custom instructions are appended at the end unless override is set.
 */
export async function buildSystemPrompt(
  options: BuildSystemPromptOptions = {},
): Promise<BuiltSystemPrompt> {
  // Merge with defaults
  const opts: BuildSystemPromptOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // Override mode - use only the override text
  if (opts.override) {
    return {
      prompt: opts.override,
      sections: [{ name: "override", content: opts.override, cacheStrategy: "dynamic", priority: 0 }],
      includedSections: ["override"],
      estimatedTokens: estimateTokens(opts.override),
    };
  }

  // Collect all sections
  const allSections: SystemPromptSection[] = [];

  // Add static sections (synchronous)
  for (const factory of STATIC_SECTION_FACTORIES) {
    const section = factory.create(opts) as SystemPromptSection;
    if (section.content) {
      allSections.push(section);
    }
  }

  // Add session sections (async)
  for (const factory of SESSION_SECTION_FACTORIES) {
    // Skip sections that are explicitly disabled in options
    if (opts.override && opts.override.includes(factory.name)) {
      continue;
    }

    const section = (await factory.create(opts)) as SystemPromptSection;
    if (section.content) {
      allSections.push(section);
    }
  }

  // Sort all sections by priority
  allSections.sort((a, b) => a.priority - b.priority);

  // Insert dynamic boundary marker
  const dynamicBoundarySection: SystemPromptSection = {
    name: "dynamic-boundary",
    content: `\n\n${DYNAMIC_BOUNDARY}\n\n`,
    cacheStrategy: "dynamic",
    priority: PRIORITY.DYNAMIC_BOUNDARY,
  };

  // Find where to insert the dynamic boundary (after tools, before project context)
  const toolsIndex = allSections.findIndex((s) => s.name === "tools");
  if (toolsIndex !== -1) {
    allSections.splice(toolsIndex + 1, 0, dynamicBoundarySection);
  } else {
    // Insert before project context if tools not present
    const projectIndex = allSections.findIndex(
      (s) => s.name === "project-context",
    );
    if (projectIndex !== -1) {
      allSections.splice(projectIndex, 0, dynamicBoundarySection);
    } else {
      allSections.push(dynamicBoundarySection);
    }
  }

  // Add dynamic sections
  for (const factory of DYNAMIC_SECTION_FACTORIES) {
    const section = await factory.create(opts);
    if (section.content) {
      allSections.push(section);
    }
  }

  // Add custom instructions at the end
  if (opts.customInstructions) {
    const customSection: SystemPromptSection = {
      name: "custom-instructions",
      content: opts.customInstructions,
      cacheStrategy: "static",
      priority: 200,
    };
    allSections.push(customSection);
  }

  // Filter out null content and combine
  const includedSections = allSections
    .filter((s) => s.content !== null)
    .map((s) => s.name);

  const prompt = allSections
    .filter((s) => s.content !== null)
    .map((s) => s.content)
    .join("\n\n");

  const finalSections = allSections.filter((s) => s.content !== null);

  return {
    prompt,
    sections: finalSections,
    includedSections,
    estimatedTokens: estimateTokens(prompt),
  };
}

/**
 * Builds a simple system prompt without any dynamic content.
 * Useful for quick responses or testing.
 */
export function buildSimpleSystemPrompt(): string {
  const sections: string[] = [];

  sections.push(createIdentitySection().content!);
  sections.push(createCapabilitiesSection().content!);
  sections.push(createRulesSection().content!);

  return sections.filter(Boolean).join("\n\n");
}

/**
 * Builds a minimal system prompt for title generation.
 * This is used internally for conversation title generation.
 */
export function buildTitleGenerationPrompt(): string {
  return "你是一个对话标题生成助手。请根据用户的首条消息和AI的回复，生成一个简洁、准确的对话标题。";
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Estimates token count from text.
 * This is a rough approximation: ~4 characters per token for Chinese/English mixed text.
 */
function estimateTokens(text: string): number {
  // Simple estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Gets all available section names.
 */
export function getAvailableSections(): string[] {
  return [
    ...STATIC_SECTION_FACTORIES.map((f) => f.name),
    ...SESSION_SECTION_FACTORIES.map((f) => f.name),
    ...DYNAMIC_SECTION_FACTORIES.map((f) => f.name),
  ];
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Build a system prompt with just the identity.
 */
export function buildIdentityOnlyPrompt(): string {
  return createIdentitySection().content || "";
}

/**
 * Build a system prompt with identity and capabilities.
 */
export function buildBasicPrompt(): string {
  const sections: string[] = [];
  const identity = createIdentitySection();
  const capabilities = createCapabilitiesSection();
  const rules = createRulesSection();

  if (identity.content) sections.push(identity.content);
  if (capabilities.content) sections.push(capabilities.content);
  if (rules.content) sections.push(rules.content);

  return sections.join("\n\n");
}
