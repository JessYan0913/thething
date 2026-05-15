// ============================================================
// modules.compaction 两级语义定义
// ============================================================
//
// Level 1 - 普通自动压缩（Ordinary Auto-Compaction）:
//   modules.compaction === false → compactOptions.enabled = false
//   → compactMessagesIfNeeded 早期返回（不触发任何自动压缩）
//   → checkInitialBudget 跳过策略 1（MicroCompact）和策略 3（API Compact）
//   覆盖路径：auto-compact trigger, session-memory compact,
//              micro-compact, PTL degradation（仅在 compactMessagesIfNeeded 内）
//
// Level 2 - 紧急恢复路径（Emergency Recovery Paths）:
//   不受 modules.compaction 开关控制，始终生效：
//   → checkInitialBudget 策略 2（工具过滤）
//   → checkInitialBudget 策略 4（紧急截断）
//   → compactMessagesWithCustomInstructions（用户手动触发）
//   → PTL degradation（仅在直接调用时，不经过 compactMessagesIfNeeded）
//
// 因此 modules.compaction=false 的含义是：
//   "不主动压缩对话，但紧急情况仍可截断/降级"
// ============================================================

import type { UIMessage } from "ai";

import type { CompactionConfig as BehaviorCompactionConfig } from '../../config/behavior';

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

/**
 * Runtime Compaction Config — 行为层 CompactionConfig 的运行时版本
 * 关键区别：micro.compactableTools 从 string[] 转为 Set<string>，
 * 因为运行时函数需要 Set.has() 的 O(1) 查找。
 */
export interface RuntimeCompactionConfig {
  bufferTokens: number;
  sessionMemory: SessionMemoryCompactConfig;
  micro: MicroCompactConfig;
  postCompact: PostCompactConfig;
}

/**
 * 将 BehaviorConfig.compaction 转换为 RuntimeCompactionConfig
 * 处理 compactableTools 的 string[] → Set<string> 转换
 */
export function toRuntimeCompactionConfig(config: BehaviorCompactionConfig): RuntimeCompactionConfig {
  return {
    bufferTokens: config.bufferTokens,
    sessionMemory: config.sessionMemory,
    micro: {
      ...config.micro,
      compactableTools: new Set(config.micro.compactableTools),
    },
    postCompact: config.postCompact,
  };
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
