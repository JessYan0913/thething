# `packages/core` 七个问题的设计补充

> 针对补充分析文档中识别的七个问题，给出具体的设计与实施方案

---

## 问题一：`export *` 导致边界失控

### 现状

`src/index.ts` 里四个无差别全量重导出，把 `SqliteDatabase`、`ConversationRow`、`initializeSchema`、`loadBetterSqlite3` 等内部实现细节全部变成公开 API 承诺。

### 设计原则

公开 API 是契约。`index.ts` 应该是一份**明确的意图声明**，而不是所有内部模块的透明玻璃。内部实现改变不应触发调用方的 breaking change。

### 设计方案

将 `index.ts` 改为显式白名单导出，按"调用方实际需要什么"来组织，而非按"内部有什么"。

```typescript
// src/index.ts（重写后）

// ============================================================
// 高层 API — 绝大多数调用方只需要这里
// ============================================================
export { createAgent, createContext } from './api/app';
export { bootstrap } from './bootstrap';
export { initAll } from './init';

// ============================================================
// 高层类型
// ============================================================
export type {
  // bootstrap
  CoreRuntime,
  BootstrapOptions,
  // context
  AppContext,
  CreateContextOptions,
  ResourceLayout,
  // agent
  AgentHandle,
  CreateAgentOptions,
  ModelConfig,
  ModuleToggles,
  SessionOverrides,
  // events
  LoadEvent,
  LoadError,
} from './api/app/types';

// ============================================================
// DataStore — 允许调用方自定义实现
// ============================================================
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

// 工厂函数（允许创建自定义 store 时与 SQLite 混用）
export { createSQLiteDataStore } from './foundation/datastore/sqlite';
// 测试辅助
export { createInMemoryDataStore } from './foundation/datastore/store';

// ============================================================
// 扩展类型 — 供自定义 skill/agent/connector 使用
// ============================================================
export type { Skill, SkillMetadata, SkillFrontmatter } from './extensions/skills/types';
export type { AgentDefinition, AgentFrontmatter } from './extensions/subagents/types';
export type { McpServerConfig } from './extensions/mcp/types';
export type { ConnectorDefinition } from './extensions/connector/types';
export type { MemoryEntry } from './extensions/memory/types';
export type { PermissionRule } from './extensions/permissions/types';

// ============================================================
// 会话状态 — 供 onFinish 回调中访问
// ============================================================
export type { SessionState } from './runtime/session-state/types';

// ============================================================
// 配置常量 — 供需要与 core 共享约定的上层包使用
// ============================================================
export {
  DEFAULT_PROJECT_CONFIG_DIR_NAME,
  DEFAULT_DATA_DIR,
  DEFAULT_DB_FILENAME,
} from './config/defaults';

// ============================================================
// 不再导出的内容（内部实现，不作承诺）
// ============================================================
// ✗ SqliteDatabase / SqliteStatement / SqliteDatabaseConstructor
// ✗ ConversationRow / MessageRow / SummaryRow / CostRow
// ✗ initializeSchema / initializeCostSchema
// ✗ loadBetterSqlite3 / getDatabase
// ✗ InMemoryTaskStore / HighWaterMarkImpl
// ✗ compactViaAPI / runCompactInBackground（内部调度细节）
// ✗ getGlobalDataStore / setGlobalDataStore（被 CoreRuntime 取代）
```

**分层 entry point 保持不变**，`@the-thing/core/foundation`、`@the-thing/core/api` 这些子路径继续存在，供需要底层能力的高级用户使用，但在 `package.json` 的 `exports` 字段中明确标记：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./api": "./dist/api/index.js",
    "./foundation": "./dist/foundation/index.js",
    "./foundation/paths": "./dist/foundation/paths/index.js",
    "./foundation/datastore": "./dist/foundation/datastore/index.js"
  }
}
```

---

## 问题二：`runtime/tasks` 生命周期与持久化

### 现状

- `InMemoryTaskStore` 以进程级全局单例存在，不同对话的任务混存靠 `conversationId` 过滤
- `HighWaterMark` 内存计数，重启后从 1 重置，可能与历史任务 ID 冲突
- 后台 Agent 任务进程重启后全部丢失

### 设计原则

任务是对话级资源，生命周期应该绑定到对话，而不是进程。对于后台任务，持久化是可靠性的前提。

### 设计方案

#### 2a. 将 `TaskStore` 纳入 `DataStore` 接口

```typescript
// foundation/datastore/types.ts 新增

export interface Task {
  id: string;
  conversationId: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  claimedBy: string | null;
  activeForm: string | null;
  blockedBy: string[];   // task IDs
  blocks: string[];      // task IDs（反向索引，由实现层维护）
  createdAt: number;     // unix ms
  updatedAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface TaskStore {
  createTask(input: Omit<Task, 'id' | 'blocks' | 'createdAt' | 'updatedAt' | 'completedAt'>): Task;
  getTask(id: string): Task | undefined;
  getTasksByConversation(conversationId: string): Task[];
  getAvailableTasks(conversationId: string): Task[];
  updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'subject' | 'activeForm' | 'claimedBy' | 'blockedBy' | 'metadata'>>): Task | undefined;
  deleteTask(id: string): boolean;
  claimTask(taskId: string, agentId: string): { success: boolean; task?: Task; message?: string };
  /** 清理指定对话的所有任务（对话结束时调用） */
  clearConversationTasks(conversationId: string): void;
  subscribe(listener: (event: TaskEvent) => void): () => void;
}

// DataStore 接口新增 taskStore
export interface DataStore {
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  summaryStore: SummaryStore;
  costStore: CostStore;
  taskStore: TaskStore;        // ← 新增
  transaction<T>(fn: () => T): T;
  close(): void;
  isConnected(): boolean;
}
```

#### 2b. SQLite `TaskStore` 实现

```typescript
// foundation/datastore/sqlite/task-store.ts

export class SQLiteTaskStore implements TaskStore {
  constructor(private db: SqliteDatabase) {}

  createTask(input: TaskCreateInput): Task {
    // id 由 SQLite AUTOINCREMENT 生成，格式化为 'task-{n}'
    const stmt = this.db.prepare(`
      INSERT INTO tasks (conversation_id, subject, status, claimed_by, active_form,
                         blocked_by, created_at, updated_at, metadata)
      VALUES (?, ?, 'pending', NULL, NULL, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const blockedByJson = JSON.stringify(input.blockedBy ?? []);
    const result = stmt.run(
      input.conversationId, input.subject, blockedByJson,
      now, now, JSON.stringify(input.metadata ?? {})
    ) as { lastInsertRowid: number };

    // 更新 blockedBy 任务的 blocks 反向索引
    for (const depId of (input.blockedBy ?? [])) {
      this.appendToBlocks(depId, `task-${result.lastInsertRowid}`);
    }

    return this.getTask(`task-${result.lastInsertRowid}`)!;
  }

  private appendToBlocks(taskId: string, dependentId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;
    const blocks = [...task.blocks, dependentId];
    this.db.prepare(`UPDATE tasks SET blocks = ? WHERE id = ?`)
      .run(JSON.stringify(blocks), taskId);
  }

  // ... getTask, updateTask, claimTask 等实现遵循相同的 JSON 序列化模式

  clearConversationTasks(conversationId: string): void {
    this.db.prepare(`DELETE FROM tasks WHERE conversation_id = ?`).run(conversationId);
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    // SQLite 实现用轮询或 WAL hook；对于纯内存场景可维护 listeners Set
    // 此处返回轻量内存订阅（适合单进程）
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _listeners = new Set<(event: TaskEvent) => void>();
  private emit(event: TaskEvent) {
    for (const l of this._listeners) l(event);
  }
}
```

#### 2c. Schema 新增 `tasks` 表

```typescript
// foundation/datastore/sqlite/schema.ts 新增

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY DEFAULT ('task-' || last_insert_rowid()),
  conversation_id TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending','in_progress','completed','failed','cancelled')),
  claimed_by TEXT,
  active_form TEXT,
  blocked_by TEXT NOT NULL DEFAULT '[]',   -- JSON array of task IDs
  blocks     TEXT NOT NULL DEFAULT '[]',   -- JSON array of task IDs (反向索引)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  metadata   TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_conversation
  ON tasks(conversation_id, status);
```

> **注意**：SQLite 的 `last_insert_rowid()` 在 DEFAULT 表达式里不可靠，实际实现应在应用层生成 ID：插入时不指定 ID（让 rowid 自增），插入后用 `lastInsertRowid` 拼接成 `task-{n}` 再更新，或改为用 `nanoid()` 生成字符串 ID（更简单，放弃数字序列语义）。

#### 2d. 原 `runtime/tasks/` 模块的处理

原 `InMemoryTaskStore` 保留但降级为测试工具和单会话快速场景，从公开 API 中移除全局单例函数：

```typescript
// runtime/tasks/store.ts 精简后

// 保留：供测试和嵌入式场景使用
export { InMemoryTaskStore } from './in-memory-store';

// 移除：getGlobalTaskStore / setGlobalTaskStore
// 任务存储通过 CoreRuntime.dataStore.taskStore 获取
```

---

## 问题三：`AgentHandle` 缺少 `dispose()`

### 现状

`cleanupToolResults()` 挂在 `SessionState` 上，但没有对应的顶层触发时机。`mcpRegistry.disconnectAll()` 需要调用方在 `onFinish` 里手动调用，但没有任何类型约束保证这一点。

### 设计方案

在 `AgentHandle` 上增加 `dispose()` 方法，把所有对话结束时需要执行的清理动作内聚到一处：

```typescript
// api/app/types.ts

export interface AgentHandle {
  agent: ToolLoopAgent;
  sessionState: SessionState;
  mcpRegistry: McpRegistry | null;
  tools: ToolSet;
  instructions: string;
  adjustedMessages: UIMessage[];
  model: LanguageModelV3;

  /**
   * 释放本次对话占用的所有资源。
   *
   * 执行顺序：
   * 1. 等待所有进行中的后台压缩完成
   * 2. 断开所有 MCP 连接
   * 3. 清理本会话的工具结果缓存文件
   * 4. 将 sessionState.aborted 置为 true（防止后续误用）
   *
   * 在 createAgentUIStream 的 onFinish 回调中调用：
   * ```typescript
   * onFinish: async () => {
   *   store.messageStore.saveMessages(conversationId, messages);
   *   await handle.dispose();
   * }
   * ```
   */
  dispose(): Promise<void>;
}
```

`createAgent` 中构建 `dispose` 的实现：

```typescript
// api/app/agent.ts（createAgent 返回值构建部分）

return {
  agent,
  sessionState,
  mcpRegistry: mcpRegistry ?? null,
  tools: finalTools,
  instructions,
  adjustedMessages: finalMessages,
  model: modelInstance,

  async dispose(): Promise<void> {
    // 1. 等待后台压缩完成（避免关闭数据库时写入失败）
    await waitForConversationCompaction(conversationId);

    // 2. 断开 MCP 连接
    if (mcpRegistry) {
      await mcpRegistry.disconnectAll().catch((e) =>
        console.warn('[AgentHandle] MCP disconnect error:', e)
      );
    }

    // 3. 清理工具结果缓存
    await sessionState.cleanupToolResults().catch((e) =>
      console.warn('[AgentHandle] Tool result cleanup error:', e)
    );

    // 4. 标记状态失效
    sessionState.abort();
  },
};
```

**`waitForConversationCompaction`** 由 `background-queue.ts` 导出（见问题六）。

---

## 问题四：`CredentialStore` 空密钥安全漏洞

### 现状

```typescript
const key = options?.encryptionKey || process.env.CONNECTOR_ENCRYPTION_KEY || ''
if (key.length < 32) {
  this.encryptionKey = crypto.createHash('sha256').update(key).digest()
}
```

`key === ''` 时产生固定可预测密钥；SHA-256 是高速哈希，不适合做密钥派生。

### 设计方案

分三层处理：

```typescript
// extensions/connector/credentials/store.ts

export class CredentialStore {
  private encryptionKey: Buffer;
  private readonly mode: 'encrypted' | 'plaintext';

  constructor(options?: CredentialStoreOptions) {
    const rawKey = options?.encryptionKey ?? process.env.CONNECTOR_ENCRYPTION_KEY;

    if (!rawKey) {
      if (process.env.NODE_ENV === 'production') {
        // 生产环境：无密钥时拒绝初始化
        throw new Error(
          '[CredentialStore] Encryption key is required in production. ' +
          'Set CONNECTOR_ENCRYPTION_KEY (min 16 chars) or pass encryptionKey option.'
        );
      }
      // 开发/测试环境：明文模式 + 警告
      console.warn(
        '[CredentialStore] ⚠️  No encryption key provided. ' +
        'Credentials will be stored in plaintext. ' +
        'Set CONNECTOR_ENCRYPTION_KEY for production use.'
      );
      this.mode = 'plaintext';
      this.encryptionKey = Buffer.alloc(32); // 占位，明文模式不使用
      return;
    }

    if (rawKey.length < 16) {
      throw new Error(
        `[CredentialStore] Encryption key too short (${rawKey.length} chars, min 16).`
      );
    }

    // 使用 scrypt 做密钥派生：慢速，抵抗暴力破解
    // salt 固定在代码中（应用级常量），不存储在文件里
    const SALT = 'thething-credential-store-v1';
    this.encryptionKey = crypto.scryptSync(rawKey, SALT, 32, {
      N: 16384,   // CPU/内存代价，OWASP 推荐最低值
      r: 8,
      p: 1,
    });
    this.mode = 'encrypted';
  }

  private encrypt(plaintext: string): { iv: string; ciphertext: string; authTag: string } {
    if (this.mode === 'plaintext') {
      return { iv: '', ciphertext: plaintext, authTag: '' };
    }
    const iv = crypto.randomBytes(12); // GCM 推荐 96-bit IV
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(iv: string, ciphertext: string, authTag: string): string {
    if (this.mode === 'plaintext') {
      return ciphertext; // plaintext 模式下 ciphertext 就是原始内容
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return decipher.update(Buffer.from(ciphertext, 'base64')).toString('utf-8')
      + decipher.final('utf-8');
  }

  // ... 其余 save/load/delete 方法不变，内部改用 this.encrypt/decrypt
}
```

**同时**，`storagePath` 的默认值（`process.cwd() + '/.connector-credentials.json'`）也应通过 `bootstrap` 注入，而不是在构造器里硬编码：

```typescript
// bootstrap.ts
export interface BootstrapOptions {
  dataDir: string;
  credentialsPath?: string;     // 默认 dataDir + '/credentials.json'
  encryptionKey?: string;       // 如不提供则读 CONNECTOR_ENCRYPTION_KEY
  connectorConfig?: ConnectorGatewayConfig;
  modelPricing?: Record<string, ModelPricingConfig>;  // 见问题七
}
```

---

## 问题五：`extensions/memory` 两套记忆边界模糊

### 现状

文件系统记忆（`.thething/memory/`）和数据库摘要（`summaries` 表）在系统提示构建时被混合注入，Agent 无法区分记忆来源和置信度。`Date.now()` 直调导致时间相关逻辑不可测试。

### 设计方案

#### 5a. 明确区分 `MemoryContext` 中的两类记忆

```typescript
// extensions/memory/types.ts 新增

export type MemoryFreshness = 'fresh' | 'aging' | 'stale';

export interface LongTermMemory {
  /** 文件名（作为标识） */
  filename: string;
  /** 文件系统绝对路径 */
  path: string;
  /** 记忆类型：user / feedback / project / reference */
  type: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 文件修改时间（unix ms） */
  mtimeMs: number;
  /** 新鲜度评估 */
  freshness: MemoryFreshness;
  /** 面向 Agent 的新鲜度说明（已本地化） */
  freshnessNote: string | null;
  /** 与当前查询的相关性得分 */
  relevanceScore: number;
}

export interface SessionSummary {
  /** 摘要文本 */
  text: string;
  /** 摘要覆盖的最后一条消息序号 */
  lastMessageOrder: number;
  /** 压缩前的 token 数 */
  preCompactTokenCount: number;
  /** 压缩时间（unix ms） */
  compactedAt: number;
}

/**
 * 注入 system prompt 的完整记忆上下文。
 * 两类记忆明确分离，让 system-prompt builder 和 Agent 都能清楚感知来源。
 */
export interface MemoryContext {
  /** 来自文件系统的长期记忆（用户主动写入） */
  longTerm: LongTermMemory[];
  /** 来自数据库的对话摘要（压缩产物） */
  sessionSummary: SessionSummary | null;
}
```

#### 5b. 时间注入 — 将 `Clock` 作为参数

不需要引入复杂的依赖注入框架，一个简单的函数类型就够了：

```typescript
// foundation/clock.ts（新文件）

export type Clock = () => number;

/** 生产用：直接返回系统时间 */
export const systemClock: Clock = () => Date.now();

/** 测试用：返回固定时间 */
export function fixedClock(ms: number): Clock {
  return () => ms;
}

/** 测试用：可推进的时钟 */
export function advancedClock(initialMs: number): Clock & { advance(ms: number): void } {
  let current = initialMs;
  const clock = () => current;
  clock.advance = (ms: number) => { current += ms; };
  return clock;
}
```

`memoryFreshnessNote` 和 `computeMemoryAgeStats` 改为接受 `clock` 参数：

```typescript
// extensions/memory/memory-age.ts

import type { Clock } from '../../foundation/clock';
import { systemClock } from '../../foundation/clock';

export function memoryFreshnessNote(
  mtimeMs: number,
  clock: Clock = systemClock   // 默认用系统时间，测试时可注入
): FreshnessNote | null {
  const ageMs = clock() - mtimeMs;
  const ageDays = Math.floor(ageMs / DAY_MS);
  // ... 其余逻辑不变
}

export function computeMemoryAgeStats(
  mtimeMs: number,
  clock: Clock = systemClock
): { ageDays: number; isStale: boolean; isVeryStale: boolean } {
  const ageMs = clock() - mtimeMs;
  const ageDays = Math.floor(ageMs / DAY_MS);
  return {
    ageDays,
    isStale: ageDays >= 30,
    isVeryStale: ageDays >= 90,
  };
}
```

`findRelevantMemories` 同样接受 `clock`，让完整的记忆加载路径都可以在测试中控制时间：

```typescript
// extensions/memory/find-relevant.ts

export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  options: FindRelevantOptions & { clock?: Clock } = {}
): Promise<RelevantMemory[]> {
  const clock = options.clock ?? systemClock;
  // 内部所有 Date.now() 调用替换为 clock()
}
```

#### 5c. `system-prompt/sections/memory.ts` 明确分段

```typescript
// 改造后的系统提示记忆章节构建

export function buildMemorySection(ctx: MemoryContext): string {
  const parts: string[] = [];

  // 摘要在最前面，代表"此前对话的结论"
  if (ctx.sessionSummary) {
    parts.push(`## 对话摘要（上下文压缩产物）`);
    parts.push(ctx.sessionSummary.text);
    parts.push('');
  }

  // 长期记忆分组显示，每条注明新鲜度
  if (ctx.longTerm.length > 0) {
    parts.push(`## 长期记忆（来自文件，由用户写入）`);
    for (const mem of ctx.longTerm) {
      parts.push(`### ${mem.filename} [${mem.type}]${mem.freshnessNote ? ' ' + mem.freshnessNote : ''}`);
      parts.push(mem.content);
      parts.push('');
    }
  }

  return parts.join('\n');
}
```

---

## 问题六：`background-queue.ts` 无法等待完成

### 现状

`compactQueue` 是模块级 `Map`，进程退出时无法等待正在进行的压缩写入完成，可能导致摘要数据库写入中断。

### 设计方案

为 `background-queue.ts` 增加 `waitForConversationCompaction` 和 `waitForAllCompactions` 两个函数，供 `AgentHandle.dispose()` 和 `CoreRuntime.dispose()` 使用：

```typescript
// runtime/compaction/background-queue.ts（补充导出）

const compactQueue = new Map<string, Promise<void>>();

export function runCompactInBackground(
  messages: UIMessage[],
  conversationId: string,
  model?: LanguageModelV3
): void {
  // ... 现有实现不变
}

export function isCompactInProgress(conversationId: string): boolean {
  return compactQueue.has(conversationId);
}

export function getQueueSize(): number {
  return compactQueue.size;
}

/**
 * 等待指定对话的后台压缩完成。
 * 如果没有进行中的压缩，立即 resolve。
 * 供 AgentHandle.dispose() 调用。
 */
export async function waitForConversationCompaction(conversationId: string): Promise<void> {
  const promise = compactQueue.get(conversationId);
  if (promise) {
    await promise.catch(() => {}); // 压缩失败不影响 dispose 流程
  }
}

/**
 * 等待所有对话的后台压缩完成。
 * 供 CoreRuntime.dispose() 在关闭数据库前调用。
 */
export async function waitForAllCompactions(): Promise<void> {
  if (compactQueue.size === 0) return;
  await Promise.allSettled(Array.from(compactQueue.values()));
}
```

`CoreRuntime.dispose()` 集成：

```typescript
// bootstrap.ts

export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  // ... 初始化逻辑

  return {
    dataDir: options.dataDir,
    dataStore,
    connectorGateway,

    async dispose(): Promise<void> {
      // 1. 等待所有后台压缩写完，再关数据库
      //    否则 summaryStore.saveSummary() 可能在 db.close() 后执行
      await waitForAllCompactions();

      // 2. 关闭 Connector Gateway
      await connectorGateway.shutdown().catch((e) =>
        console.warn('[CoreRuntime] Connector shutdown error:', e)
      );

      // 3. 关闭数据库连接
      dataStore.close();
    },
  };
}
```

---

## 问题七：模型定价硬编码

### 现状

```typescript
// runtime/session-state/cost.ts
const PRICING: Record<string, { input: number; output: number; cached: number }> = {
  'qwen-max': { input: 4, output: 12, cached: 1 },
  'qwen-plus': { input: 1.5, output: 4.5, cached: 0.5 },
  // ...
};
```

定价变动需要发布新版 `core`；企业协议/代理商定价无法覆盖。

### 设计方案

#### 7a. 定价类型定义

```typescript
// foundation/model/pricing.ts（新文件）

/**
 * 模型定价配置，单位：USD / 百万 token
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

/**
 * 内置定价表（作为兜底默认值）。
 * 数据来源：各厂商公开文档，不保证实时准确。
 * 生产部署时建议通过 bootstrap({ modelPricing }) 覆盖。
 */
export const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'qwen-max':         { inputPerMillion: 4,   outputPerMillion: 12,  cachedPerMillion: 1   },
  'qwen-max-latest':  { inputPerMillion: 4,   outputPerMillion: 12,  cachedPerMillion: 1   },
  'qwen-plus':        { inputPerMillion: 1.5, outputPerMillion: 4.5, cachedPerMillion: 0.5 },
  'qwen-plus-latest': { inputPerMillion: 1.5, outputPerMillion: 4.5, cachedPerMillion: 0.5 },
  'qwen-turbo':       { inputPerMillion: 0.5, outputPerMillion: 1.5, cachedPerMillion: 0.2 },
  'qwen-turbo-latest':{ inputPerMillion: 0.5, outputPerMillion: 1.5, cachedPerMillion: 0.2 },
  'deepseek-v3':      { inputPerMillion: 1.2, outputPerMillion: 4.8, cachedPerMillion: 0.4 },
};

/**
 * 模块级定价注册表（单例，由 bootstrap 设置一次）
 */
let activePricing: Record<string, ModelPricing> = { ...BUILTIN_PRICING };

export function configurePricing(overrides: Record<string, ModelPricing>): void {
  activePricing = { ...BUILTIN_PRICING, ...overrides };
}

export function getModelPricing(modelName: string): ModelPricing | null {
  // 精确匹配
  if (activePricing[modelName]) return activePricing[modelName];

  // 前缀模糊匹配（处理 'qwen-max-2025-01-01' 这类带日期后缀的模型名）
  const prefix = Object.keys(activePricing).find(k => modelName.startsWith(k));
  return prefix ? activePricing[prefix] : null;
}

export function getModelPricingOrDefault(modelName: string): ModelPricing {
  return getModelPricing(modelName) ?? {
    inputPerMillion: 0,
    outputPerMillion: 0,
    cachedPerMillion: 0,
  };
}
```

#### 7b. `CostTracker` 改为使用 `getModelPricing`

```typescript
// runtime/session-state/cost.ts（精简后）

import { getModelPricingOrDefault } from '../../foundation/model/pricing';

export class CostTracker {
  // 移除模块级 PRICING 常量

  calculateDelta(inputTokens: number, outputTokens: number, cachedReadTokens: number): CostDelta {
    const pricing = getModelPricingOrDefault(this._model);
    const M = 1_000_000;

    const inputCost  = (inputTokens  / M) * pricing.inputPerMillion;
    const outputCost = (outputTokens / M) * pricing.outputPerMillion;
    const cachedCost = (cachedReadTokens / M) * pricing.cachedPerMillion;

    return {
      inputTokens, outputTokens, cachedReadTokens,
      inputCost, outputCost, cachedCost,
      totalCost: inputCost + outputCost + cachedCost,
    };
  }

  // ... 其余方法不变
}
```

#### 7c. `bootstrap` 接受定价覆盖

```typescript
// bootstrap.ts

export interface BootstrapOptions {
  dataDir: string;
  /**
   * 覆盖内置模型定价。键为模型名，值为 USD/百万 token。
   *
   * @example
   * bootstrap({
   *   dataDir: './data',
   *   modelPricing: {
   *     'qwen-max': { inputPerMillion: 3.5, outputPerMillion: 10, cachedPerMillion: 0.8 }
   *   }
   * })
   */
  modelPricing?: Record<string, ModelPricing>;
  credentialsPath?: string;
  encryptionKey?: string;
  connectorConfig?: ConnectorGatewayConfig;
}

export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  // 定价配置最先执行，确保后续所有 CostTracker 使用正确数据
  if (options.modelPricing) {
    configurePricing(options.modelPricing);
  }

  // ... 其余初始化
}
```

---

## 七个问题的实施顺序建议

按依赖关系和风险从低到高排序：

| 顺序 | 问题 | 理由 |
|------|------|------|
| 1 | **问题四（密钥安全）** | 安全漏洞，零依赖，独立可改 |
| 2 | **问题七（定价注入）** | 纯增量改动，不改接口，只改常量的取用方式 |
| 3 | **问题五（记忆边界 + Clock）** | `Clock` 是纯增量，`MemoryContext` 类型改动影响 system-prompt builder |
| 4 | **问题六（压缩等待）** | 增量导出两个函数，为问题三的 dispose 做铺垫 |
| 5 | **问题三（AgentHandle.dispose）** | 依赖问题六；需与前两篇文档的 `AgentHandle` 设计协同 |
| 6 | **问题二（TaskStore 持久化）** | 改动 `DataStore` 接口，影响范围最大，需要 Schema 迁移 |
| 7 | **问题一（export 白名单）** | 最后做：等前六个改动稳定后，才能准确判断哪些需要公开 |

问题一放最后的原因：过早锁定导出白名单，等后续改动完成后又发现需要暴露新内容，反而增加摩擦。待其他改动稳定后，白名单可以一次性准确制定。
