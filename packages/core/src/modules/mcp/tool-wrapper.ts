// ============================================================
// MCP Tool Wrapper - MCP 工具输出处理包装
// ============================================================
// MCP 工具来自 @ai-sdk/mcp，不能直接修改 execute
// 通过包装方式拦截输出并进行持久化
// ============================================================

import type { Tool } from 'ai'
import {
  unifiedToolOutputHook,
} from '../../modules/compaction/unified-output'
import type { ContentReplacementState, ToolOutputConfig } from '../../modules/budget/tool-output-manager'
import type { McpRegistry } from './registry'

/**
 * MCP 工具包装配置
 */
export interface McpToolWrapperOptions {
  sessionId: string
  dataDir: string
  contentReplacementState: ContentReplacementState
  /** per-session 工具输出配置（来自 SessionState.toolOutputConfig） */
  toolOutputConfig?: ToolOutputConfig
}

/**
 * 包装单个 MCP 工具，添加输出处理
 *
 * ✅ 改进：实际包装工具，拦截 execute 函数进行输出处理
 */
export function wrapMcpToolWithOutputHandler(
  tool: Tool,
  toolName: string,
  options: McpToolWrapperOptions
): Tool {
  // 获取原工具的 execute 函数
  const originalExecute = tool.execute

  if (!originalExecute) {
    // 如果没有 execute，直接返回原工具（可能是定义不完整）
    return tool
  }

  // 创建包装后的工具
  return {
    ...tool,
    execute: async (input: unknown, execOptions?: any) => {
      const result = await originalExecute(input, execOptions)
      return processResultContent(result, toolName, options)
    },
  }
}

/**
 * 创建 registry 绑定的 MCP 工具：每次调用经 registry 取活连接，
 * 带请求超时 + 半死连接一次强制重连重试（治 -32001）。
 *
 * 对比 wrapMcpToolWithOutputHandler：后者调用创建时闭包里绑死的 client，
 * 连接失效（子进程被杀/半死）时会挂 60s 报 -32001，无自愈；本构造器把
 * 每次调用路由到 registry.callToolSafe，连接失效自动重连重试。
 *
 * 结构化输出工具（toolDef.outputSchema 存在）保留原 execute——SDK 的
 * extractStructuredContent 需要 client 实例，无法用 callToolSafe 等价替代。
 */
export function createRegistryBoundMcpTool(
  toolDef: Tool,
  serverName: string,
  toolName: string,
  registry: McpRegistry,
  options: McpToolWrapperOptions & { qualifiedName: string },
): Tool {
  const originalExecute = toolDef.execute
  if (!originalExecute || (toolDef as { outputSchema?: unknown }).outputSchema) {
    return toolDef
  }

  return {
    ...toolDef,
    execute: async (input: unknown, _execOptions?: any) => {
      // callToolSafe：15s（或 per-server requestTimeout）超时 + 一次强制重连重试
      const result = await registry.callToolSafe(
        serverName,
        toolName,
        input as Record<string, unknown>,
      )
      return processResultContent(result, options.qualifiedName, options)
    },
  }
}

/**
 * 处理 MCP 工具结果（与 wrapMcpToolWithOutputHandler 共用同一管线）
 *
 * MCP 工具返回 { content: [{type:"text", text:"..."}], isError: false }
 * 必须保留此结构，否则 @ai-sdk/mcp 的 mcpToModelOutput 会报错
 */
async function processResultContent(
  result: unknown,
  toolName: string,
  options: McpToolWrapperOptions,
): Promise<unknown> {
  const textContent = extractMcpText(result)
  if (textContent === null) {
    return result
  }

  const toolUseId = `mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const processed = await unifiedToolOutputHook(
    textContent,
    toolName,
    toolUseId,
    {
      sessionId: options.sessionId,
      dataDir: options.dataDir,
      config: options.toolOutputConfig,
    }
  )

  // 只替换 text part，保留 structuredContent、image/resource 等非文本内容和扩展字段
  const obj = result as Record<string, unknown>
  let replaced = false
  const newContent = (obj.content as unknown[]).flatMap((part) => {
    const p = part as Record<string, unknown>
    if (p?.type === 'text') {
      // 多个 text part 已被 extractMcpText 合并，处理结果放入第一个位置
      if (replaced) return []
      replaced = true
      return [{ ...p, text: processed.content }]
    }
    return [part]
  })

  return { ...obj, content: newContent }
}

/**
 * 批量包装 MCP 工具
 */
export function wrapMcpToolsWithOutputHandler(
  tools: Record<string, Tool>,
  options: McpToolWrapperOptions
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {}

  for (const [toolName, tool] of Object.entries(tools)) {
    const prefixedName = `mcp_${toolName}`
    wrapped[prefixedName] = wrapMcpToolWithOutputHandler(tool, prefixedName, options)
  }

  return wrapped
}

/**
 * 处理 MCP 工具结果（用于消息层）
 * 在 tool_result 进入消息历史前调用
 */
export async function processMcpToolResult(
  result: unknown,
  toolName: string,
  toolUseId: string,
  options: McpToolWrapperOptions
): Promise<{
  content: string
  persisted: boolean
  filepath?: string
}> {
  const prefixedName = toolName.startsWith('mcp_') ? toolName : `mcp_${toolName}`

  return unifiedToolOutputHook(result, prefixedName, toolUseId, {
    sessionId: options.sessionId,
    dataDir: options.dataDir,
    config: options.toolOutputConfig,
  })
}

/**
 * 从 MCP 工具结果中提取文本内容
 * MCP 结果格式: { content: [{type:"text", text:"..."}], isError: false }
 */
function extractMcpText(result: unknown): string | null {
  if (result === null || result === undefined || typeof result !== 'object') {
    return null
  }
  const obj = result as Record<string, unknown>
  if (!Array.isArray(obj.content)) {
    return null
  }
  const texts = obj.content
    .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
    .map((p: any) => p.text)
  return texts.length > 0 ? texts.join('\n') : null
}
