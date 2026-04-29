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
} from '../../runtime/budget/tool-output-manager'
import type { ContentReplacementState } from '../../runtime/budget/tool-output-manager'

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
      // 执行原工具
      const result = await originalExecute(input, execOptions)

      // 处理输出
      const toolUseId = `mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const processed = await processToolOutput(
        result,
        toolName,
        toolUseId,
        {
          sessionId: options.sessionId,
          projectDir: options.projectDir,
          state: options.contentReplacementState,
        }
      )

      return processed.content
    },
  }
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