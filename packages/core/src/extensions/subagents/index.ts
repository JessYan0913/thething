// ============================================================
// Subagents Module - 统一导出
// ============================================================

// Agent 定义和类型
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
} from './types';
export { AgentFrontmatterSchema } from './types';

// Agent 加载（直接从 api/loaders 导出，移除中间 loader 代理层）
export {
  loadAgents,
  loadAgentFile,
  loadAgentMarkdown,
  scanAgentDirs,
  clearAgentCache,
  clearAgentsCache,
  getAvailableAgents,
  type LoadAgentsOptions,
  type AgentLoaderConfig,
} from '../../api/loaders/agents';

// Agent 注册
export { globalAgentRegistry } from './registry';

// Agent 路由
export { resolveAgentRoute } from './router';

// Agent 执行
export { executeRoutedAgent } from './executor';
export { resolveToolsForAgent } from './tool-resolver';
export { resolveModelForAgent } from './model-resolver';
export { buildSubAgentPrompt, buildContextPrompt } from './context-builder';

// Agent Tool
export { createAgentTool, formatAgentResult } from './agent-tool';

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
} from './built-in';

// 递归防护
export { RecursionTracker, checkRecursionGuard, RECURSION_GUARD_CONFIG } from './recursion-guard';

// 事件广播
export { EventBroadcaster } from './event-broadcaster';
export type { AgentEventType, AgentEvent } from './event-broadcaster';

// 上下文（保留旧接口兼容）
export {
  buildSubAgentPrompt as buildSubAgentPromptFromOptions,
  createSubAgentContext,
  extractContextForSubAgent,
  finalizeSubAgentContext,
  getSubAgentDurationMs,
  wrapSubAgentResult,
} from './context';
export type { SubAgentContext, SubAgentResult, BuildSubAgentPromptOptions, ContextExtractionOptions } from './context';

// 模块版本
export const SUBAGENTS_MODULE_VERSION = '2.0.0';