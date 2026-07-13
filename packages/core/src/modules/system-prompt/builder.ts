import type {
  SystemPromptSection,
  BuildSystemPromptOptions,
  BuiltSystemPrompt,
} from "./types";

import { createIdentitySection } from "./sections/identity";
import { createCapabilitiesSection } from "./sections/capabilities";
import { createRulesSection } from "./sections/rules";
import { createActionsSection } from "./sections/actions";
import { createErrorHandlingSection } from "./sections/error-handling";
import {
  createSessionGuidanceSection,
  createFirstMessageGuidance,
  createSystemContextSection,
  DYNAMIC_BOUNDARY,
} from "./sections/session";
import { createWikiGuidelinesSection, createRecalledWikiSection } from "./sections/wiki";
import { createPermissionsSection } from "./sections/permissions";
import { formatSkillsWithinBudget } from '../skills/budget-formatter';

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: BuildSystemPromptOptions = {
  override: null,
  customInstructions: null,
  includeProjectContext: true,
  conversationMeta: null,
  skills: undefined,
  agents: undefined,
  permissions: undefined,
  projectContext: undefined,
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
  {
    name: "actions",
    create: () => createActionsSection(),
    cacheStrategy: "static",
  },
  {
    name: "error-handling",
    create: () => createErrorHandlingSection(),
    cacheStrategy: "static",
  },
];

/**
 * Session-level section factories - content changes per session.
 * 改造说明：使用传入的数据而非 cwd
 */
const SESSION_SECTION_FACTORIES: SectionFactory[] = [
  {
    name: "project-context",
    create: (options) => {
      // 使用传入的 projectContext，否则返回空 section
      if (options.projectContext?.combinedContent) {
        return {
          name: 'project-context',
          content: `【项目上下文】\n\n${options.projectContext.combinedContent}`,
          cacheStrategy: 'session' as const,
          priority: 10,
        };
      }
      return {
        name: 'project-context',
        content: null,
        cacheStrategy: 'session' as const,
        priority: 10,
      };
    },
    cacheStrategy: "session",
  },
  {
    name: "permissions",
    create: (options) => createPermissionsSection(options.permissions),
    cacheStrategy: "session",
  },
  {
    name: "skill-matching",
    create: (options) => {
      const skills = options.skills ?? [];
      const listing = skills.length > 0
        ? formatSkillsWithinBudget(skills)
        : '';

      const content = listing
        ? `## 技能\n\n${listing}\n\n如果有技能匹配用户需求，使用该技能。否则，按正常方式处理。`
        : `## 技能\n\n暂无可用技能。按正常方式处理。`;

      return {
        name: "skill-matching",
        content,
        cacheStrategy: "session" as const,
        priority: 30,
      };
    },
    cacheStrategy: "session",
  },
  {
    name: "mcp-tools",
    create: (options) => {
      const serverList = options.mcpServerTools
      const listBlock = serverList
        ? `\n${serverList}\n`
        : ''

      return {
        name: "mcp-tools",
        content: `## MCP 工具\n\nMCP 提供对外部服务的访问。${listBlock}\n当用户需求涉及外部数据或服务时，可使用相关 MCP 工具。`,
        cacheStrategy: "session" as const,
        priority: 31,
      }
    },
    cacheStrategy: "session",
  },
  {
    name: "wiki-guidelines",
    create: async (options) => {
      if (options.wikiBaseDir) {
        const section = await createWikiGuidelinesSection(
          options.wikiBaseDir,
        );
        return section ?? { name: "wiki-guidelines", content: null, cacheStrategy: "session" as const, priority: 45 };
      }
      return { name: "wiki-guidelines", content: null, cacheStrategy: "session" as const, priority: 45 };
    },
    cacheStrategy: "session",
  },
  {
    name: "recalled-wiki",
    create: async (options) => {
      if (options.wikiContext?.recalledContent) {
        const section = await createRecalledWikiSection(options.wikiContext.recalledContent);
        return section ?? { name: "recalled-wiki", content: null, cacheStrategy: "dynamic" as const, priority: 46 };
      }
      return { name: "recalled-wiki", content: null, cacheStrategy: "dynamic" as const, priority: 46 };
    },
    cacheStrategy: "dynamic",
  },
];

/**
 * Dynamic section factories - content may change every message.
 * 合并为单一 session section，减少冗余。
 */
const DYNAMIC_SECTION_FACTORIES: SectionFactory[] = [
  {
    name: "session",
    create: (options) =>
      options.conversationMeta
        ? createSessionGuidanceSection(options.conversationMeta)
        : {
            name: "session",
            content: null,
            cacheStrategy: "dynamic" as const,
            priority: 100,
          },
    cacheStrategy: "dynamic",
  },
];

// ============================================================================
// Priority Levels
// ============================================================================

const DYNAMIC_BOUNDARY_PRIORITY = 50;

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

  // Load SOUL.md for identity section
  const soulContent = await loadSoulMd();

  // Add static sections (synchronous)
  for (const factory of STATIC_SECTION_FACTORIES) {
    // Skip sections that are explicitly excluded
    if (opts.excludeSections?.includes(factory.name)) {
      continue;
    }

    // Identity section gets SOUL.md content if available
    const section = factory.name === 'identity'
      ? createIdentitySection(soulContent)
      : factory.create(opts) as SystemPromptSection;
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
    priority: DYNAMIC_BOUNDARY_PRIORITY,
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

  // SOUL.md 引导：如果灵魂文件不存在，引导 Agent 在合适时机询问
  if (!soulContent) {
    const soulGuideSection: SystemPromptSection = {
      name: "soul-guide",
      content: `【灵魂文件】
你的灵魂文件（~/.thething/SOUL.md）尚未创建。这个文件定义了你的名字、性格和说话风格。
在合适的时机，你可以询问用户是否想设定这些。用户描述后，保存到该文件。
如果用户跳过，尊重他们的选择。`,
      cacheStrategy: "session",
      priority: 201,
    };
    allSections.push(soulGuideSection);
  }

  // Filter out null content and combine
  const includedSections = allSections
    .filter((s) => s.content !== null)
    .map((s) => s.name);

  const prompt = allSections
    .filter((s) => s.content !== null)
    .map((s) => s.content)
    .join("\n\n");

  // Append ~/.thething/system-prompt.md 内容
  const systemPromptMd = await loadCustomSystemPromptMd(opts.cwd);
  const finalPrompt = systemPromptMd ? `${prompt}\n\n${systemPromptMd}` : prompt;

  const finalSections = allSections.filter((s) => s.content !== null);

  return {
    prompt: finalPrompt,
    sections: finalSections,
    includedSections,
    estimatedTokens: estimateTokens(finalPrompt),
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
// Custom system-prompt.md support
// ============================================================================

/**
 * Load the system-prompt.md file.
 * 先检查项目级（cwd/.thething/system-prompt.md），再检查用户级（~/.thething/system-prompt.md）。
 * 通过 ~/.agents → ~/.thething symlink 兼容 Agent Skills 生态工具。
 */
async function loadCustomSystemPromptMd(cwd?: string): Promise<string | null> {
  const _path = 'path';
  const _fs = 'fs/promises';
  try {
    const { default: fs } = await import(/* webpackIgnore: true */ _fs);
    const { default: path } = await import(/* webpackIgnore: true */ _path);

    const resolvedCwd = cwd ?? process.cwd();
    const homeDir = process.env.HOME || '';

    // 检查路径：项目级优先，用户级次之
    const candidates = [
      path.join(resolvedCwd, '.thething', 'system-prompt.md'),
      path.join(homeDir, '.thething', 'system-prompt.md'),
    ];

    for (const filePath of candidates) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          const content = await fs.readFile(filePath, 'utf-8');
          const trimmed = content.trim();
          if (trimmed) {
            return `【自定义系统提示】\n\n${trimmed}`;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // 动态导入失败，跳过
  }

  return null;
}

/**
 * Load the ~/.thething/SOUL.md file (Agent 灵魂定义).
 * 如果文件存在，返回其内容；不存在返回 null。
 */
async function loadSoulMd(): Promise<string | null> {
  const _path = 'path';
  const _fs = 'fs/promises';
  try {
    const { default: fs } = await import(/* webpackIgnore: true */ _fs);
    const { default: path } = await import(/* webpackIgnore: true */ _path);

    const homeDir = process.env.HOME || '';
    const soulPath = path.join(homeDir, '.thething', 'SOUL.md');

    const content = await fs.readFile(soulPath, 'utf-8');
    const trimmed = content.trim();
    return trimmed || null;
  } catch {
    return null;
  }
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
