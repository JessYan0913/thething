// ============================================================
// Connector 工具适配器 - 将 Connector 工具转换为 AI SDK 格式
// ============================================================

import { tool as aiTool } from 'ai'
import { z } from 'zod'
import type { ToolDefinition } from './types'
import { ConnectorRegistry } from './registry'

export interface ConnectorToolOptions {
  registry: ConnectorRegistry
  getCredentials: (connectorId: string) => Promise<Record<string, string>>
}

/**
 * 将单个 ToolDefinition 转换为 AI SDK 的 tool 格式
 */
export function convertConnectorToolToAItool(
  connectorId: string,
  toolDef: ToolDefinition,
  deps: ConnectorToolOptions
) {
  // 构建 Zod schema
  const properties: Record<string, z.ZodTypeAny> = {}
  const required: string[] = toolDef.input_schema.required || []

  for (const [key, prop] of Object.entries(toolDef.input_schema.properties)) {
    let zodType: z.ZodTypeAny

    switch (prop.type) {
      case 'string':
        zodType = z.string()
        break
      case 'integer':
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        if (prop.items?.type === 'string') {
          zodType = z.array(z.string())
        } else if (prop.items?.type === 'integer' || prop.items?.type === 'number') {
          zodType = z.array(z.number())
        } else {
          zodType = z.array(z.unknown())
        }
        break
      case 'object':
        zodType = z.record(z.string(), z.unknown())
        break
      default:
        zodType = z.unknown()
    }

    // 处理默认值
    if (prop.default !== undefined) {
      // Dynamic schema building from JSON Schema — runtime type is guaranteed by the schema definition
      zodType = zodType.default(prop.default as Parameters<typeof zodType.default>[0])
    }

    // 处理枚举
    if (prop.enum) {
      zodType = z.enum(prop.enum as [string, ...string[]])
    }

    properties[key] = zodType
  }

  const inputSchema = z.object(properties)

  // 创建 AI SDK tool
  return aiTool({
    description: `[Connector: ${connectorId}] ${toolDef.description}`,
    inputSchema: required.length > 0
      ? inputSchema.required(Object.fromEntries(required.map((k) => [k, true])) as Parameters<typeof inputSchema.required>[0])
      : inputSchema,
    execute: async (input, options) => {
      void options
      const result = await deps.registry.callTool({
        connector_id: connectorId,
        tool_name: toolDef.name,
        tool_input: input as Record<string, unknown>,
      })

      if (!result.success) {
        throw new Error(`Connector tool error: ${result.error}`)
      }

      return result.result
    },
  })
}

/**
 * 将所有已注册的 Connector 工具转换为 AI SDK 工具映射
 */
export async function getAllConnectorTools(
  deps: ConnectorToolOptions
): Promise<Record<string, ReturnType<typeof convertConnectorToolToAItool>>> {
  const tools: Record<string, ReturnType<typeof convertConnectorToolToAItool>> = {}
  const connectorIds = deps.registry.getConnectorIds()

  for (const connectorId of connectorIds) {
    const manifest = deps.registry.getManifest(connectorId)
    const config = deps.registry.getConfig(connectorId)

    if (!manifest || !config || !config.enabled) {
      continue
    }

    for (const toolDef of manifest.tools) {
      const toolName = `${connectorId}_${toolDef.name}`
      tools[toolName] = convertConnectorToolToAItool(connectorId, toolDef, deps)
    }
  }

  return tools
}
