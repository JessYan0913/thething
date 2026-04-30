import type { UIMessage } from "ai";

// ============================================================
// Compaction 配置来源说明
// ============================================================
// 重要：以下配置常量已迁移到 BehaviorConfig.compaction
// - DEFAULT_SESSION_MEMORY_CONFIG → behavior.compaction.sessionMemory
// - DEFAULT_MICRO_COMPACT_CONFIG_RAW → behavior.compaction.micro
// - DEFAULT_POST_COMPACT_CONFIG → behavior.compaction.postCompact
//
// 调用方应从 runtime.behavior 获取配置并传入 compaction 函数参数
// 此处保留 defaults 导入作为 fallback 和向后兼容
// ============================================================

// 从统一配置模块导入常量（作为 fallback）
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
  DEFAULT_MICRO_COMPACT_CONFIG_RAW,
  DEFAULT_POST_COMPACT_CONFIG,
  COMPACT_TOKEN_THRESHOLD,
} from '../../config/defaults';

// 导出压缩阈值供其他模块使用
export { COMPACT_TOKEN_THRESHOLD };

// 导出其他配置（无需转换）
export { DEFAULT_SESSION_MEMORY_CONFIG, DEFAULT_POST_COMPACT_CONFIG };

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

// 使用统一配置中的默认值
// 注意：DEFAULT_MICRO_COMPACT_CONFIG 需要将数组转换为 Set
const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  ...DEFAULT_MICRO_COMPACT_CONFIG_RAW,
  compactableTools: new Set(DEFAULT_MICRO_COMPACT_CONFIG_RAW.compactableTools),
};

// 导出供本模块和其他模块使用
export { DEFAULT_MICRO_COMPACT_CONFIG };

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

export const SYSTEM_COMPACT_BOUNDARY_MARKER = "SYSTEM_COMPACT_BOUNDARY";
