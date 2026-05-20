# @the-thing/core 内部架构重设计 — Musk 五步法

> "真正的工程不是让东西能跑，而是让东西能被理解、被修改、被信任。"

---

## 第零步：现状全景

### 模块统计

| 层 | 模块数 | 代码行数 | 职责 |
|---|--------|---------|------|
| Foundation | 7 | ~5,300 | 纯工具：常量、路径、解析、扫描、模型能力、定价、数据存储 |
| Config | 3 | ~400 | 配置合并：布局、行为、默认值 |
| Runtime | 8 | ~3,200 | 会话状态、Agent 控制、压缩、预算、任务、工具、中间件 |
| Extensions | 8 | ~5,000+ | 技能、附件、MCP、连接器、子代理、记忆、权限、系统提示 |
| API | 2 | ~500 | 加载器编排、Agent 创建入口 |
| Application | 1 | ~200 | 入站消息处理桥接 |

**总计：~14,600 行**，分布在约 80 个文件中。

### 当前层次图（理想 vs 现实）

```
理想（严格自上而下）：
  Foundation → Config → Runtime → Extensions → API → Bootstrap

现实（有反向依赖）：
  Foundation → Config → Runtime → Extensions
                                    ↕           ↕
                              API ←──────────────┘
                               ↑
                         Bootstrap

  问题区域：
  1. Extensions/connector/inbound → API/app (createAgent)     ← 反向
  2. Extensions/subagents → Runtime/tasks                     ← 正常（向下）
  3. Runtime/agent-control → Extensions/subagents/model-resolver ← 反向
  4. Runtime/session-state ←→ Runtime/compaction              ← 循环
  5. Extensions/skills → API/loaders/skills                   ← 循环
  6. Extensions/mcp → API/loaders/mcps                        ← 循环
  7. Extensions/subagents → API/loaders/agents                ← 循环
  8. Foundation/datastore/sqlite → Runtime/tasks/types        ← 反向
```

---

## Step 1: 质疑每项设计决策

### Q1: SessionState 为什么是一个 god-object？

**现状：** `SessionState` 接口包含 15+ 个字段：

```typescript
interface SessionState {
  conversationId, turnCount, aborted, model, projectRoot, layout,
  toolOutputConfig, permissionRules, extraSensitivePaths,
  taskStore, tokenBudget, costTracker, denialTracker, modelSwapper,
  activeSkills, loadedSkills, contentReplacementState,
  pendingCompactIds, compactionConfig, compactModel, fallbackModels, dataStore
}
```

**问题：** 每个模块都依赖 `SessionState`，但只用其中 2-3 个字段。`compaction` 需要 `tokenBudget` + `compactModel`，`agent-control` 需要 `costTracker` + `denialTracker`，`tools` 需要 `projectRoot` + `permissionRules`。把所有东西塞到一个对象里，导致任何字段变更都影响所有消费者。

**质疑：** 这不是一个"状态"，这是一个"依赖容器"。应该拆分为独立的服务接口。

### Q2: 为什么 foundation 和 runtime 之间有反向依赖？

**现状：** `foundation/datastore/sqlite/task-store.ts` 导入了 `runtime/tasks/types.ts` 的 `TaskEvent`、`TaskEventListener` 类型。

**质疑：** 这些是纯数据类型，应该在 foundation 层定义。当前的拆分不完整——部分 Task 类型在 foundation，部分在 runtime。

### Q3: 为什么每个 extension 都要 re-export api/loaders？

**现状：** `extensions/skills/index.ts` re-export `loadSkills` from `api/loaders/skills`，`extensions/mcp/index.ts` re-export `loadMcpServers` from `api/loaders/mcps`。

**质疑：** 这制造了循环依赖假象，而且违反了"extension 不应该知道 api 层"的原则。Extension 应该只包含类型和运行时逻辑，加载器应该在 api 层统一管理。

### Q4: 为什么 `model/provider.ts` 在 foundation 层？

**质疑：** Provider factory 依赖 `@ai-sdk/openai-compatible` 和 `ai` SDK。Foundation 应该是 SDK 无关的纯工具。Provider factory 是应用层关心的事情（用哪个 SDK），应该移到 runtime/agent。

### Q5: 为什么 `system-prompt` 要从 extensions/ 调用 `api/loaders/memory`？

**现状：** `system-prompt/sections/memory.ts` 通过 `api/loaders/memory` 获取 `MemoryEntry` 类型。

**质疑：** System prompt 不应该知道数据从哪来。Memory 类型应该在 foundation 或 extensions/memory 中定义，而不是通过 api/loaders 间接获取。

### Q6: 为什么 `agent/types.ts` 使用 `any`？

**现状：** `CreateAgentResult.agent` 和 `LoadToolsConfig.model` 都是 `any`。

**质疑：** 这说明模块边界有类型泄漏。`ToolLoopAgent` 来自 `ai` 包，应该直接 import 而不是用 `any` 绕过。

### Q7: 为什么 `STATUS_CONFIG` 包含 Tailwind CSS 类名？

**现状：** `runtime/tasks/types.ts` 的 `STATUS_CONFIG` 包含 `text-gray-400`、`animate-spin`。

**质疑：** 这是纯展示层关注点，不应该出现在 runtime 类型定义中。Core 应该对 UI 无关。

---

## Step 2: 删除

### 2.1 删除 dead code

| 项目 | 原因 |
|------|------|
| `foundation/clock/` | 零消费者，从未被 import |
| `agent/context.ts:resolveActiveSkills()` | stub 函数，返回空结果 |
| `session-state/token-budget.ts:finalize()` | 与 `accumulate()` 完全相同 |
| `system-prompt/index.ts:FEATURES` 对象 | 所有值硬编码为 true，无用 |

### 2.2 删除模块级全局可变状态

| 位置 | 问题 |
|------|------|
| `model-switching.ts:currentModel` | 模块级 `let` 变量，与 `ModelSwapper._currentModel` 重复 |
| `paths/compute.ts:resolvedConfigDirName` | 全局单例，已被 `ResolvedLayout` 模式替代 |
| `tasks/store.ts:globalTaskStore` | 全局单例，应由上层持有 |
| `scanner/merge.ts:LoadingCache` 全局实例 | 应由调用者持有 |

### 2.3 删除跨层 re-export

| 位置 | 删除 |
|------|------|
| `extensions/skills/index.ts` | `export { loadSkills } from '../../api/loaders/skills'` |
| `extensions/mcp/index.ts` | `export { loadMcpServers, ... } from '../../api/loaders/mcps'` |
| `extensions/subagents/index.ts` | `export { loadAgents, ... } from '../../api/loaders/agents'` |

### 2.4 删除 `compaction/index.ts` 的 kitchen-sink re-export

当前 re-export 了 token-counter、tokenizer、budget-check、retry、title-generator、lifecycle、context-window、types。应该只保留 `compactBeforeStep` 和类型导出，其他通过子路径或直接 import。

---

## Step 3: 简化 — 内部架构重设计

### 3.1 重新划分层次

**当前 5 层：** Foundation → Config → Runtime → Extensions → API

**新 4 层：**

```
Layer 1: Primitives（纯类型 + 纯函数，零依赖）
  - constants, parser, paths (compute*), clock, datastore/types

Layer 2: Services（有状态的服务，依赖 Primitives）
  - model/capabilities, model/pricing, datastore/sqlite
  - config/layout, config/behavior, config/defaults
  - scanner, cache

Layer 3: Modules（业务逻辑，依赖 Services）
  - session/ (从 runtime/session-state 重命名)
  - compaction/
  - budget/
  - tasks/
  - tools/
  - middleware/
  - extensions/ 下的所有模块

Layer 4: Composition（组装层，依赖所有）
  - api/loaders/
  - api/app/
  - bootstrap.ts
  - application/
```

**关键变化：**
- **Extensions 不再是独立层**，而是与 Runtime 同级的 Modules 层。它们不再"在 runtime 之上"，而是与 runtime 平级。
- **API 层是唯一的组装层**，负责将所有 Modules 组装起来。
- **删除 Extensions ↔ API 的循环**：Extensions 不再 re-export api/loaders。

### 3.2 拆分 SessionState god-object

**原则：** 每个消费者只看到它需要的接口（Interface Segregation Principle）。

```typescript
// === 新的接口拆分 ===

// 1. Token Budget（compaction 用）
interface TokenBudget {
  readonly maxContextTokens: number;
  readonly compactThreshold: number;
  readonly currentTokens: number;
  readonly remainingTokens: number;
  accumulate(usage: LanguageModelUsage): void;
  reportCompaction(freed: number): void;
  needsCompaction(): boolean;
}

// 2. Cost Tracking（agent-control/stop-conditions 用）
interface CostTracking {
  readonly isOverBudget: boolean;
  readonly totalCostUsd: number;
  accumulate(usage: LanguageModelUsage): void;
  persistToDB(): Promise<void>;
}

// 3. Denial Tracking（agent-control 用）
interface DenialTracking {
  record(toolName: string, reason: string): void;
  isThresholdExceeded(): boolean;
  getInjectMessage(): ModelMessage | null;
}

// 4. Model Switching（agent-control 用）
interface ModelSwitching {
  checkUserIntent(messages: ModelMessage[]): ModelSwitchResult;
  checkCostBudget(percent: number): ModelSwitchResult;
  getCurrentModel(): string;
}

// 5. Tool Output Management（tools/mcp/connector 用）
interface ToolOutputState {
  contentReplacementState: ContentReplacementState;
  toolOutputConfig: ToolOutputConfig;
  pendingCompactIds: string[];
}

// 6. Session Context（tools/context 用）
interface SessionContext {
  readonly conversationId: string;
  readonly projectRoot: string;
  readonly layout: ResolvedLayout;
  readonly taskStore: TaskStore;
  readonly permissionRules: PermissionRule[];
  readonly extraSensitivePaths: string[];
  readonly model: string;
  readonly compactionConfig: CompactionConfig;
}

// 7. Compaction Service（session 自身用）
interface CompactionService {
  compact(messages: UIMessage[]): Promise<CompactionResult>;
}

// === SessionState 变成组合体 ===
interface SessionState extends
  TokenBudget,
  CostTracking,
  DenialTracking,
  ModelSwitching,
  ToolOutputState,
  SessionContext,
  CompactionService {}
```

**好处：**
- `compaction` 只 import `TokenBudget`，不知道 `CostTracking` 的存在
- `agent-control/stop-conditions` 只 import `CostTracking` + `DenialTracking`
- `tools` 只 import `SessionContext` + `ToolOutputState`
- 每个接口可以独立 mock 测试
- 循环依赖的根源（所有模块都 import 完整的 SessionState）消失了

### 3.3 打破 3 个循环依赖

#### 循环 1: session-state ↔ compaction

**当前：** `session-state/state.ts` 调用 `compactBeforeStep`（从 compaction），`compaction/index.ts` 引用 `SessionState` 类型。

**修复：** 引入 `CompactionService` 接口（见 3.2），由 api/app 层注入。

```typescript
// api/app/create.ts — 组装时注入
const compactionService = {
  compact: (messages) => compactBeforeStep(messages, tokenBudget, config, modelOpts)
};
const sessionState = createSessionState(conversationId, options, compactionService);
```

**效果：** `session-state` 不再 import `compaction`。`compaction` 不再 import `session-state`（只 import `TokenBudget` 接口）。

#### 循环 2: session-state ↔ agent-control

**当前：** `session-state/types.ts` 引用 `DenialTracker` 和 `ModelSwapper`（从 agent-control），`agent-control/stop-conditions.ts` 引用 `CostTracker`（从 session-state）。

**修复：** 都改为 import 接口类型，不 import 具体实现。

```typescript
// agent-control/stop-conditions.ts
import type { CostTracking } from '../session/cost-tracking';  // 接口
import type { DenialTracking } from '../session/denial-tracking';  // 接口
import type { SessionContext } from '../session/context';  // 接口

// session/state.ts
import type { DenialTracking } from './denial-tracking';  // 本地实现
import type { ModelSwitching } from './model-switching';  // 本地实现
```

**效果：** 循环彻底打破。每个文件只依赖接口，不依赖具体实现。

#### 循环 3: tool-output-manager ↔ tool-result-storage

**当前：** `tool-output-manager.ts` 用 `await import('./tool-result-storage')` 动态导入。

**修复：** `tool-result-storage` 只 import `tool-output-manager` 的**类型**（type-only import），不 import 运行时值。TypeScript 的 type-only import 不产生运行时依赖。

```typescript
// tool-result-storage.ts
import type { PersistedToolResult, ToolOutputConfig } from './tool-output-manager';
// 删除对运行时值的 import

// tool-output-manager.ts
import { persistToDisk } from './tool-result-storage';  // 可以直接 import 了
// 删除 await import() 动态导入
```

### 3.4 移动 provider factory

**当前：** `foundation/model/provider.ts` 依赖 `@ai-sdk/openai-compatible` 和 `ai`。

**修复：** 移到 `runtime/agent/provider.ts`。

```
foundation/model/  → capabilities.ts, pricing.ts, constants.ts（纯数据，SDK 无关）
runtime/agent/provider.ts → createLanguageModel, createModelProvider（SDK 集成）
```

### 3.5 统一 Config Loader Pattern

**当前：** skills、mcp、connector、permissions 各自实现"扫描用户目录 → 扫描项目目录 → 合并 → 缓存"的逻辑。

**修复：** 在 `foundation/scanner` 中实现通用的 `MultiSourceConfigLoader<T>`：

```typescript
// foundation/scanner/multi-source-loader.ts
interface MultiSourceConfigOptions<T> {
  pattern: string;
  parse: (filePath: string) => Promise<T>;
  sourcePriority: 'project-overrides-user' | 'user-overrides-project';
  cache?: LoadingCache<T>;
}

function createMultiSourceLoader<T>(options: MultiSourceConfigOptions<T>) {
  return async function load(dirs: string[]): Promise<T[]> {
    // 统一的扫描 + 合并 + 缓存逻辑
  };
}

// api/loaders/skills.ts — 使用统一 loader
const loadSkills = createMultiSourceLoader<Skill>({
  pattern: '*.md',
  parse: (path) => parseSkillFile(path),
  sourcePriority: 'project-overrides-user',
  cache: skillsCache,
});
```

### 3.6 统一 Source 类型

**当前：** 4 个不同的 source 类型定义。

**修复：** 在 `foundation/constants.ts` 定义统一类型：

```typescript
type ConfigSource = 'builtin' | 'user' | 'project' | 'plugin';
```

### 3.7 把 `STATUS_CONFIG` 的 UI 关注点移出 core

**当前：** `runtime/tasks/types.ts` 包含 Tailwind CSS 类名。

**修复：** Core 只导出数据：

```typescript
// core (runtime/tasks/types.ts)
const STATUS_META: Record<TaskStatus, { label: string; order: number }> = {
  pending: { label: 'Pending', order: 0 },
  in_progress: { label: 'In Progress', order: 1 },
  // ...
};

// server/web — UI 层自己映射样式
const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: 'text-gray-400',
  in_progress: 'animate-spin',
  // ...
};
```

### 3.8 修复 `agent/types.ts` 的 `any`

```typescript
// 之前
agent: any;  // ToolLoopAgent

// 之后
import type { ToolLoopAgent } from 'ai';
agent: ToolLoopAgent<Record<string, any>>;

// 之前
model: any;  // LanguageModelV3

// 之后
import type { LanguageModelV3 } from '@ai-sdk/provider';
model: LanguageModelV3;
```

### 3.9 消除 `model-switching.ts` 的全局变量

```typescript
// 之前
let currentModel = '';
export function setCurrentModel(model: string): void { currentModel = model; }
export { currentModel as getCurrentModelRaw };

// 之后：删除这三个导出
// ModelSwapper 已经有 _currentModel 实例属性
// 如果外部需要读取当前模型，用 modelSwapper.getCurrentModel()
```

### 3.10 `loadAllTools` 去除重复模型包装

```typescript
// 之前：tools.ts 又包了一次
const wrappedModel = wrapLanguageModel({ model: config.model, middleware: [...] });

// 之后：config.model 已经是 wrapped 的（从 create.ts 传入）
// 直接用 config.model，删除重复包装
```

### 3.11 建立模块标准化接口

每个 extension 暴露一致的生命周期：

```typescript
interface AppModule {
  name: string;
  init?(context: AppContext): Promise<void>;
  dispose?(): Promise<void>;
  snapshot?(): unknown;  // 用于 AppContext 快照
}

// 示例：memory 模块
const memoryModule: AppModule = {
  name: 'memory',
  async init(ctx) { /* 初始化 */ },
  async dispose() { /* 清理 */ },
  snapshot() { return { entries: loadedMemory }; },
};
```

当前只有 `ConnectorRuntime` 有 `create/initialize/dispose` 模式，其他模块都是散装函数。统一后，`api/app` 的 `loadAll` 可以用统一的循环初始化和销毁。

### 3.12 修复 `persistToDB` 的 await 缺失

```typescript
// 之前（cost.ts）
async persistToDB(): Promise<void> {
  if (this._persistedToDB) return;
  this._persistedToDB = true;
  this._costStore.saveCostRecord(record);  // ← 没有 await！
}

// 之后
async persistToDB(): Promise<void> {
  if (this._persistedToDB) return;
  this._persistedToDB = true;
  await this._costStore.saveCostRecord(record);  // ← 加 await
}
```

### 3.13 修复 token-budget 的 cached tokens 计算

```typescript
// 之前
get totalTokens(): number {
  return this._sessionInputTokens + this._sessionOutputTokens;
  // cached tokens 不算，但它们确实占用上下文窗口
}

// 之后
get totalTokens(): number {
  return this._sessionInputTokens + this._sessionOutputTokens + this._sessionCachedTokens;
}
```

---

## Step 4: 加速

### 4.1 条件加载非必需模块

```typescript
// createChatAgent 中，按需加载
let memoryModule: typeof import('./memory-context') | null = null;
if (modules.memory) {
  memoryModule = await import('./memory-context');
}

let skillModule: typeof import('./skill-context') | null = null;
if (modules.skills) {
  skillModule = await import('./skill-context');
}
```

### 4.2 并行化独立的初始化步骤

```typescript
// 当前：顺序执行
const sessionState = createSessionState(...);
const skillResolution = await resolveSkills(...);
const memoryContext = await loadMemory(...);
const projectContext = await loadProjectContext(...);

// 优化：并行执行独立步骤
const [skillResolution, memoryContext, projectContext] = await Promise.all([
  modules.skills ? resolveSkills(...) : null,
  modules.memory ? loadMemory(...) : null,
  loadProjectContext(...),
]);
const sessionState = createSessionState(...);  // 依赖上面的结果
```

### 4.3 减少 console.log

当前 core 内有 16+ 处裸 `console.log`。统一用条件日志：

```typescript
// 之前
console.log(`[MCP] ${mcpSnapshot.totalTools} MCP tools available`);

// 之后
if (debugEnabled) {
  logger.debug('mcp:tools-loaded', { count: mcpSnapshot.totalTools });
}
```

---

## Step 5: 自动化

### 5.1 循环依赖检测 CI

```json
// package.json
{
  "scripts": {
    "check:circular": "npx madge --circular --extensions ts ./src",
    "check:layers": "node scripts/check-layer-deps.mjs"
  }
}
```

`check-layer-deps.mjs`：验证依赖方向只能是 Primitives → Services → Modules → Composition，任何反向依赖即失败。

### 5.2 接口隔离验证

写一个脚本检查 `SessionState` 的消费者是否只 import 了需要的接口：

```bash
# 检查 compaction 是否只 import 了 TokenBudget
grep -r "SessionState" packages/core/src/runtime/compaction/
# 如果出现完整 SessionState（而非 TokenBudget），报错
```

### 5.3 导出面积监控

```typescript
// scripts/check-export-surface.ts
const maxExports = 50;  // 硬上限
const currentExports = countExports('./src/index.ts');
if (currentExports > maxExports) {
  console.error(`Export surface: ${currentExports} > ${maxExports}`);
  process.exit(1);
}
```
