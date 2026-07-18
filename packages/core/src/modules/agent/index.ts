// ============================================================
// Agent Module - 统一的 Agent 模块导出
// ============================================================

// 工具函数
export { loadAllTools } from './tools'
export { loadWikiContextForAgent, buildAgentInstructions } from './context'
export type { WikiContextResult } from './context'

// 加载
export {
  loadAgents,
  loadAgentFile,
  loadAgentMarkdown,
  scanAgentDirs,
  getAvailableAgents,
  serializeAgentMarkdown,
} from './loader'
export type { LoadAgentsOptions, AgentLoaderConfig } from './loader'

// 注册表
export { AgentRegistry } from './registry'

// 路由
export { resolveAgentRoute } from './router'

// 执行
export { executeRoutedAgent } from './executor'
export { resolveToolsForAgent } from './tool-resolver'
export { resolveModelForAgent } from './model-resolver'
export { buildSubAgentPrompt, buildContextPrompt } from './context-builder'
export { createAgentTool, formatAgentResult } from './agent-tool'
export { createParallelAgentTool } from './parallel-agent-tool'

// 内置 Agent
export {
  registerBuiltinAgents,
  getBuiltinAgent,
  isBuiltinAgent,
  BUILTIN_AGENTS,
  EXPLORE_AGENT,
  RESEARCH_AGENT,
  PLAN_AGENT,
  GENERAL_AGENT,
} from './built-in'

// 事件
export { EventBroadcaster } from './event-broadcaster'

// 类型
export type {
  AgentDefinition,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentToolInput,
  AgentToolConfig,
  AgentRouteDecision,
  AgentFrontmatter,
  AgentSource,
  PermissionMode,
  TokenUsageStats,
  AgentExecutionStatus,
  SubAgentStreamWriter,
  LanguageModel,
  ToolSet,
  UIMessage,
  StopCondition,
  AgentFrontmatterSchema,
  AgentRouteType,
} from './types'

export type {
  LoadToolsConfig,
  WikiContext,
  AgentContextConfig,
  AgentModules,
  ResolvedAgentConfig,
} from './types'
