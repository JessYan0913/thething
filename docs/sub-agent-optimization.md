# 子 Agent 机制分析与优化空间

> 分析日期: 2026-07-18
> 分析范围: `packages/core/src/modules/agent/`（agent-tool、executor、parallel-agent-tool、context-builder、tool-resolver、model-resolver）
> 关联文档: [context-compaction-analysis.md](./context-compaction-analysis.md)（压缩管线刚完成全面优化，但子 Agent 未接入）

## 结论先行

子 Agent 机制的核心设计——路由 → 执行 → 返回 summary——是正确的，但**执行层完全绕过了父 Agent 的压缩/预算管线**。这导致一个 research 子 Agent 的 20 步工具调用可以在上下文里堆出数百 KB 的原始输出而没有任何生命周期管理。而我们刚完成的压缩管线（[compaction-execution-plan.md](./compaction-execution-plan.md)，17 个提交）恰好解决了这些问题——只是从未被子 Agent 使用。

改动建议：接线为主，不做架构重写。

---

## 一、现状架构

```
主 Agent 调用 agent 工具
        │
        ▼
  createAgentTool (agent-tool.ts)
        │
        ├─ resolveAgentRoute (router.ts) ── 自动路由或按 agentType 选择
        ├─ executeRoutedAgent (executor.ts)
        │       │
        │       ├─ resolveToolsForAgent (tool-resolver.ts)
        │       ├─ resolveModelForAgent (model-resolver.ts)
        │       ├─ buildSubAgentPrompt (context-builder.ts)
        │       └─ new ToolLoopAgent({ tools: parentTools, activeTools, stopWhen })
        │               │
        │               └─ subAgent.stream() ── 最多 20 步
        │                       │
        │                       ├─ 每步: 无 prepareStep 钩子
        │                       ├─ 无预算检查
        │                       └─ 无压缩
        │
        └─ toModelOutput → result.summary
```

关键调用链：

| 步骤 | 文件 | 行号 | 说明 |
|---|---|---|---|
| 工具执行入口 | `agent-tool.ts` | 75-192 | 路由 + 执行 + 错误处理 + 事件广播 |
| 子 Agent 创建 | `executor.ts` | 68-74 | 裸 `ToolLoopAgent`，无 `prepareStep` |
| 工具解析 | `tool-resolver.ts` | 29-69 | 白名单/开关过滤，输出 `activeTools` |
| 模型解析 | `model-resolver.ts` | 19-48 | inherit/fast/smart/具体模型名 |
| Prompt 构建 | `context-builder.ts` | 10-29 | 只用 definition.instructions，忽略上下文 |
| 上下文注入 | `context-builder.ts` | 39-56 | `buildContextPrompt` **定义但从未被调用** |
| 并行执行 | `parallel-agent-tool.ts` | 69-290 | `Promise.allSettled` 模式，每个子任务走同一 executor |

---

## 二、六个设计问题

### 1. 子 Agent 完全没有压缩/预算管线（P0，影响最大）

`executor.ts:68-74` 创建的是裸 `ToolLoopAgent`——没有 `prepareStep` 钩子：

```typescript
// executor.ts:68
const subAgent = new ToolLoopAgent({
  model,
  instructions,
  tools: context.parentTools,  // 全量父工具
  activeTools,                 // 但只允许调用这些
  stopWhen,                    // 只有步数限制，无预算限制
  // 没有 prepareStep → 每步无 Layer 1/2/3 压缩，无 budget check
});
```

父 Agent 的 `prepareStep` 管线（[pipeline.ts](../packages/core/src/modules/agent-control/pipeline.ts)）每步执行 Layer 1（主动释放）→ Layer 2（生命周期）→ Layer 3（上下文窗口）→ budget 预算检查。子 Agent 完全绕过这一层。

**后果**：一个 research 子 Agent 做 20 步 grep/read_file/web_fetch，每步的输出完整堆积在上下文里——没有任何压缩、老化、或预算闸门。这恰恰是我们刚修复的全部问题的重灾区。

### 2. `parentTools` 全量传入但子 Agent 只需子集（P1）

`executor.ts:71` 把 `context.parentTools`（父 Agent 所有工具，实测 50+）作为 `tools` 参数传入 `ToolLoopAgent`。虽然 `activeTools`（由 `tool-resolver.ts` 计算出）限制哪些工具可被调用，但 **AI SDK 仍会将 `tools` 参数中所有工具的 schema 序列化进每次 API 请求**。

对 research Agent（4 个工具：`web_fetch`、`read_file`、`grep`、`glob`）来说，其他 46+ 个工具 schema 每步都作为 token 开销白白发送。按每个工具 schema 约 200-500 tokens 估算，20 步的浪费在 80k-200k tokens 量级。

### 3. `buildContextPrompt` 存在但从未被调用（P1）

`context-builder.ts:39-56` 定义了 `buildContextPrompt`：

```typescript
export function buildContextPrompt(
  context: AgentExecutionContext,
  task: string,
  maxMessages: number = 6,
): string {
  const recentMessages = context.parentMessages.slice(-maxMessages);
  const summary = summarizeMessages(recentMessages);
  return `## Previous Conversation Context\n\n${summary}\n\n---\n\n## New Task\n\n${task}`;
}
```

它从 `context.parentMessages` 取最近 6 条父对话摘要，注入子 Agent 的 prompt。但搜索整个代码库，**没有任何地方调用它**。

同时 `buildSubAgentPrompt` 接收 `_context` 参数却完全不使用（`_` 前缀表示有意忽略）：

```typescript
export function buildSubAgentPrompt(
  definition: AgentDefinition,
  _context: AgentExecutionContext,  // ← 接收但不使用
): string {
  let prompt = definition.instructions;
  // ...只加了工具名和输出指导
  return prompt;
}
```

**后果**：子 Agent 拿到一句孤立的 task 字符串，完全不知道用户在做什么、前面的对话讨论了什么。这导致子 Agent 经常"重复劳动"——用户和父 Agent 已经讨论过的信息，子 Agent 又从头查找一遍。

### 4. "强制摘要"是基于 Workaround 的补救（P1）

`executor.ts:147-183` 有一个复杂的兜底逻辑：

```
if (!textContent && stepsExecuted > 0) {
  // 子 Agent 调用了工具但没产出任何文字
  // → 再跑一次 Agent，专门写摘要（禁用所有工具）
}
```

这是对**第 1 个问题的 Workaround**：正常流程下，如果压缩管线已运行，工具结果会被替换为结构化元信息——不需要这个二次摘要。如果接入 `compactBeforeStep`，这个 40 行的兜底逻辑可以简化为一个断言。

### 5. 子 Agent 结果回到父 Agent 后不老化（P2）

`AgentExecutionResult.summary` 作为 tool-result 回到父 Agent。

- 我们在 8.8 中加了 budget 持久化（50k 字符以上落盘可找回），超大子报告不再挤占上下文
- 但正常大小的子 Agent 报告仍依赖 step 老化控制
- 从父 Agent 视角看，一次子 Agent 调用只产生**一个** tool-result（一个 step），而 step 老化的默认 `keepRecentSteps=3` 意味着最近的 3 个子 Agent 结果都会完整保留
- 要触发正常大小的子 Agent 报告老化，需要更多次后续工具调用把边界推过去

### 6. 无 token 预算上限（P2）

只有 `isStepCount(20)` 限制步数。

- 一步 grep 返回 10k 行就能单步消耗大量 token
- 没有单步 token 限制、没有总 token 预算
- 没有异常模式检测（如死循环调用同一个工具）

---

## 三、与已完成压缩优化的联动

我们刚在 [compaction-execution-plan.md](./compaction-execution-plan.md) 中完成的所有优化，恰好解决了子 Agent 的大部分问题——但前提是**子 Agent 接入了这些管线**：

| 压缩优化 | 对应子 Agent 问题 | 接入方式 |
|---|---|---|
| Layer 2 步数老化 (step 6) | 问题 1 | `prepareStep` 接线 |
| Layer 2 落盘可恢复 (step 7) | 问题 1 | `prepareStep` 接线 |
| Layer 3 上下文窗口 (step 3) | 问题 1 | `prepareStep` 接线 |
| 价值感知压缩 (8.3) | 问题 1 | `prepareStep` 接线 |
| usage 反馈校准 (8.2) | 问题 6 | `prepareStep` 接线 |
| budget 持久化 (8.8) | 问题 5 | 已接线（静态阈值） |
| CJK 校准估算 (8.1) | 问题 1,6 | `prepareStep` 接线 |

---

## 四、优化建议（按优先级）

### P0: 给子 Agent 接入 `compactBeforeStep` 管线

**改动文件**: `executor.ts`、可能的 `agent-tool.ts`

**方案**: 在 `ToolLoopAgent` 创建时传入 `prepareStep` 钩子，复用父 Agent 的压缩管线。

```typescript
// executor.ts 改动示意
const subAgent = new ToolLoopAgent({
  model,
  instructions,
  tools: context.parentTools,
  activeTools,
  stopWhen,
  prepareStep: createSubAgentPipeline({
    sessionState: context.sessionState,  // 共享 session state
    compactionConfig: context.compactionConfig,
    // ...其他管线参数
  }),
});
```

**关键设计决策**:
- 子 Agent 是否共享父 Agent 的 `sessionState`（token budget、校准系数等）？建议共享——子 Agent 的 token 消耗理应计入总预算。
- Layer 3（LLM 摘要）是否在子 Agent 管线中启用？建议关闭——子 Agent 上下文远小于父 Agent，且摘要结果是父 Agent 需要的原始工作产物。

**收益**: 子 Agent 内部步骤自动开始压缩，消除问题 1 和问题 4 的根因。这是接线工作而非新开发——父管线已经完备。

### P1: 工具 schema 按 `activeTools` 裁剪传入

**改动文件**: `executor.ts:71`、`tool-resolver.ts`

**方案**: 不传 `parentTools` 全集，只传 `activeTools` 过滤后的子集。

```typescript
// executor.ts 改动示意
const activeToolSet = resolveToolsForAgent(definition, context);
const filteredTools = activeToolSet
  ? Object.fromEntries(
      Object.entries(context.parentTools).filter(([name]) => activeToolSet.includes(name))
    )
  : context.parentTools;

const subAgent = new ToolLoopAgent({
  tools: filteredTools,  // 只传子 Agent 实际使用的工具
  activeTools: activeToolSet,
  // ...
});
```

**收益**: research Agent（4 工具）每步省 40+ 工具 schema 的 token 开销，20 步省 80k-200k tokens。

### P1: 调用 `buildContextPrompt` 或删除它

**改动文件**: `context-builder.ts`、`executor.ts`

**方案 A（推荐）**: 在 `executeRoutedAgent` 中调用 `buildContextPrompt`，将父对话上下文注入子 Agent 的 task prompt。

```typescript
// executor.ts 改动示意
const contextualizedTask = buildContextPrompt(context, task, 6);
```

**方案 B**: 如果认为子 Agent 不应该知道父上下文（隔离性优先），删除 `buildContextPrompt` 函数和 `AgentExecutionContext.parentMessages` 字段，消除死代码。

**收益（方案 A）**: 子 Agent 不再盲飞——知道用户在讨论什么、已经得出了什么结论，避免重复劳动。

### P2: 加 token 预算上限

**改动文件**: `executor.ts`、`agent-tool.ts`

**方案**: 在 `AgentToolConfig` 中增加 `maxTotalTokens` 配置，在流式输出中累计 token 数，超过阈值后停止。

**收益**: 防止单步大输出吃掉全部预算。

### P3: 简化强制摘要逻辑

**改动文件**: `executor.ts:147-183`

**前置条件**: P0 完成后

**方案**: 压缩管线运行后，工具结果已被替换为结构化元信息。若 `!textContent`，直接走 fallback 摘要（已有）而不需要再跑一次 Agent。

**收益**: 删掉 40 行 workaround 代码，减少一次额外的 API 调用。

---

## 五、实施建议

1. **P0 + P1（工具裁剪 + 上下文注入）可以一批做**，改动集中在 `executor.ts` + `context-builder.ts` + `pipeline.ts`（如果子管线需要独立配置）。
2. **子管线配置**: 建议新增 `SubAgentPipelineConfig`，默认关闭 Layer 3（LLM 摘要），Layer 2 keepRecentSteps 设为更激进的值（如 2 而非 3），因为子 Agent 上下文更短。
3. **测试策略**: 优先测试 research Agent 场景（最长步数、最多工具调用），验证压缩后的上下文体积变化。
4. **向后兼容**: P0 的 `prepareStep` 是可选的——如果 `context.sessionState` 不可用（如某些测试/脚本调用路径），回退到当前无管线行为即可。
