// ============================================================
// @the-thing/core — 使用指南
// ============================================================
//
// 本包提供三层 API：
//
// 1. 高层 API（推荐）— 直接 import
//    - bootstrap()      显式初始化基础设施，返回 CoreRuntime
//    - createContext()  加载所有配置（skills、mcp、connector 等）
//    - createAgent()    创建 Agent，消费 AppContext
//
//    示例（新 API）：
//    ```typescript
//    import { bootstrap, createContext, createAgent } from '@the-thing/core';
//
//    // 三步，每步的输入输出关系一目了然
//    const runtime = await bootstrap({
//      layout: { resourceRoot: process.cwd() }
//    });
//    const context = await createContext({ runtime });
//    const { agent, adjustedMessages } = await createAgent({
//      context,
//      conversationId: 'conv-1',
//      messages,
//      model: {
//        apiKey: process.env.API_KEY!,
//        baseURL: process.env.BASE_URL!,
//        modelName: 'qwen-max',
//      },
//    });
//    ```
//
// 2. 中层 API — import from '@the-thing/core/api'
//    - loadAll()        并行加载所有模块
//    - loadSkills()     单独加载 Skills
//    - loadMcpServers() 单独加载 MCP 服务器
//    - loadConnectors() 单独加载 Connector
//
//    示例：
//    ```typescript
//    import { loadSkills } from '@the-thing/core/api';
//    const skills = await loadSkills({ cwd: '/path/to/project' });
//    ```
//
// 3. 底层 API — import from '@the-thing/core/foundation'
//    - parser/          文件解析（Frontmatter、YAML、JSON）
//    - scanner/         目录扫描
//    - paths/           路径计算（纯函数 + 便捷版本）
//    - datastore/       数据存储
//    - model/           模型提供者和能力配置
//
//    示例：
//    ```typescript
//    import { parseFrontmatterFile } from '@the-thing/core/foundation/parser';
//    const result = parseFrontmatterFile('/path/to/file.md');
//    ```
//
// ============================================================

// ============================================================
// 高层 API（推荐入口）
// ============================================================
export { bootstrap, resolveProjectLayout, type CoreRuntime, type BootstrapOptions, type TokenizerConfig } from './composition/bootstrap';
export { createAgent, createContext, resolveAgentConfig } from './composition/app';
export { finalizeAgentRun, type FinalizeAgentRunOptions } from './composition/finalize';
export type {
  AppContext,
  CreateAgentOptions,
  CreateAgentResult,
  CreateContextOptions,
  ModelConfig,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './composition/app/types';
export type {
  ResolvedAgentConfig,
  AgentModules,
} from './modules/agent/types';
export { type ConnectorRegistry } from './modules/connector';
export { agentStreamOnError, REDACTED_ERROR_MESSAGE } from './modules/agent/stream-error';
export { sanitizeToolErrorInputs } from './modules/agent/sanitize-messages';

// ============================================================
// 新的配置系统（推荐使用）
// ============================================================
export {
  buildBehaviorConfig,
  type BehaviorConfig,
  type ModelSpec,
} from './services/config/behavior';

export {
  resolveLayout,
  type LayoutConfig,
  type ResolvedLayout,
  type ResourceDirs,
} from './services/config/layout';

export {
  loadGlobalConfig,
  saveGlobalConfig,
  getGlobalConfigPath,
  normalizeGlobalConfig,
  type GlobalConfig,
  type ModelEntry,
  type ProviderEntry,
  type ProviderModel,
} from './services/config/global-config';

// ============================================================
// Foundation Layer（白名单导出）
// ============================================================
// DataStore
export {
  createDefaultDataStore,
  createInMemoryDataStore,
  createSQLiteDataStore,
} from './services/datastore';
export type {
  DataStore,
  ConversationStore,
  MessageStore,
  SummaryStore,
  CostStore,
  TodoStore,
  Conversation,
  StoredMessage,
  StoredSummary,
  CostRecord,
  SQLiteDataStoreConfig,
  Project,
  ProjectStore,
  BranchStore,
  ConversationRunStore,
  ConversationBranch,
  ConversationBranchSummary,
  ConversationRun,
  ConversationCommand,
  ConversationCommandResult,
  ConversationProjection,
} from './primitives/datastore/types';

// Model
export {
  createModelProvider,
  createLanguageModel,
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  // Pricing（定价配置）
  createPricingResolver,
  // 模型别名(两档语义:fast=后台模型,smart/default=跟随主模型)
  resolveModelAlias,
  isInheritAlias,
  buildModelAliases,
} from './services/model';
export type {
  ModelCapabilities,
  ModelProviderConfig,
  ModelPricing,
  ModelAliases,
  PricingRegistry,
  PricingResolver,
} from './services/model';

// Clock（时间抽象）
export {
  systemClock,
} from './primitives/clock';
export type { Clock } from './primitives/clock';

// Paths
export { resolveProjectDir, resolveHomeDir } from './primitives/paths';

// Parser
export { parseFrontmatterFile, parseYamlFile, parseJsonFile, updateVariablesInYaml } from './primitives/parser';

// ============================================================
// Runtime Layer（白名单导出）
// ============================================================
// Session State
export { createSessionState } from './modules/session';
export type { SessionState, SessionStateOptions } from './modules/session';

// Goal Module
export {
  setGoal,
  clearGoal,
  pauseGoal,
  resumeGoal,
  completeGoal,
  incrementTurns,
  updateTokens,
  recordBlocked,
  continueFromMaxTurns,
  checkMaxTurns,
  shouldContinue,
  formatGoalStatusLabel,
  formatGoalElapsed,
  getActiveElapsedMs,
  truncateForDisplay,
  persistGoal,
  loadGoal,
  clearGoalStorage,
  buildContinuationPrompt,
  buildBudgetLimitPrompt,
  buildObjectiveUpdatedPrompt,
  buildGoalContextBlock,
  buildMaxTurnsPrompt,
  MAX_GOAL_TURNS,
  BLOCKED_CONSECUTIVE_THRESHOLD,
  MAX_OBJECTIVE_CHARS,
  MAX_DISPLAY_CHARS,
} from './modules/goal';
export type {
  GoalState,
  GoalStatus,
  GoalCreateInput,
  GoalUpdateInput,
  GoalToolInput,
  GoalToolOutput,
} from './modules/goal';

// Compaction
export {
  compactBeforeStep,
  manageToolOutputLifecycle,
  estimateMessagesTokens,
  handleReactiveRetry,
  isContextLengthError,
  applyCheckpointOnLoad,
  CHECKPOINT_SUMMARY_ID_PREFIX,
  fingerprintMessage,
} from './modules/compaction';

// Todos
export {
  createTodoStore,
} from './modules/todos';
export {
  STATUS_CONFIG,
} from './modules/todos/types';
export type {
  Todo,
  TodoStatus,
  TodoCreateInput,
  TodoUpdateInput,
  TodoClaimResult,
} from './modules/todos/types';

// ============================================================
// Extensions Layer（白名单导出）
// ============================================================
// Loaders
export {
  loadAll,
  loadSkills,
  loadAgents,
  loadMcpServers,
  loadConnectors,
  loadPermissions,
} from './composition/loaders';
export type {
  LoadAllOptions,
  LoadAllResult,
} from './composition/loaders';

// Skill types
export type { Skill } from './modules/skills/types';

// Agent types
export type { AgentDefinition } from './modules/agent/types';
export { serializeAgentMarkdown } from './modules/agent/loader';

// MCP types
export type { McpServerConfig, McpServerConfigSource, McpOAuthConfig } from './modules/mcp/types';
export {
  createMcpRegistry,
  createMcpOAuthProvider,
  parseOAuthState,
  getMcpServerConfigs,
  getMcpServerConfig,
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  type McpRegistryOptions,
  type McpOAuthProviderHandle,
} from './modules/mcp';

// Connector types
export type { ConnectorFrontmatter } from './modules/connector/loader';
export {
  createConnectorRuntime,
  initializeConnectorRuntime,
  disposeConnectorRuntime,
} from './modules/connector';
export type { ConnectorToolCall, ConnectorRuntime, ConnectorRuntimeConfig } from './modules/connector/types';
export type {
  InboundEvent,
  ReplyAddress,
  ConnectorInboundRuntime,
  InboundAcceptResult,
  ExternalInboundInput,
  OutboundMessage,
  RespondResult,
} from './modules/connector/inbound/types';
export { ConnectorInboundGateway, ConnectorResponder } from './modules/connector/inbound';
export { FeishuWsClient } from './modules/connector/inbound/feishu-ws-client';
export type { FeishuWsClientConfig } from './modules/connector/inbound/feishu-ws-client';
export {
  InboundEventProcessor,
} from './modules/connector/inbound/inbound-processor';

// Inbound Agent 编排（从 composition/inbound 导出）
export {
  DefaultConversationResolver,
  DefaultInboundAgentService,
  configureConnectorInboundRuntime,
} from './composition/inbound';
export type {
  ConversationResolver,
  InboundAgentService,
  PendingApproval,
  ConfigureConnectorInboundOptions,
} from './composition/inbound';

// Permission types
export type { PermissionRule, PermissionBehavior } from './modules/permissions/types';
export { removeRule, saveRule, loadRules, updateRule } from './modules/permissions';

// Wiki module (knowledge system)
export {
  getPrimaryWikiDir,
  ensureWikiDirExists,
  loadWikiContext,
  formatWikiContextForPrompt,
  lintWiki,
  WIKI_GUIDELINES_PROMPT,
  DEFAULT_WIKI_CONFIG,
  DEFAULT_WIKI_CATEGORY,
  // Wiki IO
  readAllPages,
  readPage,
  writePage,
  updatePage,
  deletePage,
  replacePage,
  rebuildIndex,
  readIndex,
  appendLog,
  scanPageFiles,
  migrateWikiToDirectories,
  pageNameToFilename,
  filenameToPageName,
  type WikiPageData,
  type WikiPage,
  type IndexEntry,
  // Wiki mutation lock（所有写入必须经过，与 Agent 工具共享同一队列）
  withWikiMutationLock,
  // Wiki git version control
  ensureWikiGitRepo,
  commitWiki,
  // Wiki sources & relations
  listWikiSources,
  listPagesForSource,
  rebuildSourcePageIndex,
  type WikiSourceRecord,
} from './modules/wiki';

// Title generation
export { generateConversationTitle } from './modules/compaction';

// SubAgent types
export type { SubAgentStreamWriter } from './modules/agent';

// Cron Scheduler
export {
  CronScheduler,
  SQLiteCronJobStore,
  InMemoryCronJobStore,
  nextOccurrence,
  matches as matchesCronExpression,
  validateCronExpression,
  NO_SCHEDULE,
  buildFrontmatter,
  cronToIntervalMinutes,
  intervalMinutesToCron,
  TaskFrontmatterSchema,
} from './modules/cron';
export type {
  CronJob,
  CronExecution,
  CronJobCreateInput,
  CronJobUpdateInput,
  CronJobStore,
  CronSchedulerOptions,
  TaskFrontmatter,
  TaskLoaderOptions,
  InMemoryCronJobStoreOptions,
} from './modules/cron';

// ============================================================
// DataStore exports（补充）
// ============================================================
export { SQLiteDataStore } from './services/datastore/sqlite/sqlite-data-store';

// ============================================================
// Native 模块加载（SEA 支持）
// ============================================================
export { loadBetterSqlite3, getDatabase } from './services/datastore/sqlite/native-loader';
export type {
  SqliteDatabase,
  SqliteDatabaseConstructor,
  SqliteDatabaseOptions,
  SqliteStatement,
} from './primitives/datastore/types';

// ============================================================
// Context Budget（上下文用量单一类型源）
// ============================================================
// 三方真相源统一载体，跨 core/app 共享 schema 避免漂移。
// 设计参考：docs/context-usage-redesign.md §5
export {
  CompactionState,
  CompactionSnapshotSchema,
  CompactionStateTracker,
  type CompactionState as CompactionStateType,
  type CompactionSnapshot,
  type CompactionStateTrackerOptions,
} from './modules/compaction/state-tracker';
export {
  ContextBudgetSnapshotSchema,
  SessionCostSnapshotSchema,
  type ContextBudgetSnapshot,
  type SessionCostSnapshot,
  type ContextBudgetSource,
} from './services/context/budget-schema';
