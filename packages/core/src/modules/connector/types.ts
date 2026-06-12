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

  // 变量声明（可在后续配置中使用 ${{ var_name }} 引用）
  variables?: Record<string, string>

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
  input?: Record<string, unknown>
}

/**
 * 认证配置
 */
export interface AuthConfig {
  type: 'none' | 'api_key' | 'bearer' | 'custom' | 'database'
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
    refresh_before_expiry_ms?: number  // 提前刷新时间（毫秒）

    // Bearer Token 认证
    token?: string

    // Database 认证
    db_path?: string
    query?: string
    token_column?: string
  }
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string
  description: string
  executor: 'http' | 'mock' | 'sql' | 'script'
  executor_config: HttpExecutorConfig | MockExecutorConfig | SqlExecutorConfig | ScriptExecutorConfig
  input_schema?: Record<string, unknown>
  output_schema?: Record<string, unknown>
}

/**
 * HTTP 执行器配置
 */
export interface HttpExecutorConfig {
  url: string
  method: string
  headers?: Record<string, string>
  query_params?: Record<string, string>
  body_template?: string
  response_path?: string
  timeout_ms?: number
}

/**
 * Mock 执行器配置
 */
export interface MockExecutorConfig {
  response: unknown
  delay_ms?: number
}

/**
 * SQL 执行器配置
 */
export interface SqlExecutorConfig {
  db_path: string
  query: string
  params?: unknown[]
}

/**
 * Script 执行器配置
 */
export interface ScriptExecutorConfig {
  script: string
  timeout_ms?: number
}

/**
 * Connector 工具调用
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
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * Connector Frontmatter（从 loader 加载）
 */
export interface ConnectorFrontmatter {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  variables?: Record<string, string>
  inbound?: ConnectorDefinition['inbound']
  auth: AuthConfig
  custom_settings?: Record<string, unknown>
  base_url?: string
  tools: ToolDefinition[]
}

/**
 * Permission Rule
 */
export interface PermissionRule {
  id: string
  connector_id: string
  tool_name: string
  behavior: 'allow' | 'deny' | 'prompt'
  conditions?: Record<string, unknown>
}

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

  /** 显式允许不安全 script executor；默认 false */
  allowUnsafeScriptExecutor?: boolean

  /** 使用内存 Inbox（测试用） */
  useMemoryInbox?: boolean
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
