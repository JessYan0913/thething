// ============================================================
// Connector 工具适配器 - 将 Connector 工具转换为 AI SDK 格式
// ============================================================

import { tool as aiTool } from 'ai'
import { z } from 'zod'
import type { ToolDefinition, SchemaProperty } from './types'
import { ConnectorRegistry } from './registry'
import {
  processToolOutput,
} from '../../runtime/budget/tool-output-manager'
import type { ContentReplacementState } from '../../runtime/budget/tool-output-manager'

export interface ConnectorToolOptions {
  registry: ConnectorRegistry
  getCredentials?: (connectorId: string) => Promise<Record<string, string>>
  /** 会话信息，用于输出持久化 */
  sessionContext?: {
    sessionId: string
    projectDir: string
    contentReplacementState: ContentReplacementState
  }
}

/**
 * 将 JSON Schema 属性转换为 Zod 类型
 * 公共函数，供多处复用
 */
export function buildZodSchemaFromToolDefinition(toolDef: ToolDefinition): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const properties: Record<string, z.ZodTypeAny> = {}
  const required: string[] = toolDef.input_schema.required || []

  for (const [key, prop] of Object.entries(toolDef.input_schema.properties)) {
    const zodType = schemaPropertyToZod(prop)
    // 如果字段是 required，不使用 optional
    // 如果字段不是 required，使用 optional
    if (!required.includes(key)) {
      properties[key] = zodType.optional()
    } else {
      properties[key] = zodType
    }
  }

  return z.object(properties)
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
    // 根据类型设置默认值
    if (prop.type === 'string' && typeof prop.default === 'string') {
      zodType = zodType.default(prop.default)
    } else if ((prop.type === 'number' || prop.type === 'integer') && typeof prop.default === 'number') {
      zodType = zodType.default(prop.default)
    } else if (prop.type === 'boolean' && typeof prop.default === 'boolean') {
      zodType = zodType.default(prop.default)
    } else {
      zodType = zodType.default(prop.default)
    }
  }

  // 处理枚举
  if (prop.enum && prop.enum.length > 0) {
    const enumValues = prop.enum as [string, ...string[]]
    zodType = z.enum(enumValues)
  }

  return zodType
}

/**
 * 将单个 ToolDefinition 转换为 AI SDK 的 tool 格式
 */
export function convertConnectorToolToAItool(
  connectorId: string,
  toolDef: ToolDefinition,
  options: ConnectorToolOptions
) {
  const inputSchema = buildZodSchemaFromToolDefinition(toolDef)
  const toolName = `${connectorId}_${toolDef.name}`

  return aiTool({
    description: `[Connector: ${connectorId}] ${toolDef.description}`,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await options.registry.callTool({
        connectorId,
        toolName: toolDef.name,
        input,
      })

      if (!result.success) {
        throw new Error(`Connector tool error: ${result.error}`)
      }

      // ✅ 改进：始终处理输出，移除 shouldPersistToDisk 条件检查
      if (options.sessionContext) {
        // 生成 toolUseId（AI SDK 内部会生成，这里用于预览）
        const toolUseId = `connector_${connectorId}_${toolDef.name}_${Date.now()}`

        const processed = await processToolOutput(
          result.result,
          toolName,
          toolUseId,
          {
            sessionId: options.sessionContext.sessionId,
            projectDir: options.sessionContext.projectDir,
            state: options.sessionContext.contentReplacementState,
          }
        )

        return processed.content
      }

      return result.result
    },
  })
}

/**
 * 将所有已注册的 Connector 工具转换为 AI SDK 工具映射
 */
export async function getAllConnectorTools(
  registry: ConnectorRegistry,
  sessionContext?: ConnectorToolOptions['sessionContext']
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
      tools[toolName] = convertConnectorToolToAItool(connectorId, toolDef, {
        registry,
        sessionContext,
      })
    }
  }

  return tools
}
