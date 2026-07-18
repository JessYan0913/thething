# 子 Agent 机制优化 — 执行计划

> 创建日期: 2026-07-18
> 前置依赖: [compaction-execution-plan.md](./compaction-execution-plan.md)（压缩管线优化已全部完成，本计划将其接入子 Agent）
> 分析来源: 对 `packages/core/src/modules/agent/` 的代码审查

## 背景

子 Agent 机制的核心架构（路由 → 执行 → 返回 summary）是正确的，但存在一个关键缺口：**执行层完全绕过了压缩/预算管线**。

父 Agent 每步 API 调用前执行完整的 `prepareStep` 管线：Layer 1（主动释放）→ Layer 2（工具输出生命周期管理）→ Layer 3（上下文窗口检查）→ budget 预算检查。这些机制在 [compaction-execution-plan.md](./compaction-execution-plan.md) 的 17 个提交中已完成全面优化。

但子 Agent 在 `executor.ts` 中创建的是裸 `ToolLoopAgent`——没有 `prepareStep` 钩子，所有压缩/预算机制对子 Agent 的内部步骤完全不可见。

## 需要了解的相关文件

实施前应通读以下文件以理解当前架构：

| 文件 | 作用 |
|---|---|
| `packages/core/src/modules/agent/agent-tool.ts` | 单子 Agent 工具入口（路由 + 执行 + 事件广播），228 行 |
| `packages/core/src/modules/agent/parallel-agent-tool.ts` | 并行多子 Agent 工具入口，443 行 |
| `packages/core/src/modules/agent/executor.ts` | 子 Agent 执行器（创建 ToolLoopAgent + 流式处理），240 行 |
| `packages/core/src/modules/agent/context-builder.ts` | 子 Agent prompt 构建（含未使用的 `buildContextPrompt`），76 行 |
| `packages/core/src/modules/agent/tool-resolver.ts` | 工具白名单/开关过滤，76 行 |
| `packages/core/src/modules/agent/model-resolver.ts` | 模型解析（inherit/fast/smart），48 行 |
| `packages/core/src/modules/agent/types.ts` | `AgentExecutionContext`、`AgentExecutionResult` 等类型定义 |
| `packages/core/src/modules/agent-control/pipeline.ts` | 父 Agent 的 `prepareStep` 管线（参考实现），251 行 |
| `packages/core/src/modules/compaction/index.ts` | `compactBeforeStep` 入口（将被接入子 Agent） |
| `packages/core/src/composition/app/create.ts` | 父 Agent 创建时如何组装 `compact` 闭包（接线参考） |

## 执行顺序总表

| 顺序 | 事项 | 优先级 | 主要改动文件 | 工作量 |
|---|---|---|---|---|
| 1 | 子 Agent 接入压缩管线 | P0 | `executor.ts`、`agent-tool.ts`、`types.ts` | 中 |
| 2 | 工具 schema 按 activeTools 裁剪 | P1 | `executor.ts` | 小 |
| 3 | 注入父对话上下文 | P1 | `executor.ts`、`context-builder.ts` | 小 |
| 4 | 简化强制摘要逻辑 | P1 | `executor.ts` | 小 |
| 5 | 加 token 预算上限 | P2 | `executor.ts`、`types.ts` | 小 |
| 6 | 并行子 Agent 同步接入 | P2 | `parallel-agent-tool.ts` | 小 |

## 各步骤详情与验收标准

### 步骤 1: 子 Agent 接入压缩管线（P0）

**现状**：`executor.ts:68-74` 创建裸 `ToolLoopAgent`：

```typescript
const subAgent = new ToolLoopAgent({
  model,
  instructions,
  tools: context.parentTools,
  activeTools,
  stopWhen,
  // 没有 prepareStep
});
```

**目标**：子 Agent 每步 API 调用前执行 Layer 2 压缩（工具输出生命周期管理），Layer 3（LLM 摘要）在子 Agent 中默认关闭（子上下文短，不需要）。

**实现要点**：

1. `AgentExecutionContext`（`types.ts`）需要新增两个可选字段：
   - `compactionConfig?: CompactionConfig` — 压缩配置（从父 Agent 传入）
   - `sessionState?: SessionState` — 共享 session state（token budget、校准系数等）。如果不可用则回退到无管线行为。

2. `AgentToolConfig`（`types.ts`）同样需要新增这两个可选字段（在 `createAgentTool` 中传入 context）。

3. `executor.ts` 创建 `ToolLoopAgent` 时，如果 context 中有这些字段，传入 `prepareStep`：

```typescript
const subAgent = new ToolLoopAgent({
  model,
  instructions,
  tools: context.parentTools,
  activeTools,
  stopWhen,
  ...(context.sessionState && context.compactionConfig
    ? {
        prepareStep: createSubAgentPrepareStep(
          context.sessionState,
          context.compactionConfig,
        ),
      }
    : {}),
});
```

4. `createSubAgentPrepareStep` 是一个轻量函数（可以放在 `executor.ts` 或新文件），只做 Layer 2：

```typescript
function createSubAgentPrepareStep(
  sessionState: SessionState,
  compactionConfig: CompactionConfig,
): PrepareStepFunction {
  return async ({ messages }) => {
    // 只做 Layer 2（同步，微秒级），不做 Layer 3（子 Agent 上下文短）
    const { manageToolOutputLifecycle } = await import('../compaction/lifecycle');
    const result = manageToolOutputLifecycle(
      messages,
      compactionConfig.lifecycle,
      // 子 Agent 不接 storage —— 落盘只对父 Agent 上下文有意义
    );
    return {
      messages: result.messages,
      continue: true,
    };
  };
}
```

**关键设计决策**：
- Layer 3 不在子 Agent 中启用。子 Agent 最多 20 步，上下文远小于父 Agent。LLM 摘要调用有延迟和成本，对子 Agent 的内部步骤来说不值得。
- `keepRecentSteps` 对子 Agent 可以用默认值 3，或更激进的 2。不需要单独配置——直接用 `compactionConfig.lifecycle` 即可。
- 如果 `context.sessionState` 不可用（某些脚本/测试调用路径），回退到当前无管线行为——`prepareStep` 是可选的。

**接线路径**：在 `createAgentTool`（`agent-tool.ts`）的 `execute` 中，`AgentExecutionContext` 构建时传入 `config.sessionState` 和 `config.compactionConfig`。需要确认这两个字段已在 `AgentToolConfig` 中声明。

**验收**：
- 创建测试：一个子 Agent 执行 5 步 read_file（每步读一个大文件），验证第 4、5 步时的消息列表已被 Layer 2 压缩（旧工具输出被替换为元信息）。
- 既有子 Agent 测试不回归。
- 如果 `sessionState` 未提供，行为与当前完全一致。

---

### 步骤 2: 工具 schema 按 activeTools 裁剪（P1）

**现状**：`executor.ts:71` 把 `context.parentTools`（父 Agent 所有工具，可能 50+）完整传入 `ToolLoopAgent` 的 `tools` 参数。AI SDK 每步都会序列化所有工具的 schema 发给模型。

**目标**：只传 `activeTools` 指定的子集。如果 `activeTools` 为 `undefined`（表示使用所有工具），则保持传全量。

**实现要点**：在 `executor.ts` 中，`resolveToolsForAgent` 调用之后：

```typescript
const activeToolSet = resolveToolsForAgent(definition, context);
const subAgentTools = activeToolSet
  ? Object.fromEntries(
      Object.entries(context.parentTools).filter(([name]) =>
        activeToolSet.includes(name),
      ),
    )
  : context.parentTools;
```

然后将 `subAgentTools` 传给 `ToolLoopAgent` 的 `tools` 参数。

**注意**：`activeTools` 返回的是工具名数组，但 `context.parentTools` 的键可能与 `activeTools` 中的命名不完全一致（如 snake_case vs 首字母大写）。需要确认 `resolveToolsForAgent` 返回的名称与 `parentTools` 的键对齐。如果不一致，需要加一层名字归一化。

**验收**：
- research Agent（`tools: ['web_fetch', 'read_file', 'grep', 'glob']`）只收到 4 个工具 schema。
- general-purpose Agent（无工具白名单）仍然收到全量工具。

---

### 步骤 3: 注入父对话上下文（P1）

**现状**：`context-builder.ts` 中 `buildContextPrompt` 函数已定义但从未被调用。`buildSubAgentPrompt` 接收 `_context` 参数但以 `_` 前缀忽略。子 Agent 拿到一句孤立的 task 字符串，不知道父对话在讨论什么。

**目标**：在 `executeRoutedAgent` 中将父对话上下文注入子 Agent 的 task prompt。

**实现要点**：

1. 在 `executor.ts` 的 `executeRoutedAgent` 中，用 `buildContextPrompt` 包装 task：

```typescript
// 原代码
const initialPrompt = task;

// 改为
const initialPrompt = buildContextPrompt(context, task, 6);
```

2. `buildContextPrompt`（`context-builder.ts:39-56`）取 `context.parentMessages` 的最近 6 条做简短摘要，注入 task 前面。这个函数无需修改——它的逻辑已经正确，只是从未被调用。

3. 注意：`context.parentMessages` 在 `agent-tool.ts:120` 已经赋值（`parentMessages: config.parentMessages`），值是父 Agent 对话的完整消息历史。

**验收**：
- 子 Agent 收到的 prompt 包含父对话最近消息的摘要。
- 如果 `parentMessages` 为空数组，`buildContextPrompt` 输出 "No recent conversation context available."，不报错。

---

### 步骤 4: 简化强制摘要逻辑（P1）

**前置条件**：步骤 1 完成。

**现状**：`executor.ts:147-183`（约 40 行）实现了一个兜底逻辑——当子 Agent 调用了工具但没产出文字时，再跑一次 Agent（禁用所有工具）专门写摘要。

**目标**：压缩管线运行后，工具结果已被替换为结构化元信息（如 `Read foo.ts → 120 lines`），不需要二次摘要。可以简化这段逻辑。

**实现要点**：将 `executor.ts:147-183` 的强制摘要逻辑改为直接使用 fallback 摘要（第 186-188 行已存在）：

```typescript
// 原逻辑：if (!textContent && stepsExecuted > 0) { 二次 Agent 调用... }
// 简化为：如果压缩管线已运行，直接走 fallback
const fallbackSummary = stepsExecuted > 0
  ? `Agent completed ${stepsExecuted} steps using ${[...new Set(toolsUsed)].join(', ')}. No text summary was produced.`
  : 'Agent completed with no text output.';
```

**如果不想完全删除**（保守方案）：保留二次摘要调用，但只在压缩管线**未**启用时走这条路（`if (!context.sessionState)`）。

**验收**：
- 子 Agent 无文本输出时，summary 是有意义的 fallback 文本（非空）。
- 如果选择完全删除：executor.ts 减少约 35 行代码。

---

### 步骤 5: 加 token 预算上限（P2）

**现状**：只有 `isStepCount(20)` 限制步数。单步大输出没有限制，也没有总 token 预算。

**目标**：加一个总 token 预算上限（如 200k），超出后子 Agent 停止执行。

**实现要点**：

1. 在 `AgentToolConfig`（`types.ts`）中新增可选字段 `maxTotalTokens?: number`，默认值建议 200_000。

2. 在 `executor.ts` 流式处理循环中，累积 token 消耗。可以在 `tool-result` 事件中累计 `result.length` 作为估算（走 CJK 校准的 `estimateTokensFromChars`），或利用 `streamResult.usage` 的渐进式更新（如果 AI SDK 支持）。

3. 超出预算后，停止处理流（可标记 `aborted = true`），返回已收集的内容 + 截断提示。

```typescript
let estimatedTokens = 0;
const MAX_TOKENS = context.maxTotalTokens ?? 200_000;

for await (const part of streamResult.stream) {
  if (part.type === 'tool-result') {
    estimatedTokens += estimateTokensFromChars(/* part.output */);
    if (estimatedTokens > MAX_TOKENS) {
      // 停止处理，返回截断结果
      break;
    }
  }
  // ...原有处理逻辑
}
```

**验收**：
- 超预算后子 Agent 产出截断结果（而非无限执行）。
- 未配置预算上限时行为与当前一致。

---

### 步骤 6: 并行子 Agent 同步接入（P2）

**现状**：`parallel-agent-tool.ts` 通过 `Promise.allSettled` 并行调用 `executeSingleTask`，每个子任务都走 `executeRoutedAgent`。

**目标**：确保步骤 1-4 的改动自动覆盖并行路径（因为 `executeSingleTask` 内部也调用 `executeRoutedAgent`），无需重复实现。

**验证要点**（非改动，只是确认）：
- `executeSingleTask`（`parallel-agent-tool.ts:312`）构建 `AgentExecutionContext` 时是否也传入了 `sessionState` 和 `compactionConfig`。
- 并行场景下多个子 Agent 共享同一个 `sessionState` 是否安全（如 `contentReplacementState` 的并发写）——如不安全，每个并行子任务需要独立的 replacement state。

**验收**：
- 并行执行 3 个 research Agent，每个的内部步骤都有 Layer 2 压缩。
- 既有并行 Agent 测试不回归。

---

## 实施约定

- 每步完成后更新执行顺序总表的"状态"列。
- 每步以"验收标准通过 + 既有测试(`agent/__tests__`、`compaction/__tests__`)不回归"为完成定义。
- 步骤 1-4 每步单独提交，便于回溯。
- 步骤 1 是关键前置——它打通了子 Agent 到压缩管线的路径，后续步骤都基于此。
- 所有改动向后兼容：如果 `sessionState`/`compactionConfig` 不可用，回退到当前行为。

## 测试文件位置

- `packages/core/src/modules/agent/__tests__/` — 子 Agent 测试
- `packages/core/src/modules/compaction/__tests__/` — 压缩管线测试（参考：`compaction.test.ts` 33 tests, `value-aware.test.ts` 6 tests, `lifecycle-storage.test.ts` 2 tests）

## 相关文档

- [compaction-execution-plan.md](./compaction-execution-plan.md) — 已完成的压缩管线优化（18 个提交，步骤 1-8 全部 ✅）
- [context-compaction-analysis.md](./context-compaction-analysis.md) — 压缩/预算机制分析（主文档）
- [built-in-tools-compaction-analysis.md](./built-in-tools-compaction-analysis.md) — 内置工具与压缩层适配分析
