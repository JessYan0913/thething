# Runtime 机制:One Loop / One Canvas / One Close

> 定调(延续 todo-runtime-v3 时代已确立、此前未被贯彻的原则):
> **系统只给运行环境 / 状态一致性 / 工具 / 上下文 / 安全;LLM 只负责任务决策。系统不替 LLM 决策,也不在每步和收尾时"审问"LLM。**
> 本文把这条定调从"口号"落到"机制"。

---

## 1. 总原则

两条不变量,决定所有机制的取舍:

- **I1 上下文连续性**:run 中不手工删除/替换消息。上下文只增:
  真实执行消息、L3 压缩(确定性摘要化)、以及"任务画布"。
- **I2 确定性归 harness**:凡是系统能确定得出的(状态迁移合法性、终态、预算、工具生命周期),
  一律由代码完成。LLM 只在两条边界出现:做任务、做工具调用。**绝不**用 LLM 去管模型。

一切被删除的机制,删除理由都可以归约为"违反 I1 或 I2"。

---

## 2. One Loop — 单 run 循环

### 2.1 目标形态

```
Web route.ts ─┐
Connector     ├─→ runConversation(输入, 状态) → 执行 → 落库 → 终态
CLI           ┘
```

一个 `prepareStep` 每个 step,在模型调用前**只做三件事**:

1. **状态画布组装**(见 §3):从权威 store 读出唯一合法解析一次「任务画布」,以**一条** user 消息注入,至多每个 step 一次。
   触发条件:todo revision 变化 / 本次已压缩 / 连续 N 步无行动。
2. **L3 压缩**:`compactBeforeStep`(确定性 LLM 摘要,已有)。每步调用,无旁路、无预检。
3. **预算闸门**:估算总量超过窗口 → 先 L3 → 仍超 → **不抛异常**,设置 `exhausted(context_budget)` 标志并停止循环。

### 2.2 `prepareStep` 现况 → 目标(删掉什么)

| 现 `prepareStep` 步骤 | 处置 | 理由 |
|---|---|---|
| 归档失败重试 / 子任务整段重建 / 预算预检拆单 | **删除整个块** | 违反 I1(I 补上下文); I3-led;LLM 拆单/摘要不可靠 |
| step0 规划引导 / 每步 todo 同步提醒 / 空清单提醒 | **删除** | 画布已承载;喊话式注入与 I2 冲突 |
| 上下文水位 >60/75/85% 注入提示 | **删除** | 画布 + 闸门足够;噪音 |
| goal 续跑提示注入 / maxTurns 递增 | **删除** | goal 进入画布;不再每步催促 |
| 推理空转检测 + 催促 | **删除** | 推理空转由模型自主;系统不喊话 |
| Completion Audit 注入 | **删除** | 由 One Close 收尾器确定性处理;不再 run 中审问 |
| 压缩调用(cmex L2+L3) | **保留**(简化为单次调用) | 连续性来源,确定性摘要 |
| 任务状态画布注入 | **保留 + 简化** | 唯一注入 |
| deny 阈值检查 | **保留(硬停)** | 安全闸,非 LLM 劝导 |

> 保留的精简:每次 step 最多只 append 至多 1 条 user 消息(`[任务画布]`;当画布内容为空时为零条)。

### 2.3 双引擎收敛

- `route.ts`(Web)与 `agent-handler.ts`(Connector)**不再各自实现 run 的旁路逻辑**。
  两处只负责:鉴权/输入解析/推流/落库 head,统一调用同一 `runConversation()` 的能力。
- 现阶段:两入口已共享 `createAgent` + `finalizeRun`;步骤循环逻辑收敛由 `prepareStep`
  单点承担(getAbstract)。
- 后续(Phase E):把 `route.ts` 与 `agent-handler.ts` 的循环骨架合入共享 runtime,入口只做薄适配。

---

## 3. One Canvas: 唯一的模型可见任务状态

### 3.1 画布内容

一条 user 消息,由以下内容拼成(全部确定性,无 LLM):

```
[任务画布 — 系统确定性状态,请按此行动]
Goal(若有): <goal.objective>
Active (待办): [#1] <subject>  …  (含 blockedBy 展示)
In Progress: [#N] <subject>
Recently Completed: [#M] <subject> — <结论摘录>
Runtime: Ready / Blocked / Quiescent
上次中断: <stopReason,若有>
```

- 数据来源单一:`todoStore` + `TodoRuntime` + `agent_runs`(若 resumable)。
- 触发注入时机:todo revision 变化、压缩后、连续 5 步无 todo 变更。
- 与 system prompt 中 `todo-overview` section 的关系: 段为静态引导,画布为每步动态状态,二者不重复。

### 3.2 删除

- 不再有 planner 的 plan prompt 注入、no-todo 提醒、每步提醒。
- 不再有 `pendingArchiveTodoId / pendingArchiveRetries / subtaskStartMessageIndex / enableSubtaskArchiving / completionAuditInjected / consecutiveReasoningOnlySteps / stepsSinceTodoMutation` 等运行时 flag —— 画布信息全部来自持久化 store,不再依赖内存滑动板。
- goal 持久化后(Phase F),画布还会包含上次 run 的中断现场。

---

## 4. One Close: 确定性收尾

### 4.1 终态推导(纯函数,不依赖 LLM)

run 终止时的所有情形,由系统**确定性**推导为一种 `StopReason`:

| 触发 | StopReason | agent_runs 终态 |
|---|---|---|
| 模型调用 `done` / 自然完成 | `done` | `completed` |
| 达到 maxSteps / 审批评次上限 | `step_limit` | `exhausted` |
| cost 超预算 | `cost_budget` | `exhausted` |
| 上下文窗口被数据顶爆(会话内增长) | `context_budget` | `exhausted` |
| denial 阈达 | `denial_limit` | `exhausted` |
| 用户取消 / abort | `aborted` | `exhausted` |
| 输出被 provider 截断 | `output_truncated` | `failed` |
| 异常 | `error` | `failed` |

- `exhausted ≠ completed`:不再有"误把中断标完成"。
- 此推导是纯函数(`deriveStopReason(...) -> { reason, status }`),完全可测。

### 4.2 归位(todo 收账)

- **系统不再让 LLM"settle"(删 settleInProgressTodos 在 finalize 的调用)**。
- 收敛为一条确定性规则(**machine downgrade**):

  ```
  run 结束 && todo.status == 'in_progress'
    → status = 'pending'
      metadata.execution.interruptedAt = now
      metadata.execution.interruptedByRun = runId
  ```

  理由:模型没关闭循环不意味着"完成了"或"失败了";回卷为 pending 是保守且正确的——任务仍待办,
  下一轮画布如实显示,模型可继续 `claim`。避免 in_progress 泄漏导致
  "单选 in_progress 锁死下一轮 claim"的悬坠。

- 该规则纯代码,无 LLM,写进 `finalizeRun` 一处。

### 4.3 收尾中删除

- `settleInProgressTodos`(额外 LLM 调用)
- `Completion Audit`(审问)
- 子任务归档 `archiver`(LLM 提炼 facts)——facts 由 `todo_write result` 自然携带。
- 后台标题生成 / MCP disconnect 等属各自清理,不受影响。

---

## 5. 遗留模块处置

以下模块因本次改动成为孤儿(不再被 prepareStep / executor / finalize 引用):

- `agent-control/archiver.ts`(+测试)
- `agent-control/splitter.ts`(+测试)
- `agent-control/plan-prompt.ts`(+测试)
- `agent-control/completion-audit.ts`(+测试)
- `agent-control/context-builder.ts`(agent-control/)+测试

**处置**:从 import 面移除接线后,**删除文件与测试**,以消灭"死代码惰性"。若发现仍有引用导致编译失败,则引用点一并修正。

## 6. 明确不做

- 不做 Event Sourcing(CRUD 足够)。
- 不新增 `task_execution` 表(由 `agent_runs + todos + goals` 聚合足够)。
- 不把 harness 演化为 Workflow Engine(不自动重试 / 不自动调度 / 不自动验证)。
- 不新增"每步 LLM 辅导"类的机制(本设计要消灭的就是这一类)。