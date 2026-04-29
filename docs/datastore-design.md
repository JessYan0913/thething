# `foundation/datastore` 设计分析与优化方案

> 基于对现有代码的完整阅读，评估 DataStore 的设计合理性，并提出具体改进建议

---

## 一、现有设计整体评价

先给一个直接的判断：**接口设计方向是对的，但实现层存在三个结构性问题**，这三个问题会在系统规模增长时同步放大。

优点值得先说清楚：

- `DataStore` 拆成四个子 Store（`ConversationStore` / `MessageStore` / `SummaryStore` / `CostStore`），粒度合适，边界清晰
- `types.ts` 与实现完全分离，接口文件无任何实现依赖，可独立 mock
- 支持整体替换和局部替换（`{ ...sqliteStore, costStore: new RedisStore() }`），扩展点设计灵活
- `SqliteDatabase` 接口化处理，规避了直接依赖 `better-sqlite3` 类型的问题

但三个结构性问题需要正视：

---

## 二、问题诊断

### 问题 1：全局单例模式与显式依赖原则冲突

这是最核心的问题。`store.ts` 维护了一个模块级全局变量：

```typescript
// store.ts
let globalDataStore: DataStore | null = null;

export function getGlobalDataStore(): DataStore {
  if (!globalDataStore) {
    globalDataStore = new SQLiteDataStore();  // 懒创建，路径来自 process.cwd()
  }
  return globalDataStore;
}
```

`runtime` 层的多个模块通过 `getGlobalDataStore()` 隐式取用这个单例：

```
runtime/session-state/cost.ts      → getGlobalDataStore().costStore
runtime/compaction/api-compact.ts  → getGlobalDataStore().summaryStore
runtime/compaction/index.ts        → getGlobalDataStore().summaryStore
extensions/connector/agent-handler → getGlobalDataStore()
```

这导致了两个具体问题：

**问题 1a：隐式顺序依赖无法静态验证**

`configureDataStore()` 必须在任何 `getGlobalDataStore()` 调用前执行，但这个约束只靠文档和 `console.warn` 来表达。当 `CostTracker` 在构造时调用 `getGlobalDataStore()`，而调用方忘记先调 `initAll`，系统会用 `process.cwd()/.data` 默默创建一个默认库，而不是报错。这类"静默成功但行为错误"的 bug 极难排查。

**问题 1b：测试隔离困难**

`resetGlobalDataStore()` 存在，说明测试已经遇到了这个问题。但"用全局重置函数来做测试隔离"本身就是绕过设计缺陷的补丁，而不是解决方案。并行测试时，不同测试用例会共享同一个全局状态。

---

### 问题 2：`CostStore` 的 Schema 初始化设计不一致

其他三个 Store 的 Schema 在 `SQLiteDataStore` 构造时统一由 `initializeSchema(db)` 初始化，只有 `CostStore` 需要调用方手动触发 `ensureSchema()`：

```typescript
// schema.ts：主 Schema 在构造时初始化
export function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations ...
    CREATE TABLE IF NOT EXISTS messages ...
    CREATE TABLE IF NOT EXISTS summaries ...
    -- chat_costs 不在这里！
  `);
}

// cost-store.ts：CostStore 自己管理自己的 Schema
export class SQLiteCostStore implements CostStore {
  ensureSchema(): void {
    if (this.schemaInitialized) return;
    db.exec(`CREATE TABLE IF NOT EXISTS chat_costs ...`);
    this.schemaInitialized = true;
  }
}
```

`schema.ts` 里同时存在 `initializeCostSchema` 函数，但 `SQLiteDataStore` 构造时并没有调用它，`CostStore` 内部又重复了相同的 DDL。这造成了：

- 同一张表的 Schema 定义散落在两处（`schema.ts::initializeCostSchema` 和 `cost-store.ts::ensureSchema`）
- 其他 Store 不需要关心 Schema，`CostStore` 却需要，行为不一致
- 调用 `costStore.saveCostRecord()` 前忘记调 `ensureSchema()` 会导致运行时错误，但接口上看不出这个前置条件

---

### 问题 3：`SQLiteDataStore` 暴露了 `getRawDb()`

```typescript
// sqlite-data-store.ts
/**
 * Get raw database connection.
 * For advanced use cases only - prefer using sub-stores.
 * @internal
 */
getRawDb(): SqliteDatabase {
  return this.db;
}
```

虽然有 `@internal` 注释，但它是 `public` 方法。`DataStore` 接口本身没有 `getRawDb`，这个方法只在 `SQLiteDataStore` 具体类上。这说明有调用方在用 `as SQLiteDataStore` 强转后才能访问它——这破坏了接口抽象，让"可替换"的承诺打了折扣。

真正需要裸 DB 访问的场景（比如事务跨多个 Store），应该通过在 `DataStore` 接口上显式声明 `transaction()` 方法来解决，而不是暴露底层连接。

---

### 问题 4（次要）：`native-loader.ts` 位置不合适

`native-loader.ts` 放在 `src/` 根目录，内容是加载 `better-sqlite3` 原生模块的 SEA（Single Executable Application）适配逻辑。这个文件是纯粹的基础设施，应该归属于 `foundation/datastore/sqlite/` 内部，而不是游离在 `src/` 顶层，暴露给整个 `core` 包。

---

## 三、重设计方案

### 3.1 核心改变：DataStore 变成显式依赖

与[整体架构重设计](./core-redesign.md)中的 `bootstrap()` 方案协调：`DataStore` 由 `CoreRuntime` 持有，通过参数传递给需要它的模块，不再通过全局单例获取。

```typescript
// bootstrap.ts（已在架构文档中定义）
export interface CoreRuntime {
  readonly dataDir: string;
  readonly dataStore: DataStore;   // 持有 DataStore 实例
  readonly connectorGateway: ConnectorGateway;
  dispose(): Promise<void>;
}
```

`runtime` 层的模块（`CostTracker`、`compaction`）改为接受 `DataStore` 或子 Store 作为构造参数：

```typescript
// 改造前
export class CostTracker {
  persistCost() {
    const costStore = getGlobalDataStore().costStore;  // 隐式全局取用
    costStore.saveCostRecord(...);
  }
}

// 改造后
export class CostTracker {
  constructor(
    conversationId: string,
    options: CostTrackerOptions,
    private readonly costStore: CostStore  // 显式注入
  ) {}

  persistCost() {
    this.costStore.saveCostRecord(...);  // 使用注入的实例
  }
}
```

`CostTracker` 由 `createSessionState` 创建，`createSessionState` 由 `createAgent` 调用，`createAgent` 接受 `AppContext`，`AppContext` 持有 `CoreRuntime`，`CoreRuntime` 持有 `DataStore`。依赖链完整闭合，每一步都显式。

---

### 3.2 DataStore 接口补充 `transaction()`

解决"需要跨 Store 事务"的需求，不再通过 `getRawDb()` 漏底层连接：

```typescript
// types.ts 补充

export interface DataStore {
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  summaryStore: SummaryStore;
  costStore: CostStore;

  /**
   * 在事务中执行多个 Store 操作。
   * SQLite 实现使用 db.transaction()；
   * 远程实现（PostgreSQL）可用 BEGIN/COMMIT 语句实现；
   * 若实现不支持事务，可直接执行回调（降级）。
   */
  transaction<T>(fn: () => T): T;

  close(): void;
  isConnected(): boolean;
}
```

SQLite 实现：

```typescript
// sqlite-data-store.ts
transaction<T>(fn: () => T): T {
  const tx = this.db.transaction(fn);
  return tx();
}
```

这样跨 Store 的原子操作（比如删对话时同时删消息+摘要+费用记录）可以用 `dataStore.transaction()` 包裹，而不必依赖裸 DB 连接。

---

### 3.3 统一 Schema 初始化

`chat_costs` 表移入主 `initializeSchema`，`CostStore` 的 `ensureSchema()` 方法从接口中移除：

```typescript
// schema.ts（重构后）
export function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT 'New Conversation',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      compacted_at TEXT DEFAULT (datetime('now')),
      last_message_order INTEGER NOT NULL,
      pre_compact_token_count INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- 统一纳入主 Schema，不再由 CostStore 自行管理
    CREATE TABLE IF NOT EXISTS chat_costs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_read_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, "order");
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_summaries_conversation
      ON summaries(conversation_id, compacted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_costs_conversation
      ON chat_costs(conversation_id);
  `);
}
```

`CostStore` 接口去掉 `ensureSchema()`：

```typescript
// 改造前
export interface CostStore {
  ensureSchema(): void;     // ← 移除，不应该由调用方负责
  saveCostRecord(...): CostRecord;
  ...
}

// 改造后
export interface CostStore {
  saveCostRecord(...): CostRecord;
  getCostByConversation(conversationId: string): CostRecord | null;
  updateCostByConversation(conversationId: string, params: CostDelta): void;
}
```

---

### 3.4 `native-loader.ts` 收归 SQLite 模块内部

```
foundation/datastore/
├── index.ts
├── types.ts
├── store.ts                 # 移除全局单例，仅保留工厂函数
└── sqlite/
    ├── index.ts
    ├── native-loader.ts     # ← 从 src/ 根目录移入此处
    ├── schema.ts
    ├── sqlite-data-store.ts
    ├── conversation-store.ts
    ├── message-store.ts
    ├── summary-store.ts
    └── cost-store.ts
```

`native-loader.ts` 是 SQLite 实现的内部细节，只被 `sqlite-data-store.ts` 引用，不应该从外部可见。

---

### 3.5 保留但精简 `store.ts`

全局单例 API 可以保留，但仅作为便捷工厂，语义从"全局状态管理"变为"默认实例创建"：

```typescript
// store.ts（精简后）

/**
 * 创建一个使用默认配置的 SQLiteDataStore 实例。
 * 适合脚本、CLI 工具等不需要精细控制生命周期的场景。
 *
 * 对于服务端应用，推荐通过 bootstrap() 创建 CoreRuntime，
 * 从 runtime.dataStore 取用实例，而不是调用此函数。
 */
export function createDefaultDataStore(config?: SQLiteDataStoreConfig): DataStore {
  return new SQLiteDataStore(config);
}

// 测试辅助：创建内存 SQLite 实例
export function createInMemoryDataStore(): DataStore {
  return new SQLiteDataStore({ dataDir: ':memory:' });
}

// 移除：getGlobalDataStore / setGlobalDataStore / configureDataStore / resetGlobalDataStore
// 这些全局状态管理函数统一由 CoreRuntime 承接
```

---

## 四、Schema 版本管理（前瞻性建议）

现有 Schema 使用 `CREATE TABLE IF NOT EXISTS`，没有任何迁移机制。这在当前阶段可以接受，但一旦 DataStore 成为正式的用户数据载体，Schema 变更就会成为痛点。建议在 Schema 文件中预埋版本号记录，不需要立刻引入完整的迁移框架：

```typescript
// schema.ts 追加

const SCHEMA_VERSION = 2;

export function ensureSchemaVersion(db: SqliteDatabase): void {
  // 用 SQLite user_version pragma 存储版本号（不占用业务表空间）
  const currentVersion = db.pragma('user_version', { simplify: true }) as number;

  if (currentVersion === SCHEMA_VERSION) return;

  if (currentVersion < 1) {
    // 初始建表（已在 initializeSchema 中处理）
  }

  if (currentVersion < 2) {
    // v2：chat_costs 新增 cached_read_tokens 字段
    try {
      db.exec(`ALTER TABLE chat_costs ADD COLUMN cached_read_tokens INTEGER DEFAULT 0`);
    } catch {
      // 字段已存在时 SQLite 会报错，忽略即可
    }
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
```

`initializeSchema` 末尾调用 `ensureSchemaVersion`，保证每次启动时自动处理存量库的 Schema 升级，无需手动干预。

---

## 五、MessageStore 的一个隐性设计问题

`SQLiteMessageStore.saveMessages()` 的语义是"全量替换"（先 DELETE 再 INSERT），这在当前对话规模下没有问题，但有一个值得注意的副作用：

每次对话结束保存消息，实际上是**把整个对话历史重写一遍**。如果一次对话有 200 条消息，每条消息的 `content` 字段是完整 JSON（包含工具调用结果），单次保存的写入量可能非常大。

这不是必须立刻解决的问题，但如果 `MessageStore` 接口要对外开放（允许用户自定义实现），需要在接口注释中明确说明这个语义，避免实现者误以为是增量追加：

```typescript
export interface MessageStore {
  /**
   * 保存对话的消息列表。
   *
   * **语义：全量替换**。此方法会删除该 conversationId 下的所有现有消息，
   * 然后重新写入传入的 messages 列表。
   * 不是增量追加——调用方需要传入完整的消息历史。
   *
   * 对于大型对话（100+ 消息），实现时建议在事务中执行以保证原子性。
   */
  saveMessages(conversationId: string, messages: UIMessage[]): void;

  getMessagesByConversation(conversationId: string): UIMessage[];
  getNextMessageOrder(conversationId: string): number;
}
```

如果未来有性能需求，可以新增 `appendMessage(conversationId, message)` 方法作为可选的增量写入路径，而不破坏现有接口。

---

## 六、改造前后对比

| 维度 | 现状 | 改造后 |
|------|------|--------|
| DataStore 获取方式 | `getGlobalDataStore()`（隐式全局单例） | 从 `CoreRuntime.dataStore` 显式取用 |
| 初始化顺序保障 | `console.warn` + 文档约定 | 类型系统强制（无 `CoreRuntime` 则无 `DataStore`） |
| Schema 初始化 | 分散：主表在构造时，`chat_costs` 在首次调用时 | 统一：所有表在 `SQLiteDataStore` 构造时一次性初始化 |
| 跨 Store 事务 | 通过 `getRawDb()` 漏底层连接 | `dataStore.transaction()` 统一入口 |
| 测试隔离 | `resetGlobalDataStore()` 补丁 | 构造时注入，天然隔离 |
| Schema 版本管理 | 无 | `user_version` pragma 记录，支持增量升级 |
| `native-loader.ts` 位置 | `src/` 根目录（全包可见） | `sqlite/` 内部（实现细节隔离） |

---

## 七、迁移路径

迁移可以分两个阶段，每个阶段独立合并：

**阶段一（不改接口，只修复 Schema 和文件位置）**

- 把 `chat_costs` DDL 移入 `initializeSchema`，删除 `CostStore.ensureSchema()` 方法
- 把 `native-loader.ts` 移入 `sqlite/` 目录
- 在 `MessageStore.saveMessages` 注释中补充"全量替换"说明
- 在 `DataStore` 接口上新增 `transaction()` 方法

这个阶段不改调用方代码，风险极低。

**阶段二（与 `bootstrap()` 重构协同）**

- 引入 `CoreRuntime`，`DataStore` 改为由 `bootstrap()` 创建并持有
- `runtime/` 层各模块改为接受注入的 `DataStore` 子 Store，移除 `getGlobalDataStore()` 调用
- `store.ts` 中的全局单例 API 标记 `@deprecated`，保留一个 release 后再删除
- 测试改为用 `createInMemoryDataStore()` 构造隔离实例，移除 `resetGlobalDataStore()` 调用
