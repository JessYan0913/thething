// ============================================================
// Types - 集中定义所有配置接口
// ============================================================
// 参考 Claude Code 的配置架构：类型集中定义，便于查找和维护

import type { UIMessage, Tool } from 'ai';
import type { SessionState } from '../session-state';
import type { McpRegistry } from '../mcp';
import type { SubAgentStreamWriter } from '../subagents';

// ============================================================
// 全局初始化配置
// ============================================================

/**
 * 全局初始化配置
 * 用于 initAll() 函数
 */
export interface InitConfig {
  /** 数据目录 */
  dataDir: string;
  /** 数据库配置 */
  databaseConfig?: SQLiteDataStoreConfig;
  /** Connector 配置 */
  connectorConfig?: ConnectorGatewayConfig;
}

// ============================================================
// 模型配置
// ============================================================

/**
 * 模型提供商配置
 */
export interface ModelProviderConfig {
  /** API Key */
  apiKey: string;
  /** Base URL */
  baseURL: string;
  /** 模型名称 */
  modelName: string;
  /** 是否返回用量信息 */
  includeUsage?: boolean;
  /** 是否启用思考模式 */
  enableThinking?: boolean;
}

/**
 * 模型能力元数据
 */
export interface ModelCapabilities {
  /** 上下文窗口限制（tokens） */
  contextLimit: number;
  /** 默认输出预留（tokens） */
  defaultOutputTokens: number;
}

// ============================================================
// Agent 配置
// ============================================================

/**
 * Agent 上下文配置
 */
export interface AgentContextConfig {
  /** 用户 ID */
  userId?: string;
  /** 团队 ID */
  teamId?: string;
  /** 对话元信息 */
  conversationMeta?: {
    messageCount: number;
    isNewConversation: boolean;
    conversationStartTime: number;
  };
}

/**
 * 加载工具配置
 */
export interface LoadToolsConfig {
  /** 对话 ID */
  conversationId: string;
  /** Session 状态 */
  sessionState: SessionState;
  /** 是否启用 MCP */
  enableMcp?: boolean;
  /** 是否启用 Connector */
  enableConnector?: boolean;
  /** 流式写入器引用 */
  writerRef?: { current: SubAgentStreamWriter | null };
  /** 模型 */
  model: unknown; // LanguageModelV3
}

/**
 * 创建 Agent 配置
 */
export interface CreateAgentConfig {
  /** 对话 ID（必填） */
  conversationId: string;
  /** 当前消息列表 */
  messages?: UIMessage[];
  /** 用户 ID */
  userId?: string;
  /** 团队 ID */
  teamId?: string;
  /** 模型配置（必填） */
  modelConfig: ModelProviderConfig;
  /** Session 选项 */
  sessionOptions?: SessionStateOptions;
  /** 对话元信息 */
  conversationMeta?: {
    messageCount: number;
    isNewConversation: boolean;
    conversationStartTime: number;
  };
  /** 是否启用 MCP */
  enableMcp?: boolean;
  /** 是否启用 Skills */
  enableSkills?: boolean;
  /** 是否启用记忆 */
  enableMemory?: boolean;
  /** 是否启用 Connector */
  enableConnector?: boolean;
  /** 流式写入器引用 */
  writerRef?: { current: SubAgentStreamWriter | null };
}

/**
 * 创建 Agent 结果
 */
export interface CreateAgentResult {
  agent: unknown; // ToolLoopAgent
  sessionState: SessionState;
  mcpRegistry?: McpRegistry;
  tools: Record<string, Tool>;
  instructions: string;
  /** 预算检查后调整的消息 */
  adjustedMessages?: UIMessage[];
  /** 预算检查执行的降级动作列表 */
  budgetActions?: string[];
}

// ============================================================
// Session 状态配置
// ============================================================

/**
 * Session 状态选项
 */
export interface SessionStateOptions {
  /** 最大上下文 Token */
  maxContextTokens?: number;
  /** 压缩阈值 */
  compactThreshold?: number;
  /** 最大预算（美元） */
  maxBudgetUsd?: number;
  /** 模型名称 */
  model?: string;
  /** 每工具最大拒绝次数 */
  maxDenialsPerTool?: number;
  /** 项目目录 */
  projectDir?: string;
  /** 工具输出配置覆盖 */
  toolOutputOverrides?: ToolOutputOverrides;
}

// ============================================================
// 压缩配置
// ============================================================

/**
 * Session Memory Compact 配置
 */
export interface SessionMemoryCompactConfig {
  /** 最小 Token 数 */
  minTokens: number;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 最小文本块消息数 */
  minTextBlockMessages: number;
}

/**
 * Micro Compact 配置
 */
export interface MicroCompactConfig {
  /** 时间窗口（毫秒） */
  timeWindowMs: number;
  /** 图片最大 Token 大小 */
  imageMaxTokenSize: number;
  /** 可压缩工具集合 */
  compactableTools: Set<string>;
  /** 间隔阈值（分钟） */
  gapThresholdMinutes: number;
  /** 保留最近消息数 */
  keepRecent: number;
}

/**
 * Post Compact 配置
 */
export interface PostCompactConfig {
  /** 总预算 */
  totalBudget: number;
  /** 最大恢复文件数 */
  maxFilesToRestore: number;
  /** 每文件最大 Token */
  maxTokensPerFile: number;
  /** 每技能最大 Token */
  maxTokensPerSkill: number;
  /** 技能 Token 预算 */
  skillsTokenBudget: number;
}

// ============================================================
// 数据存储配置
// ============================================================

/**
 * SQLite 数据存储配置
 */
export interface SQLiteDataStoreConfig {
  /** 数据目录 */
  dataDir?: string;
}

// ============================================================
// Connector 配置
// ============================================================

/**
 * Connector Gateway 配置
 */
export interface ConnectorGatewayConfig {
  /** 是否启用入站 */
  enableInbound?: boolean;
  /** 配置目录 */
  configDir?: string;
}

/**
 * Connector 定义（YAML 配置）
 */
export interface ConnectorDefinition {
  /** Connector ID */
  id: string;
  /** 名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 入站配置 */
  inbound?: {
    enabled: boolean;
    webhook_path: string;
    handler: string;
  };
  /** 认证配置 */
  auth: AuthConfig;
  /** 凭证 */
  credentials?: Record<string, string>;
  /** 自定义设置 */
  custom_settings?: Record<string, unknown>;
  /** 基础 URL */
  base_url?: string;
  /** 工具定义 */
  tools: ToolDefinition[];
}

/**
 * 认证配置
 */
export interface AuthConfig {
  type: 'none' | 'api_key' | 'bearer' | 'custom';
  config: {
    header?: string;
    query_param?: string;
    token_url?: string;
    token_method?: 'GET' | 'POST';
    token_params?: Record<string, string>;
    token_body?: Record<string, string>;
    token_field?: string;
    expires_in_field?: string;
    bearer_token?: string;
  };
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, SchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };
  retryable?: boolean;
  timeout_ms?: number;
  executor: 'http' | 'sql' | 'script' | 'mock';
  executor_config: HttpExecutorConfig | SqlExecutorConfig | ScriptExecutorConfig | MockExecutorConfig;
}

/**
 * JSON Schema 属性
 */
export interface SchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

/**
 * HTTP 执行器配置
 */
export interface HttpExecutorConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  query_params?: Record<string, string>;
  body?: Record<string, unknown>;
  body_type?: 'json' | 'form' | 'xml';
}

/**
 * SQL 执行器配置
 */
export interface SqlExecutorConfig {
  connection_id: string;
  allow_write: boolean;
  max_rows: number;
  query_template: string;
}

/**
 * 脚本执行器配置
 */
export interface ScriptExecutorConfig {
  script: string;
  language: 'javascript' | 'typescript';
}

/**
 * Mock 执行器配置
 */
export interface MockExecutorConfig {
  response: unknown;
  delay_ms?: number;
  error?: string;
}

/**
 * 数据库连接配置
 */
export interface DatabaseConnectionConfig {
  id: string;
  type: 'sqlite' | 'postgres' | 'mysql';
  path?: string;  // SQLite
  host?: string;  // PostgreSQL/MySQL
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

// ============================================================
// MCP 配置
// ============================================================

/**
 * MCP Server 配置
 */
export interface McpServerConfig {
  /** 命令 */
  command: string;
  /** 参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 传输类型 */
  transport?: 'stdio' | 'sse' | 'http';
  /** URL（用于 SSE/HTTP） */
  url?: string;
}

// ============================================================
// Skills 配置
// ============================================================

/**
 * Skill 加载器配置
 */
export interface SkillLoaderConfig {
  /** 扫描目录 */
  scanDirs: string[];
  /** 最大 Skills 数量 */
  maxSkills: number;
  /** 是否启用使用追踪 */
  enableUsageTracking: boolean;
}

// ============================================================
// Agent Control 配置
// ============================================================

/**
 * Denial Tracker 配置
 */
export interface DenialTrackerConfig {
  /** 每工具最大拒绝次数 */
  maxDenialsPerTool?: number;
}

/**
 * 模型切换配置
 */
export interface ModelSwitchConfig {
  /** 可用模型列表 */
  availableModels: ModelProvider[];
  /** 当前模型 */
  currentModel: string;
  /** 成本阈值（百分比） */
  autoDowngradeCostThreshold?: number;
  /** 切换时是否通知 */
  notifyOnSwitch?: boolean;
}

/**
 * 模型提供商
 */
export interface ModelProvider {
  /** 模型 ID */
  id: string;
  /** 模型名称 */
  name: string;
  /** 成本倍数 */
  costMultiplier: number;
  /** 能力等级 */
  capabilityTier: number;
}

/**
 * Agent Pipeline 配置
 */
export interface AgentPipelineConfig {
  /** Session 状态 */
  sessionState: SessionState;
  /** 工具 */
  tools?: Record<string, Tool>;
  /** 模型 */
  model?: unknown;
}

// ============================================================
// 权限配置
// ============================================================

/**
 * 权限配置
 */
export interface PermissionConfig {
  /** 规则列表 */
  rules: PermissionRule[];
}

/**
 * 权限规则
 */
export interface PermissionRule {
  /** 规则 ID */
  id: string;
  /** 匹配模式 */
  pattern: string;
  /** 允许/拒绝 */
  allow: boolean;
  /** 描述 */
  description?: string;
}

// ============================================================
// 工具输出配置
// ============================================================

/**
 * 工具输出配置
 */
export interface ToolOutputConfig {
  /** 最大结果字符数 */
  maxResultSizeChars: number;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 截断消息 */
  truncationMessage: string;
}

/**
 * 工具输出覆盖配置
 */
export interface ToolOutputOverrides {
  /** 按工具名覆盖 */
  byToolName?: Record<string, Partial<ToolOutputConfig>>;
  /** 按工具前缀覆盖 */
  byPrefix?: Record<string, Partial<ToolOutputConfig>>;
  /** 全局覆盖 */
  global?: Partial<ToolOutputConfig>;
}

// ============================================================
// 子 Agent 配置
// ============================================================

/**
 * Agent 工具配置
 */
export interface AgentToolConfig {
  /** Agent 类型 */
  agentType: string;
  /** 描述 */
  description: string;
  /** 允许的工具 */
  allowedTools?: string[];
  /** 模型覆盖 */
  modelOverride?: string;
}

/**
 * 任务调度器配置
 */
export interface TaskSchedulerConfig {
  /** 最大并发任务 */
  maxConcurrentTasks?: number;
  /** 任务超时（毫秒） */
  taskTimeoutMs?: number;
}

/**
 * 任务同步配置
 */
export interface TaskSyncConfig {
  /** 同步间隔（毫秒） */
  syncIntervalMs?: number;
}

// ============================================================
// 记忆配置
// ============================================================

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 记忆目录 */
  memoryDir: string;
  /** 最大记忆数 */
  maxMemories?: number;
}

// ============================================================
// Webhook 配置
// ============================================================

/**
 * Webhook 配置（加载后）
 */
export interface WebhookConfigLoaded {
  /** Connector ID */
  connectorId: string;
  /** Handler */
  handler: string;
  /** 是否启用 */
  enabled: boolean;
  /** 凭证 */
  credentials: Record<string, string>;
}

/**
 * 微信 Webhook 配置
 */
export interface WechatWebhookConfig {
  token: string;
  encodingAesKey: string;
  appId: string;
  subtype: 'wecom' | 'wechat-mp' | 'wechat-kf';
}

/**
 * 飞书 Webhook 配置
 */
export interface FeishuWebhookConfig {
  encryptKey: string;
  verificationToken: string;
}