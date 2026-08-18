# TheThing 代码侦察报告

> 侦察时间：2026-08-18
> 侦察方式：`pwd`/`ls`/`git log`/`glob`/`grep` + 核心文件精读

## 1. 项目概况

- **项目**：TheThing —— 一个基于 TypeScript 的通用智能 Agent 编排 / 执行系统。
- **工作目录**：`tsconfig.json` + `docs/` 位于根目录，源码集中在 `packages/core`。
- **代码规模**：`packages/**/*.ts` 匹配到 10044 个文件（绝大多数为 `node_modules` 依赖）；`packages/core/src/**/*.ts` 为实际源码，约 418 个文件。
- **技术栈**：依赖 Vercel AI SDK（`ai`，使用 `ToolLoopAgent` / `generateText` / `PrepareStepFunction`）、`@ai-sdk/provider`、`@ai-sdk/openai`。

## 2. 最近提交 / 当前开发主线

```
c731130 feat(compaction): 落地设计团队裁决——单完成约束 + failed 不归档 + 可观测性上抛 + 死代码清理
```

近期工作是 **Task Paradigm Redesign（任务范式重构）** 的落地，核心围绕：

1. **子任务归档（Subtask Archiving）** —— 子任务完成时提炼结构化 facts 写入 todo 元数据。
2. **子任务独立上下文重建** —— 每完成一个子任务，在 `prepareStep` 边界重建干净上下文（索引池 + 当前子任务 + 读回指针），不继承上一子任务的原始日志。
3. **可观测性上抛** —— 通过 `compactionCallbackRef` 流式通知前端 `task_split` / `archiving_failed` / `index_pool_updated` 等事件。
4. **死代码清理** —— 对应架构决策、删除不再需要的旧路径。

涉及的关键目录：`packages/core/src/modules/agent-control/`（pipeline、archiver、plan-prompt、context-builder、splitter）、`packages/core/src/modules/agent/`（executor、tool-resolver、model-resolver、context-builder）。

## 3. 最重要的 3 个文件分析

### 3.1 `packages/core/src/modules/agent-control/pipeline.ts`（434 行）— 编排主干

**职责**：实现 `createAgentPipeline()`，返回一个 `PrepareStepFunction`，在每次工具循环的 API 调用前被 SDK 回调。这是主 Agent 的核心执行管线，承担了状态机驱动的压缩、归档、上下文重建。

**关键机制（PrepareStep 每步流程）**：

- **压缩状态机 tick**：`sessionState.compactionTracker.tickStep(stepNumber)` 每步触发，让 `justCompacted` 标志自动回 `idle`。
- **归档失败重试**：若上一轮归档失败的子任务缓存在 `pendingArchiveRetries`，本步先调用 `retryPendingArchives` 重试（**最多重试一次**；仍失败则上抛 `archiving_failed` 事件并跳过，保留 result）。
- **子任务边界重建**（Task Paradigm Redesign §4，本文件核心逻辑）：
  1. 检测 `pendingArchiveTodoId`（由 todo-write 标记 completed/failed 时设置）。
  2. **先归档**：用 `messages.slice(subtaskStartMessageIndex)` 的旧消息切片调用 `archiveSubtask` 提炼 facts 写入 todo；必须在重建**之前**完成（重建后旧消息即被替换）。
     - 归档成功 → 从 `pendingArchiveRetries` 中删除；首败 → 缓存渲染文本入队待下一轮重试。
  3. **重建上下文**：`buildSubtaskContext(todos)` 生成干净索引池 + 当前子任务 + 读回指针，重置 `subtaskStartMessageIndex`。
  4. **预算预检 + 就地拆分**：若新子任务上下文已超触发线（`shouldTrigger`），说明子任务本身过大，调用 `splitTodo` 拆成多个，重建指向第一个新子任务，并上报 `task_split` 事件。
- **提示注入**：step 0 且 todos 为空时注入 `buildPlanPrompt()`；非首步且有活跃 todo 时注入 `buildTodoSyncReminder()`（防止模型"只开工不跟进"）。
- **usage 真值校准配对**：上一步估算 ↔ 本步真实 usage 配对，喂给 `recordUsageSample` 用于 tokenizer 校准。

**预算闸门（Gate）**：含校准 buffer 的总量超过窗口上限才**拒绝**（`CONTEXT_BUDGET_EXCEEDED`）；达触发线则由 `manageCompaction` 负责升档压缩。提供了 `formatContextBar` 可视化水位。

### 3.2 `packages/core/src/modules/agent/executor.ts`（302 行）— 子 Agent 执行器

**职责**：`executeRoutedAgent()` 执行路由后的（子）Agent，创建 `ToolLoopAgent` 并流式处理输出。

**关键机制**：

- **子 Agent 构造**：默认 20 步（`SUB_AGENT_MAX_STEPS`）+ 可选 token 预算停止条件 `isTokenBudgetExceeded`。使用**父级穿下来的 tools**（`context.parentTools`）+ 自身 `activeTools`。
- **Layer 2 压缩**：`createSubAgentPrepareStep` 每个 API 调用前通过 `manageToolOutputLifecycle` 将旧工具输出替换为结构化元信息（同步、微秒级）。**不做 Layer 3（LLM 摘要）**——子 Agent ≤20 步上下文短，额外 LLM 调用不值得。**不传 storage**——落盘找回只对父 Agent 有意义。
- **流式配对**：子流内部用 `stepSeqByCallId`（toolCallId → 步骤序号）将 tool-result 与 tool-call 配对（一个 step 可能并行发起多个 tool-call）；step 事件用唯一 id `` `${toolCallId}#${seq}` ``（SDK 对同 type+同 id 的 data part 是替换语义，共用 id 会导致前端只剩最后一步）。
- **checkpoint**：每完成一步 `updateRun` 记录 stepCount / accumulatedText / toolsUsed，供进程崩溃后诊断。
- **强制摘要（最后防线）**：当子 Agent 有工具调用但**无文本输出**时，追加一次无工具的 LLM 调用，基于收集的 tool 结果写总结，避免父 Agent 只拿到 "completed N steps" 的零信息 fallback。总结调用 token 也计入统计。
- **完成任务（路径 B）**：`completeTodo` **同步**写库（消除 fire-and-forget 竞态，确保 todo 状态在父 Agent 下一步 prepareStep 前落地）；随后 `triggerArchiveForTodos` 以 `metadata.result` 入队归档重试（parallel_agent 与本路径共用这一接线点）。

### 3.3 `packages/core/src/modules/agent-control/archiver.ts`（280 行）— 子任务归档器

**职责**：Task Paradigm Redesign §5 —— 子任务完成时，在 prepareStep 边界用消息切片调 LLM 提炼结构化 `{tool_chain, conclusion, key_facts}`，写入 `todo.metadata.facts`（**不改 result 字符串**）。

**关键机制**：

- **`renderSubtaskText`**：从消息切片渲染可读文本（assistant 文本 + tool 输出），供摘要 LLM 阅读。
- **严格 JSON 约束**：`ARCHIVE_PROMPT` 要求 LLM 只输出单个 JSON 对象（无 markdown 围栏、无前后缀）。`parseFactsJson` 通过剥围栏 + 提取 `{`…`}` 中间子串做**双候选容忍解析**，校验 `tool_chain`/`conclusion` 为 string 才通过。
- **失败归类（可观测性）**：`classifyApiError` 将 LLM 异常归类为 `empty_input` / `empty_response` / `invalid_response` / `quota_exceeded` / `timeout` / `api_error`，便于区分配额/超时/格式问题。
- **同步 await（checkpoint 竞态教训）**：归档是同步等待的（曾经有过 checkpoint 竞态 bug）。
- **`archiveSubtask`**：提炼 facts 成功则 `store.updateTodo` 写入；失败记 `archiving_failed` 告警、**跳过写 facts**（避免不完整 facts 污染索引池），只保留 result。
- **`triggerArchiveForTodos`**：并行完成路径的归档入口——并行子任务的结论由 executor 写入 `metadata.result`（父上下文没有其消息切片），此函数以 result 为输入入队 `pendingArchiveRetries`，下一轮 prepareStep 走与线性任务相同的 LLM 提炼路径（设计决策 Q1）。内部过滤：仅 `completed` + 有 result + 无 facts 才入队。

## 4. 关键设计决策与架构要点

1. **归档失败不阻塞主流程，且结果不丢失**：失败只跳过 facts，保留 result 字符串；首败缓存入队最多重试一次，重试也失败才上抛 `archiving_failed` 事件。
2. **归档 vs 上下文重建的顺序约束**：归档必须在重建前完成（重建后旧消息切片即被替换）——这是顺序敏感的设计核心。
3. **任务过大则就地拆分**：新子任务上下文在 prepareStep 内预检，超触发线就 `splitTodo` 原子拆分（拆不动则交还现有 budget gate 处理）。
4. **同步完成消除竞态**：`completeTodo` 同步写库，避免 fire-and-forget 导致父 Agent 读到过期 todo 状态。
5. **父子上下文隔离**：子 Agent 用消息切片的 LLM 摘要 + `metadata.result` 作为事实传递载体，不继承父上下文原始日志（索引池机制）。

## 5. 待办与风险提示

- `packages/core/src` 中仍有大量 TODO/FIXME 标记（全仓 4257 处匹配，需按目录过滤）。
- 归档流程每子任务边界新增一次 LLM 调用（成本已记录在案），配额耗尽时通过失败归类降级为保留 result——需关注配额下的降级路径覆盖。
- executor 中强制摘要（无文本时追加 LLM 调用）是一条较高成本的兜底路径，但可防止信息丢失，值得保留。

## 6. 建议下一步

- 按目录过滤 TODO/FIXME（排除 node_modules），定位真正的技术债。
- 审阅 `splitter.ts`（就地拆分）与 `rebuild` 上下文在极端超限场景下的边界行为。
- 核对归档失败降级路径（配额/超时）在真实运行中的触发与可观测性上报是否完备。
