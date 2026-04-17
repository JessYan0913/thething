// ============================================================
// Connector 工具适配器 - 将 Connector 工具转换为 AI SDK 格式
// ============================================================

import { tool as aiTool } from 'ai'
import { z } from 'zod'
import type { ToolDefinition, SchemaProperty } from './types'
import { ConnectorRegistry } from './registry'

export interface ConnectorToolOptions {
  registry: ConnectorRegistry
  getCredentials?: (connectorId: string) => Promise<Record<string, string>>
}

/**
 * 将 JSON Schema 属性转换为 Zod 类型
 * 公共函数，供多处复用
 */
export function buildZodSchemaFromToolDefinition(toolDef: ToolDefinition): z.ZodObject<any, any> {
  const properties: Record<string, z.ZodTypeAny> = {}
  const required: string[] = toolDef.input_schema.required || []

  for (const [key, prop] of Object.entries(toolDef.input_schema.properties)) {
    properties[key] = schemaPropertyToZod(prop)
  }

  const inputSchema = z.object(properties)

  // 处理 required 字段
  if (required.length > 0) {
    return inputSchema.required(
      Object.fromEntries(required.map((k) => [k, true])) as Parameters<typeof inputSchema.required>[0]
    )
  }

  return inputSchema
}

/**
 * 单个 SchemaProperty 转换为 Zod 类型
 */
export function schemaPropertyToZod(prop: SchemaProperty): z.ZodTypeAny {
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
    zodType = zodType.default(prop.default as Parameters<typeof zodType.default>[0])
  }

  // 处理枚举
  if (prop.enum && prop.enum.length > 0) {
    zodType = z.enum(prop.enum as [string, ...string[]])
  }

  return zodType
}

/**
 * 将单个 ToolDefinition 转换为 AI SDK 的 tool 格式
 */
export function convertConnectorToolToAItool(
  connectorId: string,
  toolDef: ToolDefinition,
  registry: ConnectorRegistry
) {
  const inputSchema = buildZodSchemaFromToolDefinition(toolDef)

  return aiTool({
    description: `[Connector: ${connectorId}] ${toolDef.description}`,
    inputSchema,
    execute: async (input) => {
      const result = await registry.callTool({
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
  registry: ConnectorRegistry
): Promise<Record<string, ReturnType<typeof convertConnectorToolToAItool>>> {
  const tools: Record<string, ReturnType<typeof convertConnectorToolToAItool>> = {}
  const connectorIds = registry.getConnectorIds()

  for (const connectorId of connectorIds) {
    const connector = registry.getDefinition(connectorId)

    if (!connector || !connector.enabled) {
      continue
    }

    for (const toolDef of connector.tools) {
      const toolName = `${connectorId}_${toolDef.name}`
      tools[toolName] = convertConnectorToolToAItool(connectorId, toolDef, registry)
    }
  }

  return tools
}