# 状态模型

> 与 `runtime.md` 配套。定义 harness 维护的全部状态、变化与终态语义。

## 1. 状态分层

TaskExecution(跨 run 持久,由 store 聚合,无新表)
├── 会话目标    goals 表(Phase F 接入持久化; 目前内存 null 合法)
├── 任务清单    todo_events 表(快照事件日志)→ 内存重建快照(唯一权威;含 todo.number 物化号)
│     └── 元数据 metadata.execution.{interruptedAt, interruptedReason}
├── Run 历史   agent_runs 表(status + stopReason)
│              conversation_runs 表(消息落库、回执、superseded)
├── 认知纪录   messages 表(不可变树)+ summaries 表(L3 摘要)
└── 成本      cost 表
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

### 3.2 写语义:单 `todo` 工具、patch 更新、快照事件落账

- **集中单工具**:`todo_write / todo_create_batch / todo_delete / todo_merge` 全部退役,
  收敛为 `todo`(action: `list | add | update | delete | clear`)。`add` 批量收入 `items[]`,
  依赖提示经 `dependsOnSteps[]` 映射为 `blockedBy`。
- **patch 语义**(保留):`update` 只 patch `#N` 引用项里显式传的字段;未列举字段**不动**。
  取消必须显式(`status:'cancelled'` 或 `action:'delete'` 软取消)。
- **统一落账**:每一次 mutation = 向 `todo_events` append 一条该会话**全量快照**事件
  (reason 区分写方:todo-tool / agent-delegation / approval / run-downgrade / api)。
  内存快照为唯一权威,启动时以每会话最后一条事件重建。

### 3.3 工具返回不变

- 每次 `todo` 变更后工具返回最新活跃清单 `snapshot`(带 `#N` 物化号),供模型下一轮引用。
- 引用一律 `#N`(稳定号,创建时物化,永不重排/复用),id 只在服务端内部出现。
- `merge` 已退役删除;重复标题/过多 in_progress 等仅以 `warnings` 提示、不阻断。

## 4. 画布与 store 的一致性

- 画布内容 = 物化号索引视图(`indexActiveTodos(store.getTodosByConversation)`,编号直接读
  `todo.number`)+ `runtime.getRuntimeState()` + `agent_runs`(resumable 时的中断现场)。
- 无任何内存中的任务旗标副本;面板本地不推导编号(直接用快照里的 `number`)。
- 所有状态以 `todo_events` 重建的内存快照为准,跨 run / 跨重启稳定。

## 5. 挂起/恢复

- 审批挂起: `suspended_agent_states` 表 + `paused_approval` run 态(现有,保留)。
- 恢复: 清 suspended + `resumeFromApproval`,再走**新 run**;新 run 的画布注入"上次中断"现场。

## 6. 并发与幂等

- 单进程 + `withConversationLock`,同步 better-sqlite3;不加乐观锁(runtime.md §6 同)。
- `agent_runs` 写操作为幂等 UPDATE;`finalizeRun` 不再依赖模块级 guard——由 DB 幂等 + 单次调用保证。
- **删除**模块级 `finalizedConversations Set`(跨请求泄漏根因)。
- todo 层单进程写;`todo_events` 仅追加,任何重复执行(恢复/续做/同意)只是多一条终态
  相同的快照事件,重建后状态恒一致——收尾回卷等重复路径天然幂等(见 docs/todos-lite.md §5.5)。