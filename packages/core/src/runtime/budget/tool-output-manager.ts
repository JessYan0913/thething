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
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  BYTES_PER_TOKEN,
} from '../../config/defaults';

// 重新导出供其他模块使用（向后兼容，后续将标记 deprecated）
export {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
};

/** 持久化输出 XML 标签 */
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

/** 内容清除标记（用于 MicroCompact） */
export const TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]'

// ============================================================
// 配置注入（替代 GrowthBook）
// ============================================================
// Core 只接收应用层注入的配置，不直接读取环境变量或远程配置
// 应用层可根据需要从环境变量、配置文件、远程服务等获取配置

/**
 * 工具输出配置覆盖
 * 应用层注入，用于动态调整阈值
 */
export interface ToolOutputOverrides {
  /** 工具阈值覆盖（工具名 -> 最大字符数） */
  thresholds?: Record<string, number>
  /** 消息预算覆盖（总额上限字符数） */
  messageBudget?: number
}

/** 当前配置覆盖（全局单例，由应用层设置） */
let currentOverrides: ToolOutputOverrides = {}

/**
 * 设置配置覆盖（由应用层调用）
 */
export function setToolOutputOverrides(overrides: ToolOutputOverrides): void {
  currentOverrides = overrides
}

/**
 * 获取当前配置覆盖
 */
export function getToolOutputOverrides(): ToolOutputOverrides {
  return currentOverrides
}

/**
 * 应用配置覆盖
 */
function applyConfigOverride(
  toolName: string,
  baseConfig: ToolOutputConfig
): ToolOutputConfig {
  const thresholdOverride = currentOverrides.thresholds?.[toolName]
  if (typeof thresholdOverride === 'number' && thresholdOverride > 0) {
    return { ...baseConfig, maxResultSizeChars: thresholdOverride }
  }
  return baseConfig
}

/**
 * 获取消息级预算限制
 * 支持应用层覆盖
 */
export function getMessageBudgetLimit(): number {
  const override = currentOverrides.messageBudget
  if (typeof override === 'number' && override > 0) {
    return override
  }
  return MAX_TOOL_RESULTS_PER_MESSAGE_CHARS
}

// ============================================================
// 类型定义
// ============================================================

/**
 * 工具输出配置
 * 改进：所有工具的大输出都应该持久化，不再截断
 */
export interface ToolOutputConfig {
  /** 最大字符数 */
  maxResultSizeChars: number
  /** 是否持久化到磁盘（默认 true，现在可选） */
  shouldPersistToDisk?: boolean
}

/**
 * 内容替换状态
 * 保证相同工具调用在不同轮次中做出相同决策（prompt cache 稳定）
 */
export interface ContentReplacementState {
  /** 已处理过的工具调用 ID */
  seenIds: Set<string>
  /** 持久化后的预览内容（tool_use_id -> preview string） */
  replacements: Map<string, string>
}

/**
 * 持久化结果
 */
export interface PersistedToolResult {
  filepath: string
  originalSize: number
  preview: string
  hasMore: boolean
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
 * 支持：精确匹配 → 前缀匹配 → 配置覆盖 → 默认配置
 */
export function getToolOutputConfig(toolName: string): ToolOutputConfig {
  // 1. 精确匹配
  if (TOOL_OUTPUT_CONFIGS[toolName]) {
    return applyConfigOverride(toolName, TOOL_OUTPUT_CONFIGS[toolName])
  }

  // 2. 前缀匹配
  const prefix = matchesToolPrefix(toolName)
  if (prefix === 'mcp' && TOOL_OUTPUT_CONFIGS['mcp_default']) {
    return applyConfigOverride(toolName, TOOL_OUTPUT_CONFIGS['mcp_default'])
  }
  if (prefix === 'connector' && TOOL_OUTPUT_CONFIGS['connector_default']) {
    return applyConfigOverride(toolName, TOOL_OUTPUT_CONFIGS['connector_default'])
  }

  // 3. 默认配置
  return applyConfigOverride(toolName, TOOL_OUTPUT_CONFIGS['default'])
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

/**
 * 从 transcript 记录重建状态
 */
export function reconstructContentReplacementState(
  messages: unknown[],
  records: ContentReplacementRecord[]
): ContentReplacementState {
  const state = createContentReplacementState()

  // 从记录中恢复 replacements
  for (const record of records) {
    if (record.kind === 'tool-result') {
      state.replacements.set(record.toolUseId, record.replacement)
    }
  }

  // 从消息中提取所有已处理的 tool_use_id
  // TODO: 实现消息遍历提取 tool_result 中的 tool_use_id

  return state
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
    projectDir?: string
    state?: ContentReplacementState
  }
): Promise<{
  content: string
  persisted: boolean
  filepath?: string
  originalSize: number
}> {
  const config = getToolOutputConfig(toolName)
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  const originalSize = content.length

  // 检查是否需要处理
  if (originalSize <= config.maxResultSizeChars) {
    // 不需要处理，直接返回
    if (options?.state) {
      options.state.seenIds.add(toolUseId)
    }
    return { content, persisted: false, originalSize }
  }

  // ✅ 改进：始终持久化，不再截断
  // 如果没有 sessionContext，使用临时目录
  const sessionId = options?.sessionId ?? `temp-${Date.now()}`
  const projectDir = options?.projectDir ?? process.cwd()

  const persisted = await persistToDisk(
    content,
    toolUseId,
    sessionId,
    projectDir,
    config.maxResultSizeChars,
    !options?.sessionId  // isTemporary: 标记是否为临时持久化
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
  projectDir: string,
  _maxSize: number,
  isTemporary: boolean = false
): Promise<{ filepath: string; message: string; preview: string }> {
  // 动态导入避免循环依赖
  const { persistToolResult, buildPersistedOutputMessage } = await import('./tool-result-storage')

  const result = await persistToolResult(content, toolUseId, sessionId, projectDir)
  const message = buildPersistedOutputMessage(result, isTemporary)

  return {
    filepath: result.filepath,
    message,
    preview: result.preview,
  }
}

// ============================================================
// 类型导出（在接口定义处已导出）
// ============================================================
