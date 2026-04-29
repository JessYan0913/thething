# `packages/core` 补充设计分析

> 对前两篇文档未覆盖模块的完整审查

---

## 一、`export * from './foundation'` — 边界失控

这是目前最值得重视、但最容易被忽视的问题。

`src/index.ts` 里有这四行：

```typescript
export * from './foundation';
export * from './runtime';
export * from './extensions';
export * from './api';
```

每一行都是无条件的全量重导出。以 `foundation` 为例，这意味着以下内容全部成为 `@the-thing/core` 的公开 API：

- `SqliteDatabase`、`SqliteStatement`、`SqliteDatabaseConstructor`（SQLite 内部接口）
- `SqliteDatabaseOptions`（better-sqlite3 配置细节）
- `loadBetterSqlite3()`、`getDatabase()`（SEA 加载器，native-loader 的实现细节）
- `ConversationRow`、`MessageRow`、`SummaryRow`、`CostRow`（ORM 内部行映射类型）
- `initializeSchema()`（数据库 Schema 初始化，不应该暴露给调用方）

`loadBetterSqlite3` 甚至在 `index.ts` 里被显式地单独再导出了一次——这说明有人知道它会被外部用到，但这正是问题所在：一个专门为 SEA 打包场景做的原生模块加载器，不应该成为核心包的公开接口。

**第一性原理判断**：公开 API 是一个承诺。一旦导出，调用方就可以依赖它，你就无法在不造成 breaking change 的情况下修改它。`export *` 把所有内部实现细节都变成了对外承诺。

**具体建议**：将 `index.ts` 改为显式导出，只暴露调用方真正需要的类型和函数：

```typescript
// index.ts（改造后）：显式声明每一个公开契约

// 高层 API
export { createAgent, createContext } from './api/app';
export { initAll } from './init';

// 类型
export type { AppContext, CreateAgentOptions, AgentHandle } from './api/app/types';
export type { DataStore, ConversationStore, MessageStore, SummaryStore, CostStore } from './foundation/datastore/types';
export type { Skill, SkillMetadata } from './extensions/skills/types';
export type { McpServerConfig } from './extensions/mcp/types';
// ... 其他真正需要公开的类型

// DataStore 工厂（允许自定义实现）
export { createSQLiteDataStore } from './foundation/datastore/sqlite';

// 不再导出：SqliteDatabase、ConversationRow、initializeSchema、loadBetterSqlite3 等内部实现
```

---

## 二、`runtime/tasks` — 生命周期与存储的双重问题

`InMemoryTaskStore` 是一个设计比较有意思的模块，实现了带双向依赖链（`blockedBy` / `blocks`）的任务调度器，逻辑完整，状态机清晰。但有两个具体问题：

### 问题 2a：`getGlobalHighWaterMark()` 和 `getGlobalTaskStore()` 复制了全局单例模式

```typescript
// tasks/store.ts
let globalTaskStore: TaskStore | null = null;

export function getGlobalTaskStore(): TaskStore {
  if (!globalTaskStore) {
    globalTaskStore = createTaskStore();  // 内部创建，用全局 HWM
  }
  return globalTaskStore;
}
```

`TaskStore` 和 `HighWaterMark` 各自维护了一个全局单例，这与 `DataStore` 的全局单例问题完全平行。任务是会话级的概念，但存储却是进程级的单例，这意味着：不同对话的任务混在同一个 `InMemoryTaskStore` 里，只靠 `conversationId` 字段区分，而不是物理隔离。

### 问题 2b：`InMemoryTaskStore` 在进程重启后丢失所有任务

任务系统支持后台 Agent（`background: true`），如果进程崩溃或重启，所有未完成的任务状态全部消失。对于长时运行的后台任务，这是一个数据丢失风险。

`HighWaterMark` 也只在内存中单调递增，重启后从 1 重新开始，可能与历史任务 ID 冲突。

**建议**：`TaskStore` 应该与 `DataStore` 整合，将任务状态持久化到 `chat_costs` 同级的 `tasks` 表。`HighWaterMark` 的当前值可以用 SQLite 的 `AUTOINCREMENT` 来承接，而不是内存计数器。

```typescript
// 在 DataStore 接口中新增
export interface DataStore {
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  summaryStore: SummaryStore;
  costStore: CostStore;
  taskStore: TaskStore;     // 新增：任务存储
  transaction<T>(fn: () => T): T;
  close(): void;
  isConnected(): boolean;
}
```

如果不想立刻整合，至少应该让 `TaskStore` 的生命周期绑定到 `AgentHandle`，而不是进程级全局单例：一个 `AgentHandle` 对应一个 `TaskStore` 实例，对话结束时随之销毁。

---

## 三、`runtime/budget/tool-result-storage.ts` — 清理责任模糊

`tool-result-storage.ts` 把大工具输出持久化到 `.thething/tool-results/{sessionId}/` 目录，设计本身合理（避免超大工具结果撑爆上下文窗口）。但有一个生命周期问题：

`cleanupSessionToolResults()` 函数存在，但没有任何地方强制调用它。文档注释写的是"在会话结束时调用"，但"会话结束"是一个隐式事件——`AgentHandle` 没有 `dispose()` 方法，调用方不知道"何时"以及"该不该"清理。

同时 `cleanupOldToolResults()` 提供了按天数清理的能力，但没有任何定时触发机制，也没有在 `initAll` 里被调用。结果是工具结果文件只增不减，除非调用方主动调用这两个函数（而调用方大概率不会）。

**建议**：将清理职责归入 `AgentHandle.dispose()`，确保清理行为有且仅有一个明确的触发点：

```typescript
export interface AgentHandle {
  agent: ToolLoopAgent;
  sessionState: SessionState;
  mcpRegistry: McpRegistry | null;
  // ...

  /**
   * 释放此 AgentHandle 占用的所有资源：
   * - 断开 MCP 连接
   * - 清理本次会话的工具结果缓存文件
   * - 标记 sessionState 为已完成
   *
   * 对话结束后（onFinish 回调中）必须调用此方法。
   */
  dispose(): Promise<void>;
}
```

---

## 四、`extensions/connector/credentials/store.ts` — 密钥管理的安全隐患

`CredentialStore` 使用 AES-256-GCM 加密存储 Connector 凭证，方向正确。但有一个安全问题：

```typescript
// credentials/store.ts
constructor(options?: CredentialStoreOptions) {
  const key = options?.encryptionKey || process.env.CONNECTOR_ENCRYPTION_KEY || ''
  if (key.length < 32) {
    // 如果密钥不足 32 字节，使用派生密钥
    this.encryptionKey = crypto.createHash('sha256').update(key).digest()
  }
}
```

当 `key` 为空字符串（即 `CONNECTOR_ENCRYPTION_KEY` 未设置时），`crypto.createHash('sha256').update('').digest()` 产生的是一个固定、可预测的密钥：`e3b0c44298fc1c149afb...`（空串的 SHA-256）。这等于用一个公开已知的密钥加密数据，AES-256-GCM 的安全性完全失效。

正确处理应该是：密钥未配置时明确报错或降级为不加密（明文+警告），而不是静默使用固定密钥：

```typescript
constructor(options?: CredentialStoreOptions) {
  const key = options?.encryptionKey ?? process.env.CONNECTOR_ENCRYPTION_KEY;

  if (!key) {
    // 选项 A：禁止初始化（推荐用于生产）
    throw new Error(
      '[CredentialStore] Encryption key is required. ' +
      'Set CONNECTOR_ENCRYPTION_KEY environment variable or pass encryptionKey option.'
    );
    // 选项 B：降级为明文模式，输出警告（适合开发环境）
    // console.warn('[CredentialStore] No encryption key provided. Credentials will be stored in plaintext.');
    // this.mode = 'plaintext';
  }

  this.encryptionKey = key.length < 32
    ? crypto.scryptSync(key, 'thething-cred-salt', 32)  // 用 scrypt 而非 SHA-256，更安全
    : Buffer.from(key.substring(0, 32), 'utf-8');
}
```

另外，密钥派生用 `SHA-256` 是不合适的——SHA-256 是高速哈希，设计目的是快速，而密钥派生需要慢速（抵抗暴力破解）。应该用 `crypto.scryptSync` 或 `crypto.pbkdf2Sync`。

---

## 五、`extensions/memory` — 两套记忆存储并存，边界模糊

Memory 系统由两部分组成：

1. **文件系统记忆**（`extensions/memory/`）：扫描 `.thething/memory/` 目录下的 `.md` 文件，由 Agent 在对话中主动写入
2. **数据库摘要**（`runtime/compaction/`）：把长对话压缩成摘要，存入 SQLite 的 `summaries` 表

这两套机制服务于不同目的，但在系统提示构建（`extensions/system-prompt/sections/memory.ts`）中被混合在一起注入，调用方（甚至 Agent 本身）很难区分哪些记忆来自哪里、置信度如何、是否过期。

更具体的问题：`memory/usage-tracker.ts` 用文件系统维护记忆的使用频率衰减分数，而 `memory/memory-age.ts` 判断记忆是否过期。这两个模块都有自己的内部状态，但都没有被注入任何时钟抽象——直接调用 `Date.now()`，导致时间相关逻辑完全无法在测试中控制。

**建议**：在接口层区分两种记忆，并在系统提示中给 Agent 明确的元信息：

```typescript
// 区分记忆来源
interface MemoryContext {
  /** 用户主动写入的长期记忆（文件系统） */
  longTermMemories: Array<{ content: string; source: string; freshness: 'fresh' | 'stale' }>;
  /** 对话压缩摘要（数据库） */
  sessionSummary: string | null;
}
```

---

## 六、`runtime/compaction/background-queue.ts` — 模块级全局状态

```typescript
// background-queue.ts
const compactQueue = new Map<string, Promise<void>>();
```

这是一个模块级变量，进程内全局共享。在单进程模型下可以接受，但有一个隐患：如果同一个 `conversationId` 的后台压缩正在进行，新的请求会被静默跳过（`return`）。在并发场景下，这个"跳过"逻辑正确，但缺少可观测性——没有办法从外部查询某个对话的压缩状态，也没有办法等待一个进行中的压缩完成后再进行下一步操作。

`isCompactInProgress()` 和 `getQueueSize()` 提供了部分可观测性，但没有暴露在公开 API 里。对于需要"先确保压缩完成，再关闭数据库"的场景（比如优雅退出），现在无法做到。

**建议**：`getQueueSize()` 和等待所有进行中压缩完成的能力应该进入 `CoreRuntime.dispose()` 的关闭序列：

```typescript
// bootstrap.ts
export async function bootstrap(...): Promise<CoreRuntime> {
  // ...
  return {
    async dispose() {
      // 等待所有后台压缩完成，再关闭数据库
      await waitForAllCompactions();   // 内部调用 background-queue 的等待逻辑
      await connectorGateway.shutdown();
      dataStore.close();
    }
  };
}
```

---

## 七、`config/defaults.ts` — 定价数据不该在核心包里

```typescript
// runtime/session-state/cost.ts
const PRICING: Record<string, { input: number; output: number; cached: number }> = {
  'qwen-max': { input: 4, output: 12, cached: 1 },
  'qwen-plus': { input: 1.5, output: 4.5, cached: 0.5 },
  // ...
  'deepseek-v3': { input: 1.2, output: 4.8, cached: 0.4 },
};
```

这个定价表硬编码在 `core` 包内，问题有两个：

首先，模型定价会频繁变动，每次变动都需要发布新版本的 `@the-thing/core`。其次，这些定价是人民币/百万 token 的计费标准，而不同部署环境（自有 API、企业协议、代理商）的实际价格可能不同。

定价数据应该是可配置的，而不是硬编码的常量：

```typescript
// 改为通过 ModelConfig 或 bootstrap 注入
export interface ModelPricingConfig {
  /** 每百万 input token 的费用（USD） */
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

// bootstrap 接受可选的定价覆盖
export interface BootstrapOptions {
  dataDir: string;
  modelPricing?: Record<string, ModelPricingConfig>;
}
```

默认保留内置定价表作为兜底，但允许调用方在 `bootstrap` 时覆盖。

---

## 八、整体架构补充图

综合三篇文档的分析，完整的问题分布图：

```
src/
├── index.ts            ⚠️ export * 导致所有内部实现成为公开 API
├── native-loader.ts    ⚠️ 位置错误，应归入 foundation/datastore/sqlite/
├── init.ts             ⚠️ 已分析：initAll 与 createAgent 的隐式依赖
│
├── api/
│   └── app/
│       ├── create.ts   ⚠️ 已分析：createAgent 忽略传入的 context
│       └── types.ts    ⚠️ 已分析：CreateAgentResult 使用 unknown
│
├── config/
│   └── defaults.ts     ⚠️ 模型定价硬编码
│
├── foundation/
│   ├── paths/
│   │   └── compute.ts  ⚠️ 已分析：monorepo 感知污染纯函数层
│   └── datastore/
│       ├── store.ts     ⚠️ 已分析：全局单例反模式
│       └── sqlite/
│           ├── schema.ts       ⚠️ 已分析：CostStore Schema 初始化不一致
│           └── cost-store.ts   ⚠️ 已分析：ensureSchema 前置条件隐式
│
├── extensions/
│   ├── memory/
│   │   └── usage-tracker.ts  ⚠️ Date.now() 直调，时间不可测试
│   └── connector/
│       └── credentials/
│           └── store.ts       🔴 安全：空密钥时使用可预测的固定密钥
│
└── runtime/
    ├── tasks/
    │   ├── store.ts       ⚠️ 全局单例 + 任务不持久化
    │   └── high-water-mark.ts  ⚠️ 重启后 ID 从 1 重置
    ├── budget/
    │   └── tool-result-storage.ts  ⚠️ 清理职责无明确归属
    └── compaction/
        ├── background-queue.ts     ⚠️ 无法等待完成（优雅退出问题）
        └── session-memory-compact.ts  ⚠️ 已分析：getGlobalDataStore 隐式依赖
```

**严重程度分级：**
- 🔴 安全问题：`CredentialStore` 空密钥使用固定可预测密钥
- ⚠️ 架构问题：全局单例、隐式依赖、边界失控（需要在规模化前修复）
- 📝 质量问题：定价硬编码、清理职责模糊（可以渐进改善）

---

## 九、如果只能做一件事

优先级最高、收益最大的单点改造是：**修复 `createAgent` 真正消费 `AppContext`，顺带消除内部的重复 `loadAll` 调用**。

这一个改动会产生连锁正效应：
- `AppContext` 从摆设变为真正的数据流入口
- 两套加载路径合并为一套，资源加载次数减半
- `TaskStore`、`DataStore` 可以从 `AppContext` 流向 `AgentHandle`，为后续消除全局单例铺路
- `AgentHandle` 获得持有 `dispose()` 职责的天然时机

其他所有问题都可以在这个基础上逐步解决，而不需要大规模重写。
