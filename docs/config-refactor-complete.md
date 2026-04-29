# `packages/core` 配置重构：完整方案

> 基于第一性原理推导目标模型，结合当前代码状态给出具体实施步骤

---

## 一、配置的本质是什么

配置只有一个本质定义：

> **配置是调用方对系统行为做出的决策，而系统自身无法替调用方做出这个决策。**

从这个定义出发，可以派生出两条判断标准：

**标准 A — 可变性测试**：把这个值给两个不同的应用方，他们会给出不同答案吗？如果是，它是配置；如果答案唯一，它是实现细节或算法常量，不该暴露为配置。

**标准 B — 知识归属测试**：谁拥有做出这个决策所需的信息？如果是调用方（知道自己的业务场景），它是配置；如果是库本身（根据技术约束决定），它是内部常量。

用这两条标准扫描当前 `defaults.ts`，结果如下：

| 常量 | 可变性 | 知识归属 | 类型判断 |
|------|--------|---------|---------|
| `DEFAULT_PROJECT_CONFIG_DIR_NAME = '.thething'` | 应用方会改 | 调用方决定品牌名 | **配置** |
| `DEFAULT_MAX_BUDGET_USD = 5.0` | 会改（企业场景更高） | 调用方决定风险边界 | **配置** |
| `DEFAULT_AVAILABLE_MODELS = [qwen-*]` | 会改（其他模型商） | 调用方决定供应商 | **配置** |
| `MODEL_MAPPING = { fast: 'qwen-turbo' }` | 会改（和模型列表绑定） | 调用方决定快捷名映射 | **配置** |
| `COMPACT_TOKEN_THRESHOLD = 25_000` | 几乎不改 | 算法经验值，库知道 | **内部常量** |
| `BYTES_PER_TOKEN = 4` | 不改 | 统计物理值 | **内部常量** |
| `MAX_TOOL_RESULT_TOKENS = 100_000` | 不改 | 技术上限 | **内部常量** |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | 不改 | 工程经验值 | **内部常量** |
| `DEFAULT_SKILL_SCAN_DIRS` | 冗余（由 configDirName 派生） | — | **派生值，删除** |
| `DEFAULT_MCP_CONFIG_DIR` | 冗余（由 configDirName 派生） | — | **派生值，删除** |

**当前问题**：`defaults.ts` 把配置、内部常量、派生值三类东西混在一起，导致"什么可以被配置"这件事本身就不清晰。

---

## 二、当前代码的实际状态

### 已实施的改进

前几轮设计讨论提出的问题，部分已经实施：

- `foundation/paths/compute.ts`：路径计算函数已分离为纯函数版本（`compute*` 前缀）和便捷版本
- `foundation/paths/resolve.ts`：`resolveProjectDir` 已支持 `monorepoPatterns` 参数注入
- `config/layout.ts`：`ResourceLayout` 和 `buildDefaultResourceLayout` 已存在
- `bootstrap.ts`：已引入，`CoreRuntime` 已持有 `dataStore`、`connectorRegistry`、`cwd`
- `api/app/context.ts`：`createContext` 已消费 `CoreRuntime`，不再重复加载
- `api/app/create.ts`：`createAgent` 已通过 `preloadedData` 消费 `AppContext` 的数据
- `foundation/model/pricing.ts`：定价模块已独立，`bootstrap` 支持 `modelPricing` 注入

### 仍然存在的三处问题

问题相互关联，核心是配置没有完整地流进调用链：

```
bootstrap(options)
  ├── options.dataDir        ✓ 进入了 CoreRuntime.dataDir
  ├── options.modelPricing   ✓ 进入了 pricing 模块
  ├── options.cwd            ✓ 进入了 CoreRuntime.cwd
  └── ??? configDirName      ✗ 没有入口，各模块直接读常量
  └── ??? behaviorConfig     ✗ 没有入口，agent 内部字面量

createContext(options)
  └── 用 CoreRuntime.cwd 计算路径 ✓
  └── 但路径计算仍用硬编码的 DEFAULT_PROJECT_CONFIG_DIR_NAME ✗

createAgent(options)
  └── 从 context 取 skills/mcps 等  ✓（preloadedData 已实现）
  └── maxSteps/maxBudget 用字面量   ✗
  └── availableModels 用字面量      ✗
```

#### 问题一：`DEFAULT_PROJECT_CONFIG_DIR_NAME` 被 15+ 处直接消费

纯函数虽然存在，但函数内部仍然硬编码引用这个常量：

```typescript
// 当前：configDirName 硬编码在函数实现里
export function computeProjectConfigDir(cwd: string, subdir?: string): string {
  return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir); // ← 取的是全局常量
}
```

同时，这 15+ 处仍然独立直接引用常量：

| 文件 | 说明 |
|------|------|
| `extensions/mcp/mcp-config-store.ts` | MCP 配置存储路径 |
| `extensions/memory/paths.ts` | 还有 `THETHING_MEMORY_DIR` 环境变量直读 |
| `extensions/permissions/loader.ts` | 权限加载路径 |
| `extensions/permissions/path-validation.ts` | 路径验证保护目录 |
| `extensions/system-prompt/sections/project-context.ts` | 项目上下文文件 |
| `extensions/connector/idempotency.ts` | Connector 幂等性数据库路径 |
| `runtime/budget/tool-result-storage.ts` | 工具结果存储路径（`THETHING_DIR` 常量） |
| `runtime/tools/skill.ts` | 向上搜索时硬编码目录名 |
| `extensions/subagents/agent-tool.ts` | Tool 描述文字硬编码 |

`ResourceLayout` 定义了正确的结构，但没有贯通到这些消费点。

#### 问题二：`runtime/agent/create.ts` 有三处硬编码

```typescript
// 第 83 行：sessionOptions 可能已有值，但 fallback 是字面量 5.0
maxBudgetUsd: sessionOptions?.maxBudgetUsd ?? 5.0

// 第 180-181 行：完全忽视调用方可能传入的 maxBudgetUsd，重新字面量赋值
const prepareStep = createAgentPipeline({ maxSteps: 50, maxBudgetUsd: 5.0 })

// 第 185 行：同上
const stopWhen = createDefaultStopConditions({ maxSteps: 50, ... })
```

后两处是直接覆盖——即使调用方在 `createAgent` 里传了 `session.maxBudgetUsd = 20`，`pipeline` 层仍会在 `5.0` 时停止。

#### 问题三：`session-state/state.ts` 的 `availableModels` 独立硬编码

```typescript
// 第 52-55 行：模型列表直接写死
availableModels: [
  { id: 'qwen-max', ... },
  { id: 'qwen-plus', ... },
  { id: 'qwen-turbo', ... },
],
```

这个值不来自 `DEFAULT_AVAILABLE_MODELS` 常量，也不来自调用方注入，是独立的第三份硬编码。应用方换模型商时，这里不会联动。

---

## 三、目标模型设计

基于第一性原理，配置系统应该分成**两个完全不同的对象**，分别对应两类不同的关注点。

### 3.1 `BehaviorConfig` — 运行时行为决策

这是真正意义上的"配置"：调用方根据自己的业务场景做出的决策。

```typescript
// src/config/behavior.ts

/**
 * 运行时行为配置。
 *
 * 这里的每一个字段都代表一个业务决策：
 * 调用方比 core 更了解自己的业务场景，
 * 所以这些值由调用方提供，core 只执行。
 *
 * 所有字段均有合理默认值，最简场景可以不传任何参数。
 */
export interface BehaviorConfig {

  // ── 会话控制 ──────────────────────────────────────────────

  /**
   * 单次对话的最大步骤数。
   * 防止 Agent 陷入无限循环。
   * @default 50
   */
  maxStepsPerSession: number;

  /**
   * 单次对话的最大费用上限（USD）。
   * 超出后 Agent 停止工具调用，返回当前进度。
   * @default 5.0
   */
  maxBudgetUsdPerSession: number;

  /**
   * 上下文窗口 Token 上限。
   * 接近此值时触发压缩。
   * @default 128_000
   */
  maxContextTokens: number;

  /**
   * 触发上下文压缩的剩余 Token 阈值。
   * 当剩余空间低于此值时开始压缩。
   * @default 25_000
   */
  compactionThreshold: number;

  /**
   * 单个工具被拒绝的最大次数。
   * 超出后 Agent 停止尝试该工具。
   * @default 3
   */
  maxDenialsPerTool: number;

  // ── 模型配置 ──────────────────────────────────────────────

  /**
   * 可用模型列表（按能力层级从低到高排列）。
   *
   * core 用此列表实现自动降级：
   * 当费用超过阈值时切换到 costMultiplier 更低的模型。
   *
   * 调用方替换成自己的模型商时，替换此列表即可。
   */
  availableModels: ModelSpec[];

  /**
   * 模型快捷名称映射。
   * 让 Agent 定义文件可以用 'fast'/'smart' 代替具体模型名。
   */
  modelAliases: {
    fast: string;
    smart: string;
    default: string;
  };

  /**
   * 模型定价表（USD / 百万 token）。
   * 用于估算费用和触发自动降级。
   * 传入值会覆盖内置定价，未覆盖的模型使用内置值。
   */
  modelPricing?: Record<string, ModelPricing>;

  // ── 安全策略 ──────────────────────────────────────────────

  /**
   * Agent 无法读写的路径（相对路径，相对于 resourceRoot）。
   * 会与内置保护列表（.git、.env 等）合并，不替换。
   */
  extraSensitivePaths?: readonly string[];
}

export interface ModelSpec {
  id: string;
  name: string;
  /** 相对于基准模型的费用倍数，用于自动降级决策 */
  costMultiplier: number;
  /** 能力层级（1=最快最便宜，数字越大能力越强） */
  capabilityTier: number;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export function buildBehaviorConfig(partial?: Partial<BehaviorConfig>): BehaviorConfig {
  return {
    maxStepsPerSession:    partial?.maxStepsPerSession    ?? 50,
    maxBudgetUsdPerSession: partial?.maxBudgetUsdPerSession ?? 5.0,
    maxContextTokens:      partial?.maxContextTokens      ?? 128_000,
    compactionThreshold:   partial?.compactionThreshold   ?? 25_000,
    maxDenialsPerTool:     partial?.maxDenialsPerTool     ?? 3,
    availableModels:       partial?.availableModels       ?? DEFAULT_MODEL_SPECS,
    modelAliases:          partial?.modelAliases          ?? { fast: 'qwen-turbo', smart: 'qwen-max', default: 'qwen-plus' },
    modelPricing:          partial?.modelPricing,
    extraSensitivePaths:   partial?.extraSensitivePaths   ?? [],
  };
}

const DEFAULT_MODEL_SPECS: ModelSpec[] = [
  { id: 'qwen-turbo', name: 'Qwen Turbo', costMultiplier: 0.1, capabilityTier: 1 },
  { id: 'qwen-plus',  name: 'Qwen Plus',  costMultiplier: 0.4, capabilityTier: 2 },
  { id: 'qwen-max',   name: 'Qwen Max',   costMultiplier: 1.0, capabilityTier: 3 },
];
```

### 3.2 `LayoutConfig` — 文件系统布局决策

这是调用方对"文件放在哪里"的决策，与行为配置完全正交。

```typescript
// src/config/layout.ts

/**
 * 文件系统布局配置。
 *
 * 与 BehaviorConfig 分离的原因：
 * 布局是部署决策（文件放在哪），行为是业务决策（系统怎么运行）。
 * 两者变化的原因不同，因此分开定义。
 *
 * 典型场景：
 * - 开发时：layout 指向项目目录，behavior 使用默认值
 * - 生产部署：layout 把数据目录指向 /var/lib/app，behavior 调大预算上限
 * - 测试：layout 指向临时目录，behavior 缩小步骤数加速测试
 */
export interface LayoutConfig {
  /**
   * 项目根目录（绝对路径）。
   * 资源文件（skills、agents 等）从此目录的子目录加载。
   */
  resourceRoot: string;

  /**
   * 配置目录名（相对于 resourceRoot 和用户 home 目录）。
   *
   * 这一个字段决定了整个约定体系：
   *   资源目录：<resourceRoot>/<configDirName>/skills、mcps ...
   *   用户目录：~/<configDirName>/skills、mcps ...
   *   数据目录：<resourceRoot>/<configDirName>/data（可被 dataDir 覆盖）
   *
   * @default '.thething'
   */
  configDirName: string;

  /**
   * 运行时数据目录（数据库、工具结果缓存等）。
   * 不传时默认为 <resourceRoot>/<configDirName>/data。
   *
   * 独立配置此字段可以把数据与代码分离（符合 12-factor app 原则）。
   */
  dataDir?: string;

  /**
   * 各类资源的目录列表（绝对路径，按优先级从低到高排列）。
   *
   * 不传时由 configDirName 自动派生：
   *   skills: ['~/<configDirName>/skills', '<resourceRoot>/<configDirName>/skills']
   *
   * 传入时完整替换默认列表（不合并）。
   * 如需在默认基础上追加，调用方可以用 buildDefaultResourceDirs() 辅助构建。
   */
  resources?: Partial<ResourceDirs>;

  /**
   * 项目上下文文件的文件名列表（按优先级排列）。
   * 这些文件会被加载进 system prompt，描述项目背景。
   * @default ['THING.md', 'CONTEXT.md']
   */
  contextFileNames?: readonly string[];
}

export interface ResourceDirs {
  skills:      readonly string[];
  agents:      readonly string[];
  mcps:        readonly string[];
  connectors:  readonly string[];
  permissions: readonly string[];
  memory:      readonly string[];
}

/**
 * 展开后的布局（所有路径均为绝对路径，不含可选字段）。
 * 由 resolveLayout() 从 LayoutConfig 构建，之后在系统内流通。
 */
export interface ResolvedLayout {
  readonly resourceRoot:    string;
  readonly configDirName:   string;
  readonly dataDir:         string;
  readonly resources:       Readonly<ResourceDirs>;
  readonly contextFileNames: readonly string[];
  readonly tokenizerCacheDir: string;
}

/**
 * 将 LayoutConfig 展开为 ResolvedLayout（所有路径均为绝对路径）。
 * 这是一个纯函数：给定相同输入，始终返回相同输出。
 */
export function resolveLayout(config: LayoutConfig): ResolvedLayout {
  const { resourceRoot, configDirName = '.thething' } = config;
  const projectDir = path.join(resourceRoot, configDirName);
  const userDir    = path.join(os.homedir(), configDirName);
  const dataDir    = config.dataDir ?? path.join(projectDir, 'data');

  const defaultResources: ResourceDirs = {
    skills:      [path.join(userDir, 'skills'),      path.join(projectDir, 'skills')],
    agents:      [path.join(userDir, 'agents'),      path.join(projectDir, 'agents')],
    mcps:        [path.join(userDir, 'mcps'),        path.join(projectDir, 'mcps')],
    connectors:  [                                   path.join(projectDir, 'connectors')],
    permissions: [path.join(userDir, 'permissions'), path.join(projectDir, 'permissions')],
    memory:      [                                   path.join(projectDir, 'memory')],
  };

  return Object.freeze({
    resourceRoot,
    configDirName,
    dataDir,
    resources:         Object.freeze({ ...defaultResources, ...config.resources }),
    contextFileNames:  config.contextFileNames ?? ['THING.md', 'CONTEXT.md'],
    tokenizerCacheDir: path.join(os.homedir(), '.cache', 'thething', 'tokenizers'),
  });
}
```

### 3.3 `bootstrap` — 唯一的注入点

```typescript
// src/bootstrap.ts

export interface BootstrapOptions {
  layout:   LayoutConfig;
  behavior?: Partial<BehaviorConfig>;  // 不传则全部使用默认值
}

export interface CoreRuntime {
  /** 展开后的布局（所有路径已解析为绝对路径） */
  readonly layout:   ResolvedLayout;
  /** 完整行为配置（所有字段已填充默认值） */
  readonly behavior: BehaviorConfig;
  readonly dataStore: DataStore;
  readonly connectorGateway: ConnectorGateway;
  dispose(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  const layout   = resolveLayout(options.layout);
  const behavior = buildBehaviorConfig(options.behavior);

  // 定价配置在这里一次性注入，之后 CostTracker 从 behavior 取
  if (behavior.modelPricing) {
    configurePricing(behavior.modelPricing);
  }

  const dataStore = createSQLiteDataStore({ dataDir: layout.dataDir });

  const connectorGateway = await initConnectorGateway({
    idempotencyDbPath: path.join(layout.dataDir, '.connector-idempotency.db'),
  });

  return Object.freeze({
    layout,
    behavior,
    dataStore,
    connectorGateway,
    async dispose() {
      await waitForAllCompactions();
      await connectorGateway.shutdown().catch(console.warn);
      dataStore.close();
    },
  });
}
```

### 3.4 配置沿调用链的传递

两个配置对象从 `bootstrap` 出发，沿着 `CoreRuntime → AppContext → createAgent` 向下传递，每一层只取自己需要的部分：

```typescript
// AppContext 持有两个配置对象
export interface AppContext {
  readonly layout:   ResolvedLayout;   // 所有路径从这里取
  readonly behavior: BehaviorConfig;   // 所有行为参数从这里取
  readonly runtime:  CoreRuntime;
  // ... 资源快照
}

// createAgent 消费配置，不再有任何字面量
export async function createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
  const { context } = options;
  const { layout, behavior } = context;

  const sessionState = createSessionState(options.conversationId, {
    maxContextTokens:      behavior.maxContextTokens,
    compactionThreshold:   behavior.compactionThreshold,
    maxBudgetUsd:          behavior.maxBudgetUsdPerSession,
    maxDenialsPerTool:     behavior.maxDenialsPerTool,
    model:                 options.model.modelName,
    projectDir:            layout.resourceRoot,
    configDirName:         layout.configDirName,
    availableModels:       behavior.availableModels,
  });

  const pipeline = createAgentPipeline({
    sessionState,
    maxSteps:     behavior.maxStepsPerSession,      // 不再是字面量 50
    maxBudgetUsd: behavior.maxBudgetUsdPerSession,  // 不再是字面量 5.0
  });

  const projectContext = await loadProjectContext(
    layout.resourceRoot,
    layout.contextFileNames
  );

  // 路径验证器接收配置，动态构建敏感路径列表
  const pathValidator = createPathValidator({
    configDirName:      layout.configDirName,
    extraSensitivePaths: behavior.extraSensitivePaths,
  });

  const modelResolver = createModelResolver(behavior.modelAliases);

  // ...
}
```

---

## 四、具体重构方案

### 4.1 修补问题一：让 `configDirName` 流进路径计算链

**改动最小、效果最完整的方式**：给 `compute*` 系列纯函数增加 `configDirName` 参数。

```typescript
// foundation/paths/compute.ts
// 修改前：函数内部读全局常量
export function computeProjectConfigDir(cwd: string, subdir?: string): string {
  return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, subdir ?? '');
}

// 修改后：configDirName 作为参数
export function computeProjectConfigDir(
  cwd: string,
  subdir?: string,
  configDirName = DEFAULT_PROJECT_CONFIG_DIR_NAME   // 默认值保持向后兼容
): string {
  return path.join(cwd, configDirName, subdir ?? '');
}

export function computeUserConfigDir(
  homeDir: string,
  subdir?: string,
  configDirName = DEFAULT_PROJECT_CONFIG_DIR_NAME
): string {
  return path.join(homeDir, configDirName, subdir ?? '');
}
```

**`ResourceLayout` 的 `buildDefaultResourceLayout` 接收 `configDirName`**：

```typescript
// config/layout.ts
export function buildDefaultResourceLayout(
  cwd: string,
  homeDir: string,
  configDirName = DEFAULT_PROJECT_CONFIG_DIR_NAME
): ResourceLayout {
  return {
    skills: [
      computeUserConfigDir(homeDir, 'skills', configDirName),
      computeProjectConfigDir(cwd, 'skills', configDirName),
    ],
    // ... 其余同理
  };
}
```

**各独立引用 `DEFAULT_PROJECT_CONFIG_DIR_NAME` 的模块改为接受参数**：

| 模块 | 改动 |
|------|------|
| `api/loaders/skills.ts` | `loadSkills({ cwd, configDirName })` |
| `api/loaders/mcps.ts` | `loadMcpServers({ cwd, configDirName })` |
| `extensions/mcp/mcp-config-store.ts` | 接受 `configDirName` 参数 |
| `extensions/memory/paths.ts` | 删除全局单例，接受 `configDirName` |
| `extensions/permissions/loader.ts` | `loadPermissions({ cwd, configDirName })` |
| `extensions/permissions/path-validation.ts` | `validatePath(path, { configDirName })` |
| `extensions/system-prompt/sections/project-context.ts` | `loadProjectContext(cwd, { configDirName })` |
| `runtime/budget/tool-result-storage.ts` | `getToolResultsDir(id, dir, configDirName)` |
| `runtime/tools/skill.ts` | `findSkillDir(name, dir, configDirName)` |
| `extensions/connector/idempotency.ts` | 删除内部路径计算，路径由 `bootstrap` 注入 |

### 4.2 修补问题二：让行为参数流进 `createAgent`

**`PreloadedData` 增加 `behaviorDefaults`**，让 `createChatAgent` 能访问到：

```typescript
// runtime/agent/types.ts
export interface PreloadedData {
  cwd: string;
  skills: Skill[];
  agents: AgentDefinition[];
  mcps: McpServerConfig[];
  connectors: ConnectorFrontmatter[];
  permissions: PermissionRule[];
  memory: MemoryEntry[];
  dataStore: DataStore;
  behaviorDefaults: Required<BehaviorConfig>;  // ← 新增
}
```

**`createAgent`（api 层）传入 `behaviorDefaults`**：

```typescript
// api/app/create.ts
export async function createAgent(options: CreateAgentOptions): Promise<CreateAgentResult> {
  const { context } = options;

  const result = await createChatAgent({
    ...
    preloadedData: {
      ...
      dataStore: context.runtime.dataStore,
      behaviorDefaults: context.runtime.behavior,  // ← 传入
    },
  });
}
```

**`runtime/agent/create.ts` 消除三处字面量**：

```typescript
export async function createChatAgent(config: CreateAgentConfig): Promise<CreateAgentResult> {
  const { sessionOptions } = config;
  const behavior = config.preloadedData?.behaviorDefaults;

  const sessionState = createSessionState(conversationId, {
    maxContextTokens: sessionOptions?.maxContextTokens ?? behavior?.maxContextTokens ?? 128_000,
    compactThreshold: sessionOptions?.compactThreshold ?? behavior?.compactionThreshold ?? 25_000,
    maxBudgetUsd:     sessionOptions?.maxBudgetUsd     ?? behavior?.maxBudgetUsdPerSession ?? 5.0,
    availableModels:  behavior?.availableModels,   // ← 不再硬编码
    ...
  });

  const maxSteps     = behavior?.maxStepsPerSession    ?? 50;
  const maxBudgetUsd = sessionOptions?.maxBudgetUsd    ?? behavior?.maxBudgetUsdPerSession ?? 5.0;

  const prepareStep = createAgentPipeline({
    sessionState,
    maxSteps,       // ← 来自 behavior，不是字面量 50
    maxBudgetUsd,   // ← 来自 behavior，不是字面量 5.0
  });

  const stopWhen = createDefaultStopConditions(sessionState.costTracker, {
    maxSteps,
    ...
  });
}
```

### 4.3 修补问题三：`session-state/state.ts` 的 `availableModels`

```typescript
// 修改前：硬编码
availableModels: [
  { id: 'qwen-max', ... },
  { id: 'qwen-plus', ... },
  { id: 'qwen-turbo', ... },
],

// 修改后：从参数取
createSessionState(conversationId, {
  availableModels: options.availableModels ?? DEFAULT_MODEL_SPECS,
  ...
});
```

---

## 五、`defaults.ts` 最终形态

改造完成后，`defaults.ts` 只保留真正的内部常量：

```typescript
// config/defaults.ts（精简后）

// ── 路径约定默认值 ──────────────────────────────────────────
/** 配置目录名默认值。只在 resolveLayout 的 configDirName 参数缺省时使用。 */
export const DEFAULT_PROJECT_CONFIG_DIR_NAME = '.thething';

// ── 算法常量（不属于配置，不应该被覆盖）────────────────────
/** Token 到字节的估算比例（统计平均值） */
export const BYTES_PER_TOKEN = 4;

/** 工具结果的最大 Token 数（超出后截断） */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/** 单轮消息中所有工具结果的总字符上限 */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

/** 工具结果预览的字符数 */
export const PREVIEW_SIZE_CHARS = 2_000;

/** Memory 文件的最大行数 */
export const MAX_ENTRYPOINT_LINES = 200;

/** Memory 文件的最大字节数 */
export const MAX_ENTRYPOINT_BYTES = 25_000;

/** 电路断路器重置超时 */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000;

/** HuggingFace 镜像地址 */
export const HF_MIRROR_BASE_URL = 'https://hf-mirror.com';
export const HF_OFFICIAL_BASE_URL = 'https://huggingface.co';

// ── 以下从 defaults.ts 删除 ──
// DEFAULT_MAX_BUDGET_USD      → BehaviorConfig.maxBudgetUsdPerSession 的默认值
// DEFAULT_AVAILABLE_MODELS    → BehaviorConfig.availableModels 的默认值
// MODEL_MAPPING               → BehaviorConfig.modelAliases 的默认值
// DEFAULT_CONTEXT_LIMIT       → BehaviorConfig.maxContextTokens 的默认值
// DEFAULT_MAX_DENIALS_PER_TOOL → BehaviorConfig.maxDenialsPerTool 的默认值
// DEFAULT_SKILL_SCAN_DIRS     → 由 resolveLayout 派生
// DEFAULT_MCP_CONFIG_DIR      → 由 resolveLayout 派生
// DEFAULT_PERMISSIONS_DIR     → 由 resolveLayout 派生
// DEFAULT_CONNECTORS_DIR      → 由 resolveLayout 派生
// DEFAULT_AGENT_SCAN_DIRS     → 由 resolveLayout 派生
```

---

## 六、实施顺序

按依赖关系和风险从低到高：

| 步骤 | 改动 | 说明 |
|------|------|------|
| 1 | `compute*` 函数增加可选 `configDirName` 参数 | 向后兼容，默认值不变 |
| 2 | `buildDefaultResourceLayout` 增加 `configDirName` 参数 | 向后兼容 |
| 3 | 定义 `BehaviorConfig` 和 `LayoutConfig` 接口 | 新增类型定义 |
| 4 | 实现 `resolveLayout` 和 `buildBehaviorConfig` 函数 | 新增纯函数 |
| 5 | `BootstrapOptions` 改为 `{ layout, behavior? }` 结构 | 结构调整 |
| 6 | `CoreRuntime` 增加 `layout` 和 `behavior` 字段 | 新增字段 |
| 7 | `AppContext` 持有 `layout` 和 `behavior` | 新增字段 |
| 8 | `PreloadedData` 增加 `behaviorDefaults` | 新增字段 |
| 9 | `LoadAllOptions` 增加 `configDirName`，各 loader 传递 | 新增参数 |
| 10 | `createContext` 从 `runtime.layout` 取值传给 loaders | 改动已有逻辑 |
| 11 | `runtime/agent/create.ts` 消除三处字面量 | 核心改动 |
| 12 | `session-state/state.ts` `availableModels` 从参数取 | 消除硬编码 |
| 13 | 各独立引用 `DEFAULT_PROJECT_CONFIG_DIR_NAME` 的模块改为接受参数 | 依赖前几步完成 |
| 14 | 清理 `defaults.ts` 中已移走的常量 | 收尾 |

---

## 七、调用方视角

### 最简场景（全部默认值）

```typescript
import { bootstrap } from '@the-thing/core';

const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd() },
  // behavior 不传：全部使用默认值
  // configDirName 不传：使用 '.thething'
});
```

### 替换应用名（应用方核心场景）

```typescript
const runtime = await bootstrap({
  layout: {
    resourceRoot: process.cwd(),
    configDirName: '.myapp',
    contextFileNames: ['MYAPP.md', 'CONTEXT.md'],
  },
});
// 结果：所有路径使用 .myapp，Agent 加载 MYAPP.md，.myapp 被自动保护
```

### 企业部署（行为调整 + 路径分离 + 替换模型商）

```typescript
const runtime = await bootstrap({
  layout: {
    resourceRoot: process.cwd(),
    configDirName: '.myapp',
    dataDir: process.env.DATA_DIR ?? '/var/lib/myapp/data',
    resources: {
      skills: ['/shared/company-skills', path.join(process.cwd(), '.myapp', 'skills')],
    },
  },
  behavior: {
    maxBudgetUsdPerSession: 20.0,
    maxStepsPerSession: 100,
    availableModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
      { id: 'gpt-4o',      name: 'GPT-4o',      costMultiplier: 1.0, capabilityTier: 3 },
    ],
    modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
    modelPricing: {
      'gpt-4o':      { inputPerMillion: 5,   outputPerMillion: 15,  cachedPerMillion: 2.5 },
      'gpt-4o-mini': { inputPerMillion: 0.6, outputPerMillion: 2.4, cachedPerMillion: 0.3 },
    },
  },
});
```

### 测试场景（完全可控）

```typescript
import tmp from 'tmp-promise';

const { path: tmpDir } = await tmp.dir({ unsafeCleanup: true });

const runtime = await bootstrap({
  layout: {
    resourceRoot: tmpDir,
    configDirName: '.test',
    dataDir: ':memory:',   // 内存数据库，不落盘
  },
  behavior: {
    maxStepsPerSession: 5,
    maxBudgetUsdPerSession: 0.01,
  },
});
// 每个测试用例都是独立的 bootstrap 实例，不存在全局状态污染
```

### CLI 应用层解析环境变量

`core` 包不读任何环境变量，所有解析由应用层负责：

```typescript
// packages/cli/src/main.ts

const runtime = await bootstrap({
  layout: {
    resourceRoot:     resolveProjectRoot(),
    configDirName:    process.env.APP_CONFIG_DIR ?? '.myapp',
    dataDir:          process.env.APP_DATA_DIR,
    contextFileNames: ['MYAPP.md', 'CONTEXT.md'],
  },
  behavior: {
    maxBudgetUsdPerSession: Number(process.env.MAX_BUDGET_USD ?? '5'),
  },
});
```

---

## 八、一句话总结

现有配置系统的根本问题不是"`.thething` 写死了"，而是**配置没有被当作配置来对待**：行为参数被硬编码成字面量，布局约定被各模块各自读取，调用方的决策无法完整地流入系统深处。

正确的做法：把所有属于"调用方决策"的东西归拢到两个对象（`LayoutConfig` 描述文件放在哪，`BehaviorConfig` 描述系统怎么运行），在 `bootstrap` 唯一入口接收，解析成不可变的 `ResolvedLayout` 和 `BehaviorConfig`，然后通过参数传递到每一个需要它们的地方。