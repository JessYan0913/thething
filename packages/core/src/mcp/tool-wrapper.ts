// ============================================================
// MCP Tool Wrapper - MCP 工具输出处理包装
// ============================================================
// MCP 工具来自 @ai-sdk/mcp，不能直接修改 execute
// 通过包装方式拦截输出并进行持久化
// ============================================================

import type { Tool } from 'ai'
import {
  processToolOutput,
  getToolOutputConfig,
} from '../utils/tool-output-manager'
import type { ContentReplacementState } from '../utils/tool-output-manager'

/**
 * MCP 工具包装配置
 */
export interface McpToolWrapperOptions {
  sessionId: string
  projectDir: string
  contentReplacementState: ContentReplacementState
}

/**
 * 包装单个 MCP 工具，添加输出处理
 *
 * 注意：AI SDK 的 Tool 类型不暴露 execute 函数
 * 这个 wrapper 主要用于消息层的拦截处理
 * 实际输出处理在 agent/tools.ts 的加载后处理
 */
export function wrapMcpToolWithOutputHandler(
  tool: Tool,
  toolName: string,
  options: McpToolWrapperOptions
): Tool {
  const config = getToolOutputConfig(toolName)

  // 由于 AI SDK Tool 类型不暴露 execute 函数直接修改
  // 这里返回原始工具，输出处理在消息层进行
  // 实际处理逻辑见 agent/tools.ts 中的后处理

  return tool
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

  return processToolOutput(result, prefixedName, toolUseId, {
    sessionId: options.sessionId,
    projectDir: options.projectDir,
    state: options.contentReplacementState,
  })
}