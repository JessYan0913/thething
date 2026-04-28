# `packages/core` 重设计方案

> 基于第一性原理的 `@the-thing/core` API 层优化设计

---

## 一、问题诊断

在深入阅读现有代码后，核心问题可以归纳为以下四条：

### 问题 1：`createAgent` 是未完成的抽象

`api/app/create.ts` 中 `createAgent` 通过动态 `import` 调用内部的 `createChatAgent`，且注释明确标注"暂时"。这导致：

- `createContext()` 加载的 `AppContext` 在 `createAgent` 内被完全忽略
- 两套独立的配置加载路径并存（`loadAll` 各走各的）
- `CreateAgentOptions.context` 字段接受参数但从不消费

```typescript
// 当前现状：context 被接受但被忽略
export async function createAgent(options?: CreateAgentOptions) {
  const cwd = options?.cwd ?? detectProjectDir();
  // options.context 被丢弃，内部重新走 loadAll
  const result = await createChatAgent({ ... });
}
```

**第一性原理判断**：如果 `AppContext` 是正确抽象，它就应该是数据流的单一入口，而不是可选的旁路。

---

### 问题 2：`initAll` 与 `createAgent` 存在隐式顺序依赖

调用方必须记住先 `initAll` 再 `createAgent`，但这个约束没有任何类型系统保障：

```typescript
// 当前：调用方需要自己知道顺序
await initAll({ dataDir: './data' });           // 必须先调用
const agent = await createAgent({ cwd });        // 但类型上看不出来
```

`initAll` 初始化的是全局可变状态（`configureDataStore`、`initPermissions`、`initConnectorGateway`），`createAgent` 隐式依赖这些状态，但签名上毫无体现。

**第一性原理判断**：依赖应该显式，不应该通过全局状态隐式传递。

---

### 问题 3：`detectProjectDir` 污染了纯函数层

`foundation/paths/compute.ts` 中的路径计算函数混入了 monorepo 感知逻辑：

```typescript
export function detectProjectDir(): string {
  const cwd = process.cwd();
  // 硬编码 monorepo 路径检测 —— 这是环境感知，不是路径计算
  if (cwd.includes('packages/server') || cwd.includes('packages/cli')) {
    let dir = cwd;
    while (dir.includes('packages')) { dir = path.dirname(dir); }
    return dir;
  }
  return cwd;
}
```

`foundation` 层应该是纯函数：给定输入，返回输出，不读取进程状态，不感知部署拓扑。

**第一性原理判断**：抽象层级违反了"越底层越纯粹"的原则。环境感知属于应用层，不属于基础设施层。

---

### 问题 4：`CreateAgentResult` 类型契约不完整

```typescript
export interface CreateAgentResult {
  agent: unknown;           // ToolLoopAgent，但调用方无法使用
  sessionState: unknown;    // SessionState，但调用方无法使用
  tools: Record<string, unknown>;
  model: unknown;
}
```

接口声明了存在，但没有声明语义。调用方必须自己强制类型转换，等于放弃了 TypeScript 的核心价值。

---

## 二、设计目标

重新从第一性原理出发，确定 `core` 包对外 API 应该满足的约束：

1. **一个用户意图，一个调用入口**：创建 Agent 是一个意图，不应该拆成 `initAll + createContext + createAgent` 三步
2. **依赖显式化**：如果 A 依赖 B，B 应该出现在 A 的参数类型里，而不是隐藏在全局状态中
3. **基础层纯函数化**：`foundation` 中的函数只接受参数，不读取进程状态，不产生副作用
4. **类型契约完整**：公开 API 的返回值类型应该完整描述调用方能做什么
5. **渐进式使用**：简单场景一行代码，复杂场景每一步都可精细控制

---

## 三、新 API 设计

### 3.1 整体结构

```
packages/core/src/
├── index.ts                    # 公开 API 唯一出口
├── bootstrap.ts                # 新增：显式初始化，返回 CoreRuntime
├── config/
│   ├── defaults.ts             # 保持不变：集中常量
│   └── types.ts                # 优化：收紧类型定义
├── foundation/                 # 基础层：纯函数，无副作用
│   ├── paths/
│   │   ├── compute.ts          # 优化：移除 monorepo 感知
│   │   └── resolve.ts          # 新增：环境感知逻辑移至此处（仍是 foundation）
│   ├── parser/
│   ├── scanner/
│   ├── datastore/
│   └── model/
├── extensions/                 # 扩展层：保持不变
├── runtime/                    # 运行时层：保持不变
└── api/
    ├── context.ts              # 优化：createContext 消费 CoreRuntime
    ├── agent.ts                # 重写：createAgent 消费 AppContext
    └── loaders/                # 保持不变
```

---

### 3.2 核心类型重设计

#### `CoreRuntime`：显式初始化结果

```typescript
// bootstrap.ts

/**
 * 核心运行时句柄。
 * 通过 bootstrap() 创建，代表"已就绪的基础设施"。
 * AppContext 和 Agent 的创建都依赖此对象。
 */
export interface CoreRuntime {
  readonly dataDir: string;
  readonly dataStore: DataStore;
  readonly connectorGateway: ConnectorGateway;
  /** 销毁所有资源（关闭数据库连接、停止 gateway 等） */
  dispose(): Promise<void>;
}

export interface BootstrapOptions {
  dataDir: string;
  databaseConfig?: SQLiteDataStoreConfig;
  connectorConfig?: ConnectorGatewayConfig;
}

/**
 * 初始化核心基础设施，返回运行时句柄。
 *
 * 这是使用 core 包的强制第一步。
 * 所有后续操作（createContext、createAgent）都以此为入参，
 * 确保依赖显式、顺序可推断。
 *
 * @example
 * const runtime = await bootstrap({ dataDir: './data' });
 * const context = await createContext({ runtime, cwd });
 * const { agent } = await createAgent({ context });
 * // ...
 * await runtime.dispose();
 */
export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  const dataStore = createSQLiteDataStore({
    dataDir: options.dataDir,
    ...options.databaseConfig,
  });

  const connectorGateway = await initConnectorGateway({
    enableInbound: true,
    ...options.connectorConfig,
  });

  return {
    dataDir: options.dataDir,
    dataStore,
    connectorGateway,
    async dispose() {
      await connectorGateway.shutdown();
      dataStore.close?.();
    },
  };
}
```

---

#### `AppContext`：完整的配置快照

```typescript
// api/context.ts

export interface AppContext {
  /** 绑定此 context 的运行时，提供数据存储等基础设施 */
  readonly runtime: CoreRuntime;
  /** 项目工作目录（资源目录的计算基准） */
  readonly cwd: string;

  // 加载结果（只读快照）
  readonly skills: readonly Skill[];
  readonly agents: readonly AgentDefinition[];
  readonly mcps: readonly McpServerConfig[];
  readonly connectors: readonly ConnectorDefinition[];
  readonly permissions: readonly PermissionRule[];
  readonly memory: readonly MemoryEntry[];

  /** 每个资源的来源信息（用于调试/日志） */
  readonly sources: ContextSources;

  /**
   * 重新加载所有资源，返回新的 AppContext 快照。
   * 原 context 实例保持不变（不可变设计）。
   */
  reload(options?: ReloadOptions): Promise<AppContext>;
}

export interface CreateContextOptions {
  runtime: CoreRuntime;         // 显式依赖，必填
  cwd: string;                  // 项目目录，必填（不再自动检测）
  verbose?: boolean;
  onLoad?: (event: LoadEvent) => void;
}

export async function createContext(options: CreateContextOptions): Promise<AppContext> {
  const { runtime, cwd } = options;
  const loaded = await loadAll({ cwd });

  return Object.freeze({
    runtime,
    cwd,
    skills: Object.freeze(loaded.skills),
    agents: Object.freeze(loaded.agents),
    mcps: Object.freeze(loaded.mcps),
    connectors: Object.freeze(loaded.connectors),
    permissions: Object.freeze(loaded.permissions),
    memory: Object.freeze(loaded.memory),
    sources: buildSources(cwd, loaded),
    async reload(reloadOptions) {
      return createContext({ ...options, ...reloadOptions });
    },
  });
}
```

---

#### `AgentHandle`：完整类型的 Agent 句柄

```typescript
// api/agent.ts

import type { ToolLoopAgent } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

/**
 * Agent 句柄。包含发起对话所需的全部类型化引用。
 * 通过 createAgent() 获得，生命周期绑定到一次对话。
 */
export interface AgentHandle {
  /** Vercel AI SDK ToolLoopAgent 实例，可直接调用 streamText/generateText */
  agent: ToolLoopAgent;
  /** 当前会话状态（预算、活跃技能、否决计数等） */
  sessionState: SessionState;
  /** 已注册的 MCP 注册表，对话结束后调用 disconnectAll() */
  mcpRegistry: McpRegistry | null;
  /** 当前对话可用的工具集（已应用权限过滤） */
  tools: ToolSet;
  /** 注入到 system prompt 的完整指令字符串 */
  instructions: string;
  /**
   * 经过预算检查和附件注入后的消息列表。
   * 调用 agent.stream() 时传入此列表，而非原始 messages。
   */
  adjustedMessages: UIMessage[];
  /** 底层模型实例（未包装 middleware），供后台任务使用 */
  model: LanguageModelV3;
}

export interface CreateAgentOptions {
  /**
   * 必须提供 context（已加载配置快照），
   * 或同时提供 runtime + cwd（内部自动创建 context）。
   */
  context: AppContext;

  conversationId: string;
  messages?: UIMessage[];
  userId?: string;

  model: ModelConfig;          // 必填，不再从环境变量隐式读取

  session?: SessionOverrides;
  modules?: ModuleToggles;
  writerRef?: AgentWriterRef;
}

export interface ModelConfig {
  apiKey: string;
  baseURL: string;
  modelName: string;
  includeUsage?: boolean;
}

/**
 * 创建 Agent。消费 AppContext，不再内部重新加载资源。
 *
 * 设计约束：
 * - 不读取 process.env（由调用方在 model 参数中显式提供）
 * - 不调用 loadAll（资源已在 context 中）
 * - 不修改全局状态
 */
export async function createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
  const { context, model, conversationId, messages = [], userId = 'default' } = options;

  // 直接从 context 取数据，不重复加载
  const { skills, mcps, memory, permissions, agents } = context;

  // 创建会话状态
  const sessionState = createSessionState(conversationId, {
    maxContextTokens: options.session?.maxContextTokens,
    maxBudgetUsd: options.session?.maxBudgetUsd,
    compactThreshold: options.session?.compactThreshold,
    model: model.modelName,
    projectDir: context.cwd,
  });

  // 技能附件注入
  const { messages: messagesWithAttachments } = await injectMessageAttachments(messages, {
    sessionKey: conversationId,
    skills,
    contextWindowTokens: options.session?.maxContextTokens ?? DEFAULT_CONTEXT_LIMIT,
  });

  // 加载工具
  const modelInstance = createLanguageModel(model);
  const wrappedModel = wrapLanguageModel({
    model: modelInstance,
    middleware: [telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
  });

  const { tools, mcpRegistry } = await loadAllTools({
    conversationId,
    sessionState,
    enableMcp: options.modules?.mcps ?? true,
    enableConnector: options.modules?.connectors ?? true,
    writerRef: options.writerRef,
    model: wrappedModel,
    provider: createModelProvider(model),
  });

  // 构建指令
  const [skillResolution, memoryContext, projectContext] = await Promise.all([
    resolveActiveSkills(messagesWithAttachments, skills),
    loadMemoryContext(messagesWithAttachments, userId, context.cwd),
    loadProjectContext(context.cwd),
  ]);

  const instructions = buildAgentInstructions({
    cwd: context.cwd,
    skills,
    permissions,
    memoryEntries: memory,
    projectContext,
    skillResolution,
    memoryContext,
  });

  // 预算检查
  const budgetCheck = await checkInitialBudget(
    messagesWithAttachments, instructions, tools, model.modelName, conversationId
  );

  const agent = new ToolLoopAgent({
    model: wrappedModel,
    instructions,
    tools: budgetCheck.adjustedTools ?? tools,
    prepareStep: createAgentPipeline({ sessionState, maxSteps: 50, maxBudgetUsd: 5.0 }),
    stopWhen: createDefaultStopConditions(sessionState.costTracker, {
      maxSteps: 50,
      denialTracker: sessionState.denialTracker,
      sessionState,
    }),
    toolChoice: 'auto',
  });

  return {
    agent,
    sessionState,
    mcpRegistry: mcpRegistry ?? null,
    tools: budgetCheck.adjustedTools ?? tools,
    instructions,
    adjustedMessages: budgetCheck.adjustedMessages ?? messagesWithAttachments,
    model: modelInstance,
  };
}
```

---

### 3.3 `foundation/paths` 纯函数化

将 monorepo 感知逻辑移出纯函数层，路径计算只做路径计算：

```typescript
// foundation/paths/compute.ts（精简后）

/**
 * 计算用户全局配置目录（纯函数）。
 */
export function getUserConfigDir(homeDir: string, subdir?: string): string {
  return subdir
    ? path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir)
    : path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME);
}

/**
 * 计算项目级配置目录（纯函数）。
 */
export function getProjectConfigDir(cwd: string, subdir?: string): string {
  return subdir
    ? path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir)
    : path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME);
}

/**
 * 计算用户全局 Tokenizer 缓存目录（纯函数）。
 */
export function getUserTokenizerCacheDir(homeDir: string, subdir?: string): string {
  const base = path.join(homeDir, '.cache', 'thething', TOKENIZER_CACHE_DIR_NAME);
  return subdir ? path.join(base, subdir) : base;
}
```

```typescript
// foundation/paths/resolve.ts（新增：环境感知，允许读取进程状态）

/**
 * 检测项目根目录。
 *
 * 此函数允许读取 process.cwd()，因为它的职责就是解析当前环境。
 * 但 monorepo 感知逻辑应通过可配置的 patterns 参数注入，
 * 而不是硬编码 'packages/server' 字符串。
 */
export function resolveProjectDir(options?: {
  cwd?: string;
  /**
   * 触发向上查找的路径片段。
   * 当 cwd 包含这些片段之一时，向上查找直到不包含为止。
   * 默认值由应用层（CLI/Server）注入，core 包不硬编码。
   */
  monorepoPatterns?: string[];
}): string {
  const cwd = options?.cwd ?? process.cwd();
  const patterns = options?.monorepoPatterns ?? [];

  if (patterns.length === 0) return cwd;

  const matches = patterns.some(p => cwd.includes(p));
  if (!matches) return cwd;

  let dir = cwd;
  while (patterns.some(p => dir.includes(p))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/**
 * 获取系统 home 目录（允许环境感知）。
 */
export function resolveHomeDir(): string {
  return os.homedir();
}
```

应用层（`packages/cli`、`packages/server`）调用时注入 patterns：

```typescript
// packages/cli/src/bootstrap.ts
import { resolveProjectDir } from '@the-thing/core/foundation/paths';

const cwd = resolveProjectDir({
  monorepoPatterns: ['packages/server', 'packages/cli'],
});
```

---

### 3.4 资源目录配置方式统一

现有目录配置分散在 `defaults.ts` 常量、`paths/compute.ts` 函数和各 loader 的默认参数中，三处各管一段。

重设计后，引入 `ResourceLayout` 类型，让资源目录成为 `AppContext` 的显式组成部分：

```typescript
// config/types.ts

/**
 * 描述所有资源文件的目录布局。
 * 一旦确定，在 AppContext 生命周期内不变。
 */
export interface ResourceLayout {
  skills: string[];       // 可多目录（用户级 + 项目级）
  agents: string[];
  mcps: string[];
  connectors: string[];
  permissions: string[];
  memory: string[];
}

/**
 * 根据 cwd 和 homeDir 计算默认的资源目录布局。
 * 这是一个纯函数，可测试，可 mock。
 */
export function buildDefaultResourceLayout(cwd: string, homeDir: string): ResourceLayout {
  return {
    skills: [
      getUserConfigDir(homeDir, 'skills'),    // 用户全局
      getProjectConfigDir(cwd, 'skills'),     // 项目级
    ],
    agents: [
      getUserConfigDir(homeDir, 'agents'),
      getProjectConfigDir(cwd, 'agents'),
    ],
    mcps: [
      getUserConfigDir(homeDir, 'mcps'),
      getProjectConfigDir(cwd, 'mcps'),
    ],
    connectors: [
      getProjectConfigDir(cwd, 'connectors'),
    ],
    permissions: [
      getUserConfigDir(homeDir, 'permissions'),
      getProjectConfigDir(cwd, 'permissions'),
    ],
    memory: [
      getProjectConfigDir(cwd, 'memory'),
    ],
  };
}
```

`createContext` 接受可选的 `layout` 参数，允许完全自定义目录：

```typescript
export interface CreateContextOptions {
  runtime: CoreRuntime;
  cwd: string;
  /**
   * 自定义资源目录布局。
   * 不提供时使用 buildDefaultResourceLayout(cwd, homeDir) 的结果。
   */
  layout?: Partial<ResourceLayout>;
}
```

---

## 四、完整使用流程对比

### 当前使用方式

```typescript
// 1. 需要记住先调用 initAll（全局副作用，顺序依赖）
await initAll({ dataDir: './data' });

// 2. createContext 加载配置（但 createAgent 不用它）
const context = await createContext({ cwd });

// 3. createAgent 内部重新走 loadAll（忽略了上面的 context）
const { agent, sessionState } = await createAgent({ cwd });

// 调用方看不出这三步之间的依赖关系
```

### 重设计后的使用方式

#### 最简场景（一步完成）

```typescript
import { bootstrap, createContext, createAgent } from '@the-thing/core';

// 三步，每步的输入输出关系一目了然
const runtime = await bootstrap({ dataDir: './data' });
const context = await createContext({ runtime, cwd: process.cwd() });
const { agent, adjustedMessages } = await createAgent({
  context,
  conversationId: 'conv-1',
  messages,
  model: {
    apiKey: process.env.API_KEY!,
    baseURL: process.env.BASE_URL!,
    modelName: 'qwen-max',
  },
});

// 使用 agent
const stream = await createAgentUIStream({
  agent,
  uiMessages: adjustedMessages,
  onFinish: async () => {
    await context.runtime.dataStore.messageStore.saveMessages('conv-1', messages);
    await agent.mcpRegistry?.disconnectAll();
  },
});

// 应用退出时清理
await runtime.dispose();
```

#### 精细控制场景

```typescript
// 自定义资源目录
const context = await createContext({
  runtime,
  cwd,
  layout: {
    skills: ['/shared/skills', path.join(cwd, '.thething/skills')],
  },
});

// 监听加载事件
const context = await createContext({
  runtime,
  cwd,
  onLoad: (event) => {
    logger.info(`Loaded ${event.count} ${event.module} from ${event.path}`);
  },
});

// 热重载配置（不重启 runtime）
const newContext = await context.reload();
const newHandle = await createAgent({ context: newContext, ... });
```

#### CLI/Server 应用层处理 monorepo 路径

```typescript
// packages/cli/src/main.ts
import { resolveProjectDir } from '@the-thing/core/foundation/paths';
import { bootstrap, createContext } from '@the-thing/core';

const cwd = resolveProjectDir({
  monorepoPatterns: ['packages/server', 'packages/cli'],
});

const runtime = await bootstrap({ dataDir: path.join(cwd, '.data') });
const context = await createContext({ runtime, cwd });
```

---

## 五、迁移策略

重设计的 API 与现有代码不兼容，但可以分三个阶段渐进迁移，每个阶段保持可运行：

### 第一阶段：稳定 `foundation` 层（无 breaking change）

目标：把 `detectProjectDir` 的 monorepo 感知逻辑提取为可参数化形式，保留原函数作为向后兼容别名。

```typescript
// 新增纯函数（立即可用）
export function resolveProjectDir(options?: { monorepoPatterns?: string[] }): string { ... }

// 保留原函数作为别名（向后兼容）
/** @deprecated 使用 resolveProjectDir({ monorepoPatterns: [...] }) 替代 */
export function detectProjectDir(): string {
  return resolveProjectDir({
    monorepoPatterns: ['packages/server', 'packages/cli'],
  });
}
```

### 第二阶段：引入 `bootstrap` + 修复 `createAgent` 消费 `AppContext`

核心改动：让 `createAgent` 真正消费传入的 `context`，消除内部的重复 `loadAll` 调用。

```typescript
// runtime/agent/create.ts 中，增加对 preloadedData 的支持
export async function createChatAgent(config: CreateAgentConfig): Promise<CreateAgentResult> {
  const loadedData = config.preloadedData  // 新增：优先使用预加载数据
    ?? await loadAll({ cwd: config.sessionOptions?.projectDir });
  // ...其余逻辑不变
}
```

`api/app/create.ts` 中的 `createAgent` 改为传递 `context` 中的数据：

```typescript
export async function createAgent(options: CreateAgentOptions): Promise<CreateAgentResult> {
  const ctx = options.context ?? await createContext({
    runtime: options.runtime!,
    cwd: options.cwd ?? resolveProjectDir(),
  });

  return createChatAgent({
    ...convertOptions(options),
    preloadedData: {  // 直接传递，不重复加载
      skills: ctx.skills,
      agents: ctx.agents,
      mcps: ctx.mcps,
      connectors: ctx.connectors,
      permissions: ctx.permissions,
      memory: ctx.memory,
    },
  });
}
```

### 第三阶段：完整类型收紧 + `ResourceLayout` 引入

- 用实际类型替换 `CreateAgentResult` 中的 `unknown`
- 引入 `ResourceLayout` 并在 `AppContext` 中暴露
- 将 `initAll` 标记为 `@deprecated`，引导使用 `bootstrap`

---

## 六、各模块职责边界总结

| 层次 | 职责 | 不该做的事 |
|------|------|-----------|
| `foundation/paths` | 根据输入参数计算路径字符串 | 读取 `process.cwd()`，感知 monorepo 结构 |
| `foundation/paths/resolve` | 读取进程环境，解析实际路径 | 业务逻辑，资源加载 |
| `foundation/datastore` | 数据持久化抽象 | 感知 agent 业务逻辑 |
| `extensions/*` | 单一扩展点的加载与解析 | 跨模块编排 |
| `runtime/*` | Agent 执行循环，会话状态管理 | 文件系统扫描，配置加载 |
| `api/loaders` | 并行加载各类资源文件 | 初始化全局状态 |
| `api/context` | 将加载结果组装为不可变快照 | 发起网络请求，修改全局状态 |
| `api/agent` | 消费 AppContext 创建 Agent | 重新加载资源，读取环境变量 |
| `bootstrap` | 初始化全局基础设施，返回句柄 | 加载业务资源（skills、mcps 等） |
| `config/defaults` | 集中定义常量 | 读取环境变量，实例化对象 |

---

## 七、设计决策备忘

**为什么 `model` 在 `createAgent` 中是必填参数，不再从 `process.env` 读取？**

`core` 包是库，不是应用。库不应该假设环境变量的存在。`DASHSCOPE_API_KEY` 这类变量由应用层（CLI/Server）管理，通过参数显式传入 `core`。这样 `core` 在任何运行环境（测试、edge function、不同云厂商）下都可预测。

**为什么 `AppContext` 是不可变快照，而不是带有 `refresh` 方法的响应式对象？**

响应式对象在多轮对话场景下会带来竞态问题（一轮对话途中 skills 更新了怎么办？）。快照语义更简单：一轮对话绑定一个 `AppContext`，如果需要更新，下一轮对话用新的 `AppContext`。`reload()` 方法返回新实例，旧实例不变，调用方自己决定何时切换。

**为什么不把三步合并成一个 `createAgentFromScratch(options)` 的便捷函数？**

可以提供，作为高层糖衣，但不应该是唯一入口。`runtime`、`context`、`handle` 三个对象的生命周期是不同的：`runtime` 跟随应用进程，`context` 跟随配置变更，`handle` 跟随一次对话。合并成一个函数会隐藏这三个维度，导致下一个开发者再次遇到"为什么 skills 没有热更新"或"为什么数据库连接泄漏"的问题。
