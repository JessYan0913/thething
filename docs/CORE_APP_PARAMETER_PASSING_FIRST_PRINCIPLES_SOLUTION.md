# Core 应用层参数传递断层第一性原理解决方案

> 日期：2026-05-14  
> 范围：`packages/core` 中 `bootstrap()`、`createContext()`、`createAgent()`、`BehaviorConfig`、`LayoutConfig`、`SessionStateOptions`、runtime agent 创建、工具加载、压缩、模型、memory、permissions 等应用层参数传递链路。  
> 相关文档：
> - `docs/CORE_COMPACTION_FIRST_PRINCIPLES_SOLUTION.md`
> - `docs/CORE_COMPACTION_ANALYSIS_AND_FIX_PLAN.md`

---

## 1. 问题定义

当前 `packages/core` 存在系统性的应用层参数传递断层。

问题不是某一个字段漏传，而是配置架构缺少一个硬约束：

```text
任何公开 API 或配置项，只要出现在类型系统中，就必须能确定性地影响 runtime 行为。
```

现在的实际情况是：

1. 有些参数在公开 API 类型中定义了，但 `api/app/create.ts` 没有转发。
2. 有些参数在 `api/app/create.ts` 转发了，但 `runtime/agent/create.ts` 创建 runtime state 时又丢掉。
3. 有些配置已经进入 `BehaviorConfig` 或 `LayoutConfig`，但底层模块仍然读取 defaults 或全局路径。
4. `AppContext` 声称是已加载配置快照，但 runtime 工具加载阶段仍会重新扫描文件系统。
5. 有些开关在类型里存在，但没有任何实际语义。

这会导致调用方以为自己配置了系统，实际 runtime 静默回退到默认值。

---

## 2. 第一性原理

### 2.1 不可再分的硬约束

1. **公开配置必须有可观察行为**  
   如果一个字段在公开类型中存在，它必须影响 runtime，或者被标记为 deprecated/internal 并从公开使用路径移除。

2. **配置传递必须单向、可追踪**  
   配置应从应用层入口进入，经过少数明确的 normalized config，再进入 runtime。不能在下游模块重新推导另一套默认值。

3. **默认值只能在边界合并一次**  
   默认值应在 `bootstrap()` 或 config builder 中合并，runtime 模块消费已解析配置，不应再次发明业务默认值。

4. **AppContext 是配置快照，不是建议值**  
   如果 `AppContext` 已经加载了 skills、agents、mcps、permissions、memory，runtime 不应绕过它重新扫描，除非明确设计为动态刷新。

5. **LayoutConfig 决定资源位置**  
   如果调用方配置了 `layout.resources` 或 `contextFileNames`，所有资源加载都必须使用它，而不是继续用 `getProjectConfigDir()` 推导默认路径。

6. **BehaviorConfig 决定运行行为**  
   session budget、模型切换、压缩、工具输出、memory 限制等运行策略应全部来自 `BehaviorConfig` 或 explicit override。

### 2.2 错误假设

| 假设 | 为什么错误 |
| --- | --- |
| 类型里定义字段就等于功能可用 | TypeScript 类型不会自动传递到 runtime |
| 上层已经传了，底层就一定用了 | 中间层可能重建对象并漏字段 |
| runtime 可以继续读 defaults 作为 fallback | fallback 会掩盖应用配置未生效的问题 |
| AppContext 加载过资源，但工具层重新扫描也没问题 | 这破坏快照一致性，也绕过 layout 和 reload 语义 |
| 模块开关可以先放类型里以后再实现 | 这会给调用方制造虚假的控制能力 |
| 自定义 layout 只影响日志路径 | layout 的本质是文件系统事实来源，必须影响加载路径 |

---

## 3. 当前已确认的断层

### 3.1 模型参数断层

`CreateAgentOptions.model.enableThinking` 已定义，模型工厂也支持：

```ts
model: {
  enableThinking?: boolean;
}
```

但 `api/app/create.ts` 构造 `modelConfig` 时没有传递 `enableThinking`。

影响：

1. 应用层设置 thinking/reasoning 模式不生效。
2. 用户会误以为模型已进入高推理模式。
3. provider-specific 参数无法可靠进入模型实例。

修复：

```ts
modelConfig: {
  apiKey: options.model.apiKey,
  baseURL: options.model.baseURL,
  modelName: options.model.modelName,
  includeUsage: options.model.includeUsage ?? true,
  enableThinking: options.model.enableThinking,
}
```

### 3.2 SessionOptions 中间层截断

`api/app/create.ts` 已传入：

1. `maxDenialsPerTool`
2. `availableModels`
3. `autoDowngradeCostThreshold`

但 `runtime/agent/create.ts` 创建 `SessionState` 时只转发：

1. `maxContextTokens`
2. `compactThreshold`
3. `maxBudgetUsd`
4. `model`
5. `projectDir`
6. `dataStore`

影响：

1. 拒绝次数配置失效。
2. 模型切换候选列表回退默认值。
3. 自动降级成本阈值回退默认值。
4. 后续新增字段容易继续被静默丢弃。

修复原则：

```ts
createSessionState(conversationId, {
  ...sessionOptions,
  projectDir: cwd,
  model: modelConfig.modelName ?? sessionOptions?.model,
  dataStore,
});
```

禁止手写白名单重建对象，除非有明确字段转换。

### 3.3 Compaction 配置断层

公开 API 中存在：

```ts
CreateAgentOptions.compaction
```

`BehaviorConfig` 中也存在：

```ts
behavior.compaction
```

`SessionStateOptions` 支持：

```ts
compactionConfig?: CompactionConfig;
```

但应用层没有把 `options.compaction` 合并进有效配置，runtime 创建 session state 时也没有传入 `compactionConfig`。

影响：

1. session memory compact 配置不生效。
2. micro compact 配置不生效。
3. post compact 配置不生效。
4. 压缩阈值和 buffer 容易继续走硬编码或默认值。

修复：

1. 在 `api/app/create.ts` 中合并 `behavior.compaction` 与 `options.compaction`。
2. 输出完整 `CompactionConfig`。
3. 传入 `sessionOptions.compactionConfig`。
4. `runtime/agent/create.ts` 原样传给 `createSessionState()`。

建议增加：

```ts
function resolveAgentCompactionConfig(
  behavior: BehaviorConfig,
  options?: CreateAgentOptions["compaction"],
): CompactionConfig
```

### 3.4 模块开关断层

`CreateAgentOptions.modules` 定义了：

```ts
modules?: {
  skills?: boolean;
  mcps?: boolean;
  memory?: boolean;
  connectors?: boolean;
  permissions?: boolean;
  compaction?: boolean;
}
```

但实际只处理：

1. `skills`
2. `mcps`
3. `memory`
4. `connectors`

`permissions` 和 `compaction` 没有 runtime 语义。

影响：

1. `modules.permissions = false` 不会禁用 permissions 注入或权限规则。
2. `modules.compaction = false` 不会禁用自动压缩。
3. 调用方无法通过公开 API 控制这些模块。

修复：

明确语义：

```text
permissions === false:
  - 不把 permission rules 注入 system prompt
  - 是否禁用权限执行拦截，需要单独安全评估，默认不建议关闭底层安全拦截

compaction === false:
  - 禁用普通自动压缩
  - 保留 emergency PTL/retry，除非另有更强配置显式禁止
```

### 3.5 ToolOutput 配置断层

`BehaviorConfig.toolOutput` 已定义，但工具输出管理器仍使用 defaults 和全局 `ToolOutputOverrides`。

影响：

1. `maxResultSizeChars` 不生效。
2. `maxToolResultsPerMessageChars` 不生效。
3. preview size 等配置不生效。
4. 大工具输出处理行为与应用层配置不一致。

修复：

把 `behavior.toolOutput` 转成 runtime 可消费的 `ToolOutputOverrides` 或重构为显式配置对象：

```ts
sessionOptions: {
  toolOutputConfig: behavior.toolOutput,
}
```

更推荐去掉全局单例：

```ts
processToolOutput(output, toolName, toolUseId, {
  sessionId,
  projectDir,
  state,
  config: sessionState.toolOutputConfig,
});
```

避免不同会话互相覆盖全局配置。

### 3.6 Layout resources 断层

`LayoutConfig.resources` 允许调用方传入自定义资源目录。

`createContext()` 构造了：

```ts
resourceDirs: layout.resources
```

但 `loadAll()` 没有把 `resourceDirs` 传给各 loader。多数 loader 继续使用：

```ts
getUserConfigDir(...)
getProjectConfigDir(...)
```

影响：

1. 自定义资源目录不会真正生效。
2. `loadedFrom` 可能显示 layout 路径，但实际加载来自默认路径。
3. 测试和生产部署无法可靠隔离资源目录。

修复：

为各 loader 增加显式目录参数：

```ts
loadSkills({ dirs: layout.resources.skills })
loadAgents({ dirs: layout.resources.agents })
loadMcpServers({ dirs: layout.resources.mcps })
loadConnectors({ dirs: layout.resources.connectors })
loadPermissions({ dirs: layout.resources.permissions, filename })
loadMemory({ dirs: layout.resources.memory, limits })
```

`loadAll()` 必须分发 `resourceDirs`。

### 3.7 contextFileNames 断层

`LayoutConfig.contextFileNames` 已定义，但项目上下文加载仍硬编码：

```ts
['THING.md', 'CONTEXT.md']
```

影响：

1. 调用方配置的上下文文件名不生效。
2. 自定义产品名或组织规范无法进入 system prompt。

修复：

让 `loadProjectContext()` 接收：

```ts
loadProjectContext(cwd, {
  contextFileNames: layout.contextFileNames,
  configDirName: layout.configDirName,
})
```

`runtime/agent/create.ts` 不应只传 `cwd`。

### 3.8 AppContext 快照被 runtime 重新扫描绕过

`AppContext` 已包含：

1. skills
2. agents
3. mcps
4. connectors
5. permissions
6. memory

但工具加载阶段仍重新扫描：

1. `scanAgentDirs(config.sessionState.projectDir)`
2. `getMcpServerConfigs(config.sessionState.projectDir)`

影响：

1. `AppContext` 不是单一配置快照。
2. `reload()` 的不可变快照语义被削弱。
3. runtime 可能加载到和 context 不一致的文件。
4. layout.resources 自定义路径被绕过。

修复：

`loadAllTools()` 应使用 `preloadedData.agents` 和 `preloadedData.mcps`。

如果需要动态扫描，应引入显式选项：

```ts
dynamicReload?: boolean
```

默认必须使用 AppContext 快照。

### 3.9 modelAliases 配置未使用

`BehaviorConfig.modelAliases` 已定义，但当前代码中几乎没有 runtime 使用点。

影响：

1. 用户配置 `fast/smart/default` 映射后，不一定影响子代理或模型选择。
2. 文档中的模型别名能力可能只是声明。

修复：

明确使用场景：

1. agent definition 中的 `model: fast/smart/default`
2. skill metadata 中的 model override
3. sub-agent provider 选择

所有别名解析通过统一函数：

```ts
resolveModelAlias(modelOrAlias, behavior.modelAliases)
```

### 3.10 Memory entrypoint 限制断层

`BehaviorConfig.memory` 包含：

1. `entrypointMaxLines`
2. `entrypointMaxBytes`

但 memory entrypoint 相关函数仍主要使用 defaults。

影响：

1. 用户配置 memory entrypoint 限制不生效。
2. memory 写入和重建可能超过应用层限制。

修复：

`loadEntrypoint()`、`appendToEntrypoint()`、`rebuildEntrypoint()` 都应接收 limits，或由 memory service 持有 resolved config。

### 3.11 reload dataDir 覆盖可能丢失

`createContext()` 支持 `options.dataDir` 覆盖，但 `context.reload()` 只传了 `runtime`、`cwd`、`verbose`、`onLoad`，没有传回当前 `dataDir`。

影响：

如果调用方通过 `createContext({ dataDir })` 覆盖了数据目录，reload 后可能回到 `runtime.layout.dataDir`。

修复：

```ts
reload: async (...) => createContext({
  runtime,
  cwd: reloadOptions?.cwd ?? cwd,
  dataDir,
  verbose: ...,
  onLoad,
})
```

---

## 4. 目标架构

### 4.1 三层配置模型

应把配置分成三层：

```text
Public Options
  bootstrap(options)
  createContext(options)
  createAgent(options)

Resolved Config
  ResolvedLayout
  ResolvedBehavior
  ResolvedAgentConfig

Runtime Consumers
  SessionState
  ToolLoader
  ModelProvider
  Compaction
  Memory
  Permissions
```

原则：

1. Public Options 可以是 partial。
2. Resolved Config 必须完整、不可变、无 undefined。
3. Runtime Consumers 只消费 Resolved Config，不再读取业务 defaults。

### 4.2 新增 ResolvedAgentConfig

建议在 `api/app/create.ts` 中先构建一个完整配置：

```ts
interface ResolvedAgentConfig {
  conversationId: string;
  userId: string;
  modelConfig: ModelProviderConfig;
  sessionOptions: SessionStateOptions;
  modules: Required<CreateAgentOptions["modules"]>;
  compactionEnabled: boolean;
  permissionsEnabled: boolean;
  layout: ResolvedLayout;
  behavior: BehaviorConfig;
  preloadedData: PreloadedData;
}
```

所有 override 都在这里合并：

```text
BehaviorConfig defaults
-> bootstrap behavior override
-> createAgent session/compaction/module override
-> ResolvedAgentConfig
```

`createChatAgent()` 不应再自己猜默认值，而是消费 resolved config。

### 4.3 配置传递禁止手写截断

当前容易出错的模式：

```ts
createSessionState(conversationId, {
  maxContextTokens: sessionOptions?.maxContextTokens ?? 128_000,
  compactThreshold: sessionOptions?.compactThreshold ?? 25_000,
  maxBudgetUsd: sessionOptions?.maxBudgetUsd ?? 5.0,
  model: modelConfig.modelName,
  projectDir: cwd,
  dataStore,
})
```

推荐模式：

```ts
createSessionState(conversationId, {
  ...resolved.sessionOptions,
  projectDir: resolved.layout.resourceRoot,
  dataStore: resolved.runtime.dataStore,
})
```

这样新增字段会自然传递，不会被中间层白名单截断。

### 4.4 loader 必须使用 ResolvedLayout

`loadAll()` 应改成真正消费 `resourceDirs`：

```ts
loadAll({
  cwd,
  dataDir,
  resourceDirs: layout.resources,
  filenames: layout.filenames,
  contextFileNames: layout.contextFileNames,
  memory: behavior.memory,
})
```

各 loader 不应自行调用 `getProjectConfigDir()`，除非没有传入 resolved dirs。

### 4.5 Runtime 不再重新扫描 AppContext 已加载资源

`loadAllTools()` 应输入：

```ts
agents: AgentDefinition[];
mcps: McpServerConfig[];
connectors: ConnectorFrontmatter[];
```

而不是只拿 `projectDir` 重新扫描。

如确实需要重新扫描，必须是显式动态模式：

```ts
tools: {
  dynamicReload: true
}
```

默认路径应保持 AppContext 快照一致性。

---

## 5. 建议实施计划

### 阶段 1：修复最明显的运行时断层

1. `api/app/create.ts` 传递 `enableThinking`。
2. `runtime/agent/create.ts` 向 `createSessionState()` 原样转发 `sessionOptions`。
3. `api/app/create.ts` 合并并传递 `compactionConfig`。
4. 传递 `availableModels`、`autoDowngradeCostThreshold`、`maxDenialsPerTool`。
5. 将 `behavior.toolOutput` 接入工具输出管理。

### 阶段 2：明确模块开关语义

1. 实现 `modules.compaction`。
2. 实现 `modules.permissions` 的 prompt 注入语义。
3. 对底层安全拦截是否可关闭做单独设计，不要把 prompt 注入开关和安全开关混在一起。

### 阶段 3：修复 LayoutConfig 断层

1. `loadAll()` 分发 `resourceDirs`。
2. loader 支持显式 dirs。
3. `loadProjectContext()` 使用 `layout.contextFileNames`。
4. `context.reload()` 保留 `dataDir` override。

### 阶段 4：恢复 AppContext 快照一致性

1. `loadAllTools()` 使用 `preloadedData.agents`。
2. MCP 工具加载使用 `preloadedData.mcps`。
3. connector 工具使用 `context.runtime.connectorRegistry` 和已加载 connector 配置，避免二次扫描。
4. 删除或隔离动态扫描路径。

### 阶段 5：配置系统测试

为每个公开配置增加至少一个行为测试：

1. `enableThinking` 能进入 `createLanguageModel()`。
2. `maxDenialsPerTool` 影响 denial tracker。
3. `availableModels` 影响模型切换。
4. `autoDowngradeCostThreshold` 影响成本降级。
5. `compaction.sessionMemory` 影响压缩保留窗口。
6. `toolOutput.maxToolResultsPerMessageChars` 影响消息级预算。
7. `layout.resources.skills` 影响 skills 加载路径。
8. `layout.contextFileNames` 影响 project context 加载。
9. `modules.compaction=false` 禁用普通自动压缩。
10. `context.reload()` 保留 dataDir override。

---

## 6. 推荐代码结构

### 6.1 新增 agent config resolver

```text
packages/core/src/api/app/resolve-agent-config.ts
```

职责：

1. 合并 `CreateAgentOptions` 与 `AppContext.behavior`。
2. 生成完整 `ResolvedAgentConfig`。
3. 负责所有默认值和 override 处理。
4. 提供日志和测试入口。

示例：

```ts
export function resolveAgentConfig(
  options: CreateAgentOptions,
): ResolvedAgentConfig
```

### 6.2 新增 resource-aware loaders

为 loader options 增加：

```ts
dirs?: readonly string[];
```

然后从 `loadAll()` 分发：

```ts
loadSkills({ dirs: resourceDirs.skills })
```

### 6.3 新增 config trace 工具

为了避免未来再次出现静默断层，建议提供调试输出：

```ts
export function traceResolvedAgentConfig(config: ResolvedAgentConfig): ConfigTrace
```

至少包含：

1. 每个配置字段的来源。
2. 最终值。
3. 消费模块。
4. 是否有 runtime consumer。

---

## 7. 全量完成标准

只有满足以下条件，才能认为应用层参数传递断层被系统性解决：

1. 公开 API 中每个字段都有明确 runtime consumer。
2. `CreateAgentOptions` 不存在无效字段。
3. `BehaviorConfig` 不存在只定义不消费的字段。
4. `LayoutConfig.resources` 真正决定资源加载目录。
5. `AppContext` 是 runtime 使用的唯一配置快照。
6. runtime 模块不再读取业务 defaults，除非作为 builder fallback。
7. 模块开关都有明确语义。
8. 新增配置字段时，类型测试和行为测试会阻止漏传。

一句话总结：

```text
配置系统的目标不是让参数“能被传入”，
而是让每个公开参数都能被确定性地解析、传递、消费，并产生可测试的 runtime 行为。
```

