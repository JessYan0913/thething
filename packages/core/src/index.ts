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
export { bootstrap, type CoreRuntime, type BootstrapOptions, type TokenizerConfig } from './bootstrap';
export { createAgent, createContext } from './api/app';
export type {
  AppContext,
  CreateAgentOptions,
  CreateAgentResult,
  CreateContextOptions,
  ModelConfig,
  ReloadOptions,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './api/app/types';
export { type ConnectorRegistry } from './extensions/connector';

// ============================================================
// 新的配置系统（推荐使用）
// ============================================================
export {
  buildBehaviorConfig,
  DEFAULT_MODEL_SPECS,
  DEFAULT_MODEL_ALIASES,
  type BehaviorConfig,
  type ModelSpec,
} from './config/behavior';

export {
  resolveLayout,
  buildDefaultResourceLayout,
  type LayoutConfig,
  type ResolvedLayout,
  type ResourceDirs,
} from './config/layout';

// ============================================================
// 配置常量（白名单导出）
// ============================================================
// 模型能力
export {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_OUTPUT_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from './config/defaults';

// Session 预算（deprecated）
/** @deprecated 使用 BehaviorConfig.maxBudgetUsdPerSession 代替 */
export { DEFAULT_MAX_BUDGET_USD } from './config/defaults';
/** @deprecated 使用 BehaviorConfig.maxDenialsPerTool 代替 */
export { DEFAULT_MAX_DENIALS_PER_TOOL } from './config/defaults';

// 压缩配置
export {
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_SESSION_MEMORY_CONFIG,
  DEFAULT_POST_COMPACT_CONFIG,
} from './config/defaults';

// Micro Compact
export { DEFAULT_MICRO_COMPACT_CONFIG } from './runtime/compaction/types';
export { DEFAULT_MICRO_COMPACT_CONFIG_RAW } from './config/defaults';

// 工具输出
export {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  MAX_TOOL_RESULT_TOKENS,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  PREVIEW_SIZE_CHARS,
  BYTES_PER_TOKEN,
} from './config/defaults';

// 数据存储
export {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_FILENAME,
  DEFAULT_PROJECT_CONFIG_DIR_NAME,
} from './config/defaults';

// ============================================================
// Foundation Layer（白名单导出）
// ============================================================
// DataStore
export {
  createDefaultDataStore,
  createInMemoryDataStore,
  createSQLiteDataStore,
} from './foundation/datastore';
export type {
  DataStore,
  ConversationStore,
  MessageStore,
  SummaryStore,
  CostStore,
  TaskStore,
  Conversation,
  StoredMessage,
  StoredSummary,
  CostRecord,
  SQLiteDataStoreConfig,
} from './foundation/datastore/types';

// Model
export {
  createModelProvider,
  createLanguageModel,
  getModelContextLimit,
  getDefaultOutputTokens,
  getModelCapabilities,
  getEffectiveContextBudget,
  getAutoCompactThreshold,
  // Pricing（定价配置）
  configurePricing,
  getModelPricing,
  getPricingRegistry,
  resetPricing,
  DEFAULT_PRICING,
} from './foundation/model';
export type {
  ModelCapabilities,
  ModelProviderConfig,
  ModelPricing,
  PricingRegistry,
} from './foundation/model';

// Clock（时间抽象）
export {
  systemClock,
  fixedClock,
  offsetClock,
  advancedClock,
} from './foundation/clock';
export type { Clock } from './foundation/clock';

// Paths
export { resolveProjectDir, resolveHomeDir } from './foundation/paths';

// Parser
export { parseFrontmatterFile, parseYamlFile, parseJsonFile } from './foundation/parser';

// ============================================================
// Runtime Layer（白名单导出）
// ============================================================
// Session State
export { createSessionState } from './runtime/session-state';
export type { SessionState, SessionStateOptions } from './runtime/session-state';

// Compaction
export {
  compactMessagesIfNeeded,
  estimateMessagesTokens,
  waitForConversationCompaction,
  waitForAllCompactions,
  runCompactInBackground,
} from './runtime/compaction';

// Tasks
export {
  createTaskStore,
  getGlobalTaskStore,
  initGlobalTaskStoreFromDataStore,
} from './runtime/tasks';
export type {
  Task,
  TaskStatus,
  TaskCreateInput,
  TaskUpdateInput,
  TaskClaimResult,
} from './runtime/tasks/types';

// ============================================================
// Extensions Layer（白名单导出）
// ============================================================
// Loaders
export {
  loadAll,
  loadSkills,
  clearSkillsCache,
  loadAgents,
  loadMcpServers,
  loadConnectors,
  loadPermissions,
  loadMemory,
} from './api/loaders';
export type {
  LoadAllOptions,
  LoadAllResult,
  MemoryEntry,
} from './api/loaders';

// Skill types
export type { Skill } from './extensions/skills/types';

// Agent types
export type { AgentDefinition } from './extensions/subagents/types';

// MCP types
export type { McpServerConfig, McpServerConfigSource } from './extensions/mcp/types';
export {
  createMcpRegistry,
  getMcpServerConfigs,
  getMcpServerConfig,
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
} from './extensions/mcp';

// Connector types
export type { ConnectorFrontmatter } from './extensions/connector/loader';
export {
  getConnectorRegistry,
  createWebhookHandler,
  inboundEventQueue,
  getWebhookConfigByHandler,
  buildWechatWebhookConfig,
  buildFeishuWebhookConfig,
} from './extensions/connector';
export type { ToolCallRequest } from './extensions/connector/types';

// Permission types
export type { PermissionRule, PermissionBehavior } from './extensions/permissions/types';
export { removeRule, saveRule, loadRules } from './extensions/permissions';

// Memory extraction
export {
  extractMemoriesInBackground,
  extractMemoriesFromConversation,
  scanMemoryFiles,
  loadEntrypoint,
  readMemoryContent,
} from './extensions/memory';

// Title generation
export { generateConversationTitle } from './runtime/compaction';

// SubAgent types
export type { SubAgentStreamWriter } from './extensions/subagents';

// ============================================================
// DataStore exports（补充）
// ============================================================
export { SQLiteDataStore } from './foundation/datastore/sqlite/sqlite-data-store';

// CredentialStore
export { CredentialStore, credentialStore } from './extensions/connector/credentials/store';

// ============================================================
// Native 模块加载（SEA 支持）
// ============================================================
export { loadBetterSqlite3, getDatabase } from './foundation/datastore/sqlite/native-loader';
export type {
  SqliteDatabase,
  SqliteDatabaseConstructor,
  SqliteDatabaseOptions,
  SqliteStatement,
} from './foundation/datastore/types';