// ============================================================
// MCP Tool Wrapper - MCP 工具输出处理包装
// ============================================================
// MCP 工具来自 @ai-sdk/mcp，不能直接修改 execute
// 通过包装方式拦截输出并进行持久化
// ============================================================

import type { Tool } from 'ai'
import { readMCPAppResource, type MCPClient } from '@ai-sdk/mcp'
import {
  processToolOutput,
} from '../../modules/budget/tool-output-manager'
import type { ContentReplacementState, ToolOutputConfig } from '../../modules/budget/tool-output-manager'
import { logger } from '../../primitives/logger'

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
 * MCP App 工具包装配置（扩展自 McpToolWrapperOptions）
 */
export interface McpAppToolWrapperOptions extends McpToolWrapperOptions {
  /** MCP App 资源 URI（ui:// scheme） */
  resourceUri: string
  /** MCP 客户端实例（用于预加载资源） */
  client: MCPClient
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

      // MCP 工具返回 { content: [{type:"text", text:"..."}], isError: false }
      // 必须保留此结构，否则 @ai-sdk/mcp 的 mcpToModelOutput 会报错
      const textContent = extractMcpText(result)
      if (textContent === null) {
        return result
      }

      const toolUseId = `mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const processed = await processToolOutput(
        textContent,
        toolName,
        toolUseId,
        {
          sessionId: options.sessionId,
          dataDir: options.dataDir,
          state: options.contentReplacementState,
          config: options.toolOutputConfig,
        }
      )

      return {
        content: [{ type: 'text', text: processed.content }],
        isError: (result as any)?.isError ?? false,
      }
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
 * 包装 MCP App 工具，添加输出处理和资源预加载
 *
 * MCP App 工具需要在调用后预加载 UI 资源，避免 MCP 客户端关闭后无法加载。
 * 这是解决 MCP App 资源加载时序问题的关键函数。
 */
export function wrapMcpAppTool(
  tool: Tool,
  toolName: string,
  options: McpAppToolWrapperOptions
): Tool {
  const originalExecute = tool.execute

  if (!originalExecute) {
    return tool
  }

  // 创建包装后的工具
  return {
    ...tool,
    execute: async (input: unknown, execOptions?: any) => {
      // 1. 调用原始工具
      const result = await originalExecute(input, execOptions)

      // 2. 预加载 MCP App 资源（后台执行，不阻塞返回）
      //    这确保在 MCP 客户端关闭前，资源已经被缓存
      readMCPAppResource({
        client: options.client,
        uri: options.resourceUri,
      }).then(() => {
        logger.debug('MCP App', `Pre-loaded resource: ${options.resourceUri}`)
      }).catch((err) => {
        logger.warn('MCP App', `Pre-load resource failed for ${options.resourceUri}: ${err.message}`)
      })

      // 3. 处理输出（与普通 MCP 工具相同）
      const textContent = extractMcpText(result)
      if (textContent === null) {
        return result
      }

      const toolUseId = `mcp-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const processed = await processToolOutput(
        textContent,
        toolName,
        toolUseId,
        {
          sessionId: options.sessionId,
          dataDir: options.dataDir,
          state: options.contentReplacementState,
          config: options.toolOutputConfig,
        }
      )

      return {
        content: [{ type: 'text', text: processed.content }],
        isError: (result as any)?.isError ?? false,
      }
    },
  }
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
    dataDir: options.dataDir,
    state: options.contentReplacementState,
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
