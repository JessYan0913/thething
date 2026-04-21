import type { UIMessage } from "ai";

export type CompactionType = "auto" | "manual" | "micro";

export interface PreservedSegment {
  headUuid: string;
  anchorUuid: string;
  tailUuid: string;
}

export interface CompactMetadata {
  compactType: CompactionType;
  preCompactTokenCount: number;
  lastUserMessageUuid: string;
  preCompactDiscoveredTools?: string[];
  preservedSegment?: PreservedSegment;
}

export interface CompactBoundaryMessage extends UIMessage {
  role: "system";
  parts: Array<{
    type: "text";
    text: string;
  }>;
}

export interface CompactionResult {
  messages: UIMessage[];
  executed: boolean;
  type: CompactionType | null;
  tokensFreed: number;
  boundaryMessage?: CompactBoundaryMessage;
  summary?: string;
}

export interface SessionMemoryCompactConfig {
  minTokens: number;
  maxTokens: number;
  minTextBlockMessages: number;
}

export interface MicroCompactConfig {
  timeWindowMs: number;
  imageMaxTokenSize: number;
  compactableTools: Set<string>;
  gapThresholdMinutes: number;
  keepRecent: number;
}

export interface PostCompactConfig {
  totalBudget: number;
  maxFilesToRestore: number;
  maxTokensPerFile: number;
  maxTokensPerSkill: number;
  skillsTokenBudget: number;
}

export interface StoredSummary {
  id: string;
  conversationId: string;
  summary: string;
  compactedAt: string;
  lastMessageOrder: number;
  preCompactTokenCount: number;
}

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  maxTokens: 40_000,
  minTextBlockMessages: 5,
};

export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  timeWindowMs: 15 * 60 * 1000,
  imageMaxTokenSize: 2000,
  compactableTools: new Set([
    // 核心工具（输出通常较大）
    "web_search",
    "Read",
    "Bash",
    "Grep",
    "Glob",
    "WebSearch",
    "WebFetch",
    "Edit",
    "Write",
    // MCP 工具（动态添加）
    // Connector 工具（动态添加）
  ]),
  gapThresholdMinutes: 60,
  keepRecent: 5,
};

/**
 * 判断工具是否可压缩
 * 扩展支持 MCP 和 Connector 工具
 */
export function isCompactableTool(toolName: string, config?: MicroCompactConfig): boolean {
  const effectiveConfig = config ?? DEFAULT_MICRO_COMPACT_CONFIG;

  // 1. 精确匹配配置中的工具
  if (effectiveConfig.compactableTools.has(toolName)) {
    return true;
  }

  // 2. 前缀匹配：MCP 工具（输出可能很大）
  if (toolName.startsWith('mcp_')) {
    return true;
  }

  // 3. 前缀匹配：Connector 工具（SQL、HTTP 等可能很大）
  if (toolName.startsWith('connector_')) {
    return true;
  }

  // 4. 前缀匹配：别名工具
  const aliases: Record<string, string> = {
    'read_file': 'Read',
    'bash': 'Bash',
    'grep': 'Grep',
    'glob': 'Glob',
  };
  if (aliases[toolName] && effectiveConfig.compactableTools.has(aliases[toolName])) {
    return true;
  }

  return false;
}

export const DEFAULT_POST_COMPACT_CONFIG: PostCompactConfig = {
  totalBudget: 50_000,
  maxFilesToRestore: 5,
  maxTokensPerFile: 5_000,
  maxTokensPerSkill: 5_000,
  skillsTokenBudget: 25_000,
};

export const COMPACT_TOKEN_THRESHOLD = 25_000;

export const SYSTEM_COMPACT_BOUNDARY_MARKER = "SYSTEM_COMPACT_BOUNDARY";
