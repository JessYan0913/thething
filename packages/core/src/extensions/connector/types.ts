// ============================================================
// Connector Gateway 核心类型定义
// ============================================================

// 前向声明类型（避免循环导入）
import type { ConnectorRegistry } from './registry'
import type { AuditLogger } from './audit-logger'
import type { ConnectorInboundRuntime, InboundEvent } from './inbound/types'

/**
 * Connector 定义（单一 YAML 配置文件）
 * 包含 Manifest 信息和运行时配置
 */
export interface ConnectorDefinition {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean

  // 入站配置（Webhook）
  inbound?: {
    enabled: boolean
    webhookPath?: string
    protocol: string
    transports?: Array<'http' | 'websocket' | 'test' | string>
    reply?: ConnectorReplyDefinition
    // 处理状态指示器：收到消息时显示"正在处理"状态
    processing_indicator?: {
      enabled: boolean
      add_tool: string  // 开始处理时调用的工具名
      remove_tool: string  // 处理完成后调用的工具名
      add_input?: Record<string, unknown>  // add 工具的额外参数
    }
  }

  // 认证配置
  auth: AuthConfig

  // 凭证（可选，支持环境变量替换 ${VAR_NAME}）
  credentials?: Record<string, string>

  // 自定义设置
  custom_settings?: Record<string, unknown>

  // 基础 URL（用于模板渲染）
  base_url?: string

  // 工具定义
  tools: ToolDefinition[]
}

/**
 * 入站回复映射。
 * Responder 使用该配置把 replyAddress + message 映射为标准 connector tool call。
 */
export interface ConnectorReplyDefinition {
  tool: string
  input: Record<string, unknown>
}

/**
 * 认证配置
 */
export interface AuthConfig {
  type: 'none' | 'api_key' | 'bearer' | 'custom'
  config: {
    // API Key 认证
    header?: string        // e.g., "X-API-Token"
    query_param?: string   // e.g., "api_key"

    // Custom Token 认证（微信/飞书专用）
    token_url?: string
    token_method?: 'GET' | 'POST'
    token_params?: Record<string, string>
    token_body?: Record<string, string>
    token_field?: string           // 返回 JSON 中 token 字段名
    expires_in_field?: string      // 返回 JSON 中过期时间字段名

    // Bearer 认证
    bearer_token?: string
  }
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, SchemaProperty>
    required?: string[]
    additionalProperties?: boolean
  }
  retryable?: boolean
  timeout_ms?: number
  executor: 'http' | 'sql' | 'script' | 'mock'
  executor_config: HttpExecutorConfig | SqlExecutorConfig | ScriptExecutorConfig | MockExecutorConfig
}

/**
 * JSON Schema 属性
 */
export interface SchemaProperty {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  items?: SchemaProperty
  properties?: Record<string, SchemaProperty>
}

/**
 * HTTP 执行器配置
 */
export interface HttpExecutorConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  url: string
  headers?: Record<string, string>
  query_params?: Record<string, string>
  body?: Record<string, unknown>
  body_type?: 'json' | 'form' | 'xml'
}

/**
 * SQL 执行器配置
 */
export interface SqlExecutorConfig {
  connection_id: string
  allow_write: boolean
  max_rows: number
  query_template: string
}

/**
 * 脚本执行器配置
 */
export interface ScriptExecutorConfig {
  script: string
  language: 'javascript' | 'typescript'
}

/**
 * Mock 执行器配置（用于测试）
 */
export interface MockExecutorConfig {
  response: unknown
  delay_ms?: number
  error?: string
}

/**
 * core 内部标准工具调用模型。
 */
export interface ConnectorToolCall {
  connectorId: string
  toolName: string
  input: Record<string, unknown>
}

/**
 * 工具调用响应
 */
export interface ToolCallResponse {
  success: boolean
  result?: unknown
  error?: string
  metadata?: {
    durationMs: number
    connectorId: string
    toolName: string
  }
}

/**
 * Executor 执行结果
 */
export interface ExecutorResult {
  success: boolean
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

// ============================================================
// ConnectorRuntime - 实例管理接口
// ============================================================

import type { LanguageModelV3 } from '@ai-sdk/provider'

/**
 * 模型配置（用于 Connector inbound handler）
 * 由应用层传入，不读取环境变量
 */
export interface ConnectorModelConfig {
  apiKey: string
  baseURL: string
  modelName: string
  includeUsage?: boolean
}

/**
 * ConnectorRuntime 配置
 *
 * 应用层创建 ConnectorRuntime 时需要提供的配置。
 * 所有路径和参数都显式传入，不依赖 process.env 或 cwd。
 */
export interface ConnectorRuntimeConfig {
  /** 项目根目录 */
  cwd: string

  /** Connector YAML 配置目录路径 */
  configDir: string

  /** 数据存储目录（用于 idempotency、audit 等） */
  dataDir: string

  /** 用户标识 */
  userId?: string

  /** AppContext（用于 inbound handler） */
  appContext?: unknown  // 使用 unknown 避免循环导入

  /** 模型配置（用于 inbound handler） */
  model?: ConnectorModelConfig

  /** 环境变量快照，由 server/cli 显式传入；core 不自行读取 process.env */
  env?: Record<string, string | undefined>

  /** 是否开启调试日志 */
  debugEnabled?: boolean

  /** 显式允许不安全 script executor；默认 false */
  allowUnsafeScriptExecutor?: boolean
}

/**
 * ConnectorRuntime 实例
 *
 * 包含所有 connector 运行时需要的组件实例。
 * 由应用层创建和管理，不再使用进程级单例。
 */
export interface ConnectorRuntime {
  /** Connector 注册表 */
  registry: ConnectorRegistry

  /** 审计日志器 */
  auditLogger: AuditLogger

  /** 入站运行时（标准事件、网关、收件箱、回复器） */
  inbound: ConnectorInboundRuntime

  /** 入站应用服务（消费标准事件） */
  inboundService: {
    handle(event: InboundEvent): Promise<void>
  }
}
