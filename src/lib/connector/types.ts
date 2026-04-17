// ============================================================
// Connector Gateway 核心类型定义
// ============================================================

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
    webhook_path: string
    handler: string  // wecom | feishu | test-service | custom
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
 * 入站消息事件（Webhook 接收后转换的统一格式）
 */
export interface InboundMessageEvent {
  event_id: string           // 唯一 ID，用于幂等
  connector_type: string      // "wecom" | "feishu" | "test-service"
  channel_id: string          // 群聊 ID 或用户 ID
  sender: {
    id: string
    name?: string
    type: 'user' | 'bot'
  }
  message: {
    id: string
    type: 'text' | 'image' | 'file' | 'event'
    text?: string
    raw: unknown
  }
  timestamp: number
  reply_context: ReplyContext
}

/**
 * 回复上下文
 */
export interface ReplyContext {
  connector_type: string
  channel_id: string
  reply_to_message_id?: string
}

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
  connector_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}

/**
 * 工具调用响应
 */
export interface ToolCallResponse {
  success: boolean
  result?: unknown
  error?: string
  metadata?: {
    duration_ms: number
    connector_id: string
    tool_name: string
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
