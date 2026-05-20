// ============================================================
// Tool Output Manager - 工具输出管理模块
// ============================================================
// 参考 Claude Code 的三层截断机制：
// 1. 单工具阈值截断
// 2. 消息级预算检查
// 3. 状态稳定性（保证 prompt cache）
// ============================================================

// ============================================================
// Tool Output 配置来源说明
// ============================================================
// 重要：以下配置常量已迁移到 BehaviorConfig.toolOutput
// - DEFAULT_MAX_RESULT_SIZE_CHARS → behavior.toolOutput.maxResultSizeChars
// - MAX_TOOL_RESULT_TOKENS → behavior.toolOutput.maxToolResultTokens
// - MAX_TOOL_RESULTS_PER_MESSAGE_CHARS → behavior.toolOutput.maxToolResultsPerMessageChars
// - PREVIEW_SIZE_CHARS → behavior.toolOutput.previewSizeChars
//
// 调用方应从 runtime.behavior 获取配置
// 此处保留 defaults 导入作为 fallback 和向后兼容
// ============================================================

// 从统一配置模块导入常量（作为 fallback）
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
} from '../../services/config/defaults';
import { BYTES_PER_TOKEN } from '../../primitives/constants';
import { persistToolResult, buildPersistedOutputMessage } from './tool-result-storage';

const MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN;

// 重新导出供预算模块内部和测试复用
export {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
};

// 从共享常量模块导入（打破循环依赖）
export {
  PERSISTED_OUTPUT_TAG,
  PERSISTED_OUTPUT_CLOSING_TAG,
  TOOL_RESULT_CLEARED_MESSAGE,
} from './tool-output-constants';
export type { PersistedToolResult, ToolOutputConfig, ContentReplacementState } from './tool-output-constants';
export { getPreviewSizeLimit } from './tool-output-constants';

// ============================================================
// 配置注入（替代 GrowthBook）
// ============================================================
// Core 只接收应用层注入的配置，不直接读取环境变量或远程配置
// 应用层可根据需要从环境变量、配置文件、远程服务等获取配置

// ============================================================
// 内部工具函数
// ============================================================

import type { ToolOutputConfig, ContentReplacementState, PersistedToolResult } from './tool-output-constants';
import { getPreviewSizeLimit } from './tool-output-constants';

function getMaxToolResultTokens(sessionConfig?: ToolOutputConfig): number {
  const override = sessionConfig?.maxResultTokens
  if (typeof override === 'number' && override > 0) {
    return override
  }
  return MAX_TOOL_RESULT_TOKENS
}

export function getMessageBudgetLimit(sessionConfig?: ToolOutputConfig): number {
  const override = sessionConfig?.messageBudget
  if (typeof override === 'number' && override > 0) {
    return override
  }
  return MAX_TOOL_RESULTS_PER_MESSAGE_CHARS
}

function applyConfigOverride(baseConfig: ToolOutputConfig, sessionConfig?: ToolOutputConfig): ToolOutputConfig {
  if (!sessionConfig) {
    return baseConfig
  }
  return {
    ...baseConfig,
    maxResultSizeChars: sessionConfig.maxResultSizeChars > 0
      ? sessionConfig.maxResultSizeChars
      : baseConfig.maxResultSizeChars,
    maxResultTokens: sessionConfig.maxResultTokens ?? baseConfig.maxResultTokens,
    messageBudget: sessionConfig.messageBudget ?? baseConfig.messageBudget,
    previewSizeChars: sessionConfig.previewSizeChars ?? baseConfig.previewSizeChars,
  }
}

/**
 * 内容替换记录（用于 transcript 存储）
 */
export interface ContentReplacementRecord {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}

// ============================================================
// 工具输出配置表
// ============================================================

/**
 * 工具输出配置表
 * 每工具自定义阈值
 * 改进：所有工具的大输出都应该持久化，不再截断
 */
export const TOOL_OUTPUT_CONFIGS: Record<string, ToolOutputConfig> = {
  // 内置工具
  'bash': {
    maxResultSizeChars: 100_000,
    // shouldPersistToDisk 默认 true
  },
  'read_file': {
    maxResultSizeChars: 50_000,
  },
  'write_file': {
    maxResultSizeChars: 10_000,
  },
  'edit_file': {
    maxResultSizeChars: 10_000,
  },
  'grep': {
    maxResultSizeChars: 30_000,
  },
  'glob': {
    maxResultSizeChars: 20_000,
  },
  'exa_search': {
    maxResultSizeChars: 20_000,
  },

  // 外部工具默认配置
  'mcp_default': {
    maxResultSizeChars: 100_000,
  },
  'connector_default': {
    maxResultSizeChars: 50_000,
  },

  // 默认配置
  'default': {
    maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  },
}

// ============================================================
// 配置获取函数
// ============================================================

/**
 * 前缀匹配工具类型
 * 支持 mcp_* 和 connector_* 前缀
 */
export function matchesToolPrefix(toolName: string): string | null {
  if (toolName.startsWith('mcp_')) {
    return 'mcp'
  }
  if (toolName.startsWith('connector_')) {
    return 'connector'
  }
  return null
}

/**
 * 获取工具输出配置
 * 支持：精确匹配 → 前缀匹配 → 默认配置，再叠加 session 级配置
 */
export function getToolOutputConfig(toolName: string, sessionConfig?: ToolOutputConfig): ToolOutputConfig {
  // 1. 精确匹配
  if (TOOL_OUTPUT_CONFIGS[toolName]) {
    return applyConfigOverride(TOOL_OUTPUT_CONFIGS[toolName], sessionConfig)
  }

  // 2. 前缀匹配
  const prefix = matchesToolPrefix(toolName)
  if (prefix === 'mcp' && TOOL_OUTPUT_CONFIGS['mcp_default']) {
    return applyConfigOverride(TOOL_OUTPUT_CONFIGS['mcp_default'], sessionConfig)
  }
  if (prefix === 'connector' && TOOL_OUTPUT_CONFIGS['connector_default']) {
    return applyConfigOverride(TOOL_OUTPUT_CONFIGS['connector_default'], sessionConfig)
  }

  // 3. 默认配置
  return applyConfigOverride(TOOL_OUTPUT_CONFIGS['default'], sessionConfig)
}


// ============================================================
// 状态管理函数
// ============================================================

/**
 * 创建内容替换状态
 */
export function createContentReplacementState(): ContentReplacementState {
  return {
    seenIds: new Set(),
    replacements: new Map(),
  }
}

/**
 * 克隆内容替换状态（用于子代理）
 */
export function cloneContentReplacementState(
  source: ContentReplacementState
): ContentReplacementState {
  return {
    seenIds: new Set(source.seenIds),
    replacements: new Map(source.replacements),
  }
}

// ============================================================
// 工具输出内容估算
// ============================================================

/**
 * 估算字符串内容的 Token 数量
 */
export function estimateContentTokens(content: string): number {
  // 保守估计：每 Token 约 3.5 字符
  return Math.ceil(content.length / 3.5)
}

/**
 * 估算对象内容的 Token 数量
 */
export function estimateObjectTokens(obj: unknown): number {
  try {
    const json = JSON.stringify(obj)
    // JSON 密集格式：每 Token 仅 1-2 字符
    return Math.ceil(json.length / 2)
  } catch {
    return DEFAULT_MAX_RESULT_SIZE_CHARS / 3.5
  }
}

/**
 * 计算工具输出大小（字符数）
 */
export function calculateOutputSize(output: unknown): number {
  if (!output) return 0
  if (typeof output === 'string') return output.length
  try {
    return JSON.stringify(output).length
  } catch {
    return 0
  }
}

// ============================================================
// 工具输出处理入口
// ============================================================

/**
 * 处理工具输出结果
 * 统一的入口函数，供各工具调用
 *
 * @param output 工具返回的原始输出
 * @param toolName 工具名称
 * @param toolUseId 工具调用 ID
 * @param sessionState 会话状态（可选，用于持久化）
 */
export async function processToolOutput(
  output: unknown,
  toolName: string,
  toolUseId: string,
  options?: {
    sessionId?: string
    dataDir?: string
    state?: ContentReplacementState
    /** per-session 工具输出配置 */
    config?: ToolOutputConfig
  }
): Promise<{
  content: string
  persisted: boolean
  filepath?: string
  originalSize: number
}> {
  const sessionConfig = options?.config;
  const config = getToolOutputConfig(toolName, sessionConfig)
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  const originalSize = content.length
  const originalTokens = estimateContentTokens(content)
  const maxResultTokens = config.maxResultTokens ?? getMaxToolResultTokens(sessionConfig)

  // 检查是否需要处理
  if (originalSize <= config.maxResultSizeChars && originalTokens <= maxResultTokens) {
    // 不需要处理，直接返回
    if (options?.state) {
      options.state.seenIds.add(toolUseId)
    }
    return { content, persisted: false, originalSize }
  }

  // ✅ 改进：始终持久化，不再截断
  // 如果没有 sessionContext，使用临时目录
  const sessionId = options?.sessionId ?? `temp-${Date.now()}`
  const dataDir = options?.dataDir ?? process.cwd()

  const persisted = await persistToDisk(
    content,
    toolUseId,
    sessionId,
    dataDir,
    !options?.sessionId,  // isTemporary: 标记是否为临时持久化
    sessionConfig,
  )

  if (options?.state) {
    options.state.seenIds.add(toolUseId)
    options.state.replacements.set(toolUseId, persisted.preview)
  }

  return {
    content: persisted.message,
    persisted: true,
    filepath: persisted.filepath,
    originalSize,
  }
}

/**
 * 持久化到磁盘（内部函数）
 * 实际持久化逻辑在 tool-result-storage.ts 中实现
 */
async function persistToDisk(
  content: string,
  toolUseId: string,
  sessionId: string,
  dataDir: string,
  isTemporary: boolean = false,
  sessionConfig?: ToolOutputConfig,
): Promise<{ filepath: string; message: string; preview: string }> {
  const result = await persistToolResult(content, toolUseId, sessionId, dataDir, sessionConfig)
  const message = buildPersistedOutputMessage(result, isTemporary, sessionConfig)

  return {
    filepath: result.filepath,
    message,
    preview: result.preview,
  }
}

// ============================================================
// 类型导出（在接口定义处已导出）
// ============================================================
