# 状态模型

> 与 `runtime.md` 配套。定义 harness 维护的全部状态、变化与终态语义。

## 1. 状态分层

```
TaskExecution(跨 run 持久,由 store 聚合,无新表)
├── 会话目标    goals 表(Phase F 接入持久化; 目前内存 null 合法)
├── 任务清单    todos 表(权威)
│     └── 元数据 metadata.execution.{interruptedAt, interruptedByRun}
├── Run 历史   agent_runs 表(status + stopReason)
│              conversation_runs 表(消息落库、回执、superseded)
├── 认知纪录   messages 表(不可变树)+ summaries 表(L3 摘要)
└── 成本      costs 表
```

## 2. agent_runs 终态

| status      | 含义                     | 可续跑(resumable) |
|-------------|--------------------------|-------------------|
| `completed` | 任务确认完成(done/quiescent) | 否                  |
| `exhausted` | 达到护栏被动停           | 是                  |
| `failed`    | 异常/截断                | 是(诊断后)               |

`stop_reason` 列(P0-1 已加)记录:done / quiescent / step_limit / cost_budget /
context_budget / denial_limit / aborted / output_truncated / error。

## 3. todo 状态迁移(语义不变,写语义改为 patch)

### 3.1 状态集合与合法迁移

```
pending ──claim──→ in_progress ──complete/fail──→ completed / failed
   │                    │
   └──── cancel ◀───────┘
completed/failed 为终态;(cancelled 为软终态)
failed ──retry──→ pending(显式重试)
```

迁移合法性统一由 `TodoRuntime`(claim/complete/fail/cancel/retry)校验,系统不改。

### 3.2 写语义:true-replace → patch(重点变更)

- **Before(真替换)**:一次 `todo_write` 传"想保留的完整清单";未列出的活跃待办被自动取消。
  副作用:模型一次传错清单 → 整张任务图被大扫除,是"任务混乱/清单丢失"的既定元凶。
- **After(patch)**:`todo_write` 只**patch 被 index 引用的项**;未提及的项**不动**。
  取消必须**显式**(把对应项标为 `cancelled`)。
- 结果:模型失误最多伤一项,任务图不再被一发误传清零;机器不再做"你没列出的都取消"的投影化判定。
- 编排代价:模型需要显式地 cancel 不再需要的项(已在 schema description 中重申)。

### 3.3 新写语义下的自动复核(工具返回不变)

- 每次 `todo_write` 后工具照旧返回最新活跃清单 `snapshot`(带 [] 数组号),供模型下一轮引用。
- 索引语义不变(按 [#N] 引用,不传 id)。
- `merge` 显式合并保持不变。

## 4. 画布与 store 的一致性

- 画布内容 = `indexActiveTodos(store.getTodosByConversation)` + `runtime.getRuntimeState()` + `agent_runs`(resumable 时的中断现场)。
- 无任何内存中的任务旗标副本。所有状态以 SQLite 为准,跨 run 稳定。

## 5. 挂起/恢复

- 审批挂起: `suspended_agent_states` 表 + `paused_approval` run 态(现有,保留)。
- 恢复: 清 suspended + `resumeFromApproval`,再走**新 run**;新 run 的画布注入"上次中断"现场。

## 6. 并发与幂等

- 单进程 + `withConversationLock`,同步 better-sqlite3;不加乐观锁(runtime.md §6 同)。
- `agent_runs` 写操作为幂等 UPDATE;`finalizeRun` 不再依赖模块级 guard——由 DB 幂等 + 单次调用保证。
- **删除**模块级 `finalizedConversations Set`(跨请求泄漏根因)。