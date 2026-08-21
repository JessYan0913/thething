# 实施阶段与验收

> 从旧机制到新机制的落地顺序。每阶段独立可验收(测试绿 + 类型检查过)。

## 总验收

- `cd packages/core && npx tsc --noEmit` 通过
- core 全量测试通过
- 一个「长跑回归用例」(30 步任务:不中断、子任务不乱、跑完终态正确、二次 run 正常收尾)绿

---

## Phase A — 收尾器确定性化(run-finalization)

**目标**:删除模块级 guard 泄漏;删除收尾 LLM 审问;新增确定性 in_progress 回卷。

改动:
- `run-finalization.ts`:
  - 删除 `finalizedConversations` Set + guard + `clearFinalizedGuard`。
  - 删除 `settleInProgressTodos` 调用;同时从 `FinalizeRunOptions` 移除 `model / todoWriteTool / pushTodoUpdate`。
  - 新增**机器回卷规则**:run 结束后仍有 `in_progress` 的 todo → 确定性置回 `pending`,
    写 `metadata.execution.interruptedAt / interruptedByRun`。
- 调用方参数清理:`route.ts`(3 处)、`suspended-approval-response/route.ts`(2 处)、`agent-handler.ts`(4 处)。

**验收**:第二次 run 在同一进程正常收尾;`exhausted/aborted` 的 agent_runs 落正确的终态;没有 settle LLM 调用。

## Phase B — prepareStep 收敛成一块画布(One Loop / One Canvas)

| 目标 | 删除全部 per-step 辅导注入与子任务边界重建;闸门改为受控终止。 |
|---|---|

**pipeline.ts**:
- 删除:归档重试块、子任务整段重建块、预算预检拆单块、step0 规划/同步/空清单注入、每步同步提醒、水位提示、goal 续跑注入、推理空转催逼、Completion Audit 注入。
- 闸门:`exceedsLimit` 不再 `throw`,置 `sessionState.exhaustedFlag = 'context_budget'`,返回 `continue:false`。
- 保留:白板注释 & 画布注入(唯一注入)、`compactBeforeStep`、deny 硬停。
- 画布注入逻辑保留现有触发时机(revision 变化 / 压缩后 / 连续 5 步无变更),拼入 goal 客观句。

**接线收敛**:
- `session/state.ts`、`session/types.ts`、`session/interfaces.ts`: 删除 `pendingArchiveRetries / pendingArchiveTodoId / subtaskStartMessageIndex / enableSubtaskArchiving / completionAuditInjected / consecutiveReasoningOnlySteps / stepsSinceTodoMutation / lastTodoRevision`;新增 `exhaustFlag?: 'context_budget' | 'adaptive'`。
- `agent/tools.ts`: 删除 onTodoCompleted 接线(94)、pendingArchiveRetries 传入(175)。
- `agent/executor.ts`: 删除 path B triggerArchive、`pendingArchiveRetries` 依赖。
- `agent/types.ts` / `agent-tool.ts` / `parallel-agent-tool.ts`: 删除 pendingArchiveRetries 字段与传入。
- `todos/todo-runtime.ts` / `todo-tools/index.ts` / `todo-write-tool.ts`: 删除 onTodoCompleted 参数与 pendingArchiveRetries 依赖;删除 `notifyTodoCompleted`。
- `create.ts`: 删除 pendingArchiveRetries 求值(297)。
- 孤儿模块删除:`archiver.ts`、`splitter.ts`、`plan-prompt.ts`、`completion-audit.ts`、`context-builder.ts`(agent-control/)及各自测试。

**验收**:run 中间无任何"劝导"注入;子任务完成后模型继续思考链完整;文档闸门从不抛异常。

## Phase C — todo 写语义:patch → 单 `todo` 工具(已完成,被事件化重构吸收)

**目标**:废除 true-replace 自动取消;最终收敛为单 `todo` 工具(action: list|add|update|delete|clear)。

- `todo-write-tool.ts`:先删 Phase 3 true-replace 循环,schema/description 改"patch + 显式 cancel"语义。
- **后续(事件化快照重构,见 docs/todos-lite.md §5.5)**:`todo_write` 与 `todo_create_batch`/`todo_delete`/`todo_merge` 全部退役,
  收敛为单 `todo` 工具;`update` 按稳定编号 `#N` patch(含 claim/complete/fail 状态流转),`clear` 显式清空。
  `renderIndexedActiveList` 改由 `todo` 工具回执与画布共用。
- 相关测试更新(`todo-write` 相关与 `todo-runtime` 中依赖 true-replace 的用例)。

**验收**:update 只 patch 引用的编号项;未提及 todo 保持活跃;显式 delete/clear 可用;编号永不复用。

## Phase D — 闸门语义(已在 A/B 内完成)

闸门从"抛异常杀流"改为"受控 exhausted"：在 A(收尾)+ B(prepareStep) 中完成，不单独成期。

## Phase E — 双引擎合一(后续)

- 合并 route.ts / agent-handler.ts 的 run 驱动骨架为共享 `runConversation`。
- 此次为验证逃跑; 视 B 演进过程再行。

## Phase F — goal 持久化(rehydrate,后续)

- goals 表接入;画布含默认目标与中断现场;V2 P0-3 该项另开会话推进。

## 风险登记

| 技术风险 | 缓解 |
|---|---|
| 移除 settle 后 in_progress 泄漏 | 机器回卷 pending(Phase A) |
| todo patch 语义动摇律师传入清单的期望 | schema + tool description 一起改;测试覆盖 |
| 移除子任务边界拆单 → 超大子任务回退上下文 | 由闸门代价:受控 exhausted + 重开 run,L3 承担 |
| prepareStep 删除误删画布 | 保留触发注入块,先于删除验证 |
| 孤儿模块删除引连锁 | 每删一文件跑 tsc