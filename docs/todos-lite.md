# Todos 轻量化——从"调度器"降回"账本"

> 定调(延续 runtime.md 的 I2):**系统只给运行环境 / 状态一致性 / 工具 / 上下文 / 安全;LLM 只负责任务决策。**
> harness 部分已经贯彻(I2:系统不替 LLM 决策,收尾不再审问 LLM),但 todo 层仍残留一套
> **多 agent 执行调度器**的旧假设——状态机合法性、单进行中闸门、claim/busy 体制、依赖门、索引重排。
> 本文把 todo 从"调度器"降回"账本":任务状态的判断权交给模型,系统只保证**不丢、稳定、可见**。

---

## 1. 问题陈述:它没在干它该干的活

todo 的三份价值(它**应该**做的事):

1. **给模型**:跨会话、跨压缩、跨天数的持久计划与"干到哪了"——不依赖上下文还剩多少。
2. **给用户**:一个可见、可干预的进度面板——用户看到助手在做什么、接下来做什么,随时插入/停/改。
3. **给运行时**:一个"还有没有活"的信号,让 run 知道何时该安静收尾。

而现在约 80% 的结构——状态迁移矩阵、单进行中门、`claimedBy`/`agent_status`、依赖门、索引重排——
全是在干第五件事:**把 todo 当成"多 agent 执行调度器"**(谁在跑、谁 busy、只能一个在跑、非法禁止、依赖阻塞)。

这违反了已经确立的 I2:"模型自己编排、系统只提供运行环境"(subagent 路由、步数上限都这么砍了)。
todo 却还平行留着整套调度积累。现实症状:

- **P1 分裂命名空间**:`inProgressIds()`/`getRuntimeState()` 用全局 `getTodosByStatus('in_progress')`
  (无 conversation 过滤),而画布/清单是 `getTodosByConversation` 会话域。任一会话的 in_progress
  卡住所有会话的 claim;`agent_status` 表全局单条、agentId 硬编码 `'main'`。
- **P2 回卷认领不对称**:run 结束 `downgradeUnsettledInProgress` 只置 `status='pending'`,
  不清 `claimedBy`、不清 busy → 行是 `pending + claimedBy='main'`,再 claim 被 `ALREADY_CLAIMED` 卡死。
- **P3 索引是派生值当稳定引用**:`indexActiveTodos` 按 createdAt ASC 把活跃项连续编号,
  任何 complete/cancel/merge 都让后续编号整体前移 → 过期快照引用 `[#N]` 必失配(index 1 不匹配)。
- **P4 严格状态机无逃逸**:`pending→completed` 直接禁止,必须先过 in_progress,
  而过 in_progress 又被 P1/P2 的不可见幽灵挡死——三方叠加成死锁。

## 2. 新定位:账本,不是调度器

一张表,三份保证:

> **不丢、稳定、可见。模型负责判断,用户负责干预,运行时负责在没活时安静退出。**

- 模型判断什么:**是否完成、先做哪个、要不要改状态**——想写什么状态就写什么,系统不拦。
- 系统管理什么:**持久化、稳定编号、唯一视图、run 结束的回卷卫生**——写事务与收尾的确定性。
- 系统**不**管理:状态迁移合法性、单进行中、依赖门、认领体制、编号重排。
  任何"该不该动"的判定都降级为**工具返回的 lint 建议**(只提示、不阻断)。

## 3. 轻量六原则

1. **系统不判,只记**。状态值随便改(pending→completed 直接允许),系统不拦;
   合法与否是模型判断。系统只在 run 结束时对仍在 in_progress 的项做回卷卫生(模型已无法发声)。
2. **编号永不重排**。每行一个稳定编号,创建时分配(第 N 次创建 = #N),**永不复用**。
   完成/取消的项挪"已收尾"区,不占活跃位、不重排其余。`[#3]` 在任何时刻指向同一件事。
3. **没有闸门**。不做单在途硬约束、不做依赖门、不做 `ILLEGAL_TRANSITION`。
   过度触发(如同时两个 in_progress)由工具返回 lint 提醒,不阻断。
4. **没有认领体制**。移除 `agent_status` 表的读写;`claimedBy` 只是展示标签,不做事、不阻塞。
   子 agent 协作=继承一个 #N,直接改同一行。无 busy、无 holding、无锁。
5. **run 收尾只做一件事**。run 结束时把仍标 in_progress/failed 的项标回"待做"并写
   `stopped-at/interrupted-reason`;**同时把 claimedBy 清空**(P2 对称)。
6. **唯一视图**。所有渲染方(画布、overview、tool 回执、UI 面板)只从一个读取函数
   拿同一份稳定编号视图。

## 4. 最小契约(落地口径)

- **状态集**(复用现有列,不加表):`pending`(待做) / `in_progress`(在做) / `completed`(完成) /
  `failed`(失败·可重试) / `cancelled`(放弃)。系统允许任意迁移(含终态→active 重开)。
- **工具面**:单 `todo` 工具,五动作
  `{ action: 'list'|'add'|'update'|'delete'|'clear' }`;`update.id` 一律 `#N` 稳定号,
  零校验;lint 建议单独返回 `warnings`(只提示、不阻断)。`todo_write`/`todo_create_batch`/
  `todo_delete`/`todo_merge` 已全部退役。
- **画布**:活跃列表(`#N 标题 (状态)`,物化编号序)+ 最近终态 3 行;画布与面板直接用
  todo.number(快照物化值),不做本地推导。
- **收尾信号**:**`quiescent = 不存在 status ∈ {pending,in_progress,failed} 的条目`**(一个查询)。
  不直观 ready/blocked/dependencies 派生。
- **认领**:`claimedBy` 只展示;claim 语义改为"标注 in_progress + 记录执行者(展示)",不做任何 gate。
- **依赖**:`blockedBy` 由新建时的 `dependsOnSteps[]` 映射,保留为**可选提示字段**,系统不做依赖门(不再因此抛错)。

## 5. 实施阶段与验收

沿用 runtime.md 的 A/B/C 式分阶段。

- **T1 编号稳定化**(snapshot-index):编号=**创建时物化的 `todo.number`**(不复用、不重排);
  完成/取消不移位;resolve 按稳定号含终态。→ 验收:创建 3 项→完成 #1→剩余编号仍是 2,3;
  引用 #3 命中稳定行;删除后新建 #4(不复用 #2)。
- **T2 拆闸门**(todo-runtime):删 assertTransition / enforceSingleInProgress / ALREADY_CLAIMED /
  DEPENDENCIES_UNMET;任何状态迁移(含终态→active)允许;runtime overlay 会话域化。
  → 验收:pending→completed 直通;跨会话一项 in_progress 不再卡他会话 claim。
- **T3 移除认领体制**(store):claimTodo 不再读/写 agent busy;agent_status 表放弃;
  updateTodo 终态与 claimedBy 处理无 busy 逻辑;killedAgentStatus / recover 不再依赖。
  → 验收:无 `agent_status` 读写路径;两个 store(`SQLiteTodoStore`/`InMemoryTodoStore`)等价
  (同一统一实现 `SnapshotTodoStore`,仅事件落 SQLite/内存之分)。
- **T4 收尾对称化且幂等**(finalize):downgrade 置 pending + 清 claimedBy + 写 interrupted 现场,
  以 `reason='run-downgrade'` 落一条快照事件。→ 验收:run 结束后行= pending+claimedBy=null+
  metadata.execution 有现场;重复收尾再验一致(终态幂等,仅事件多一条)。
- **T5 工具与画布**(单 `todo` 工具):硬失败→lint warnings;引用 `#N` 稳定号(终态引用给提示);
  删除=软取消(编号保留);清单与面板直接用物化号,不做本地推导。
- **T6 语义树清理**:删除/废弃冲突测试、新增覆盖(稳定编号、跨会话与多写方收敛、事件回放重建
  等价、迁移回填)。

## 5.5 存储机制:事件化快照账本(schema v22)

> 落定 todo 层全部写路径 → **只追加不可变快照事件**;内存快照唯一权威。
> (注:runtime.md §6「不做 Event Sourcing」被本节覆盖——消息层仍是 CRUD,仅 todo 层独立采用。
> 参照 pi(earendil-works/pi)的「不可变快照事件 + 从日志重建」;TheThing 不把状态放 tool-result
> details(压缩会截断消息),而是落专用 `todo_events` 追加表。)

### D1 全量快照事件

每次 mutation = 在 `todo_events` 追加表 append **一份该会话的完整 todos 快照**(payload 为
全量 JSON)。不写增量、不做 diff、不覆盖、不删除。`seq INTEGER PRIMARY KEY AUTOINCREMENT`
全局单调,既是顺序号也是 revision。当前态 = **最后一条事件**(快照即全量),无需重放历史;
历史条数仅作审计/分支预留(`event_type='snapshot'`、`branch_id='main'`)。

为什么:**恢复/压缩/续做/委托 任何重复执行都变成「再 append 一条终态相同的快照」**,
不可能产生"两份权威副本对不上";编号漂移也失去温床——编号随快照持久化,不再派生。

### D2 #N 即稳定号(创建时物化)

创建时分配会话内高水位 +1(内部 `nextNumberByConversation`,硬删除/清空不回落),
随快照持久化,**永不复用、不重排**。模型侧工具栏引用一律 `#N`(`todo.update.id`),
服务端 `resolveActiveByIndex` 按物化号映射回内部 id;画布/面板/模型三方共用同一份产物。

### D3 权威全量 / 展示紧凑

事件日志与 `list(scope:'all')` 持全会话全量(含终态);模型与画布默认读「活跃 + 最近终态」
紧凑视图。`add` 一次可建多行(`items[]`、含 `dependsOnSteps` 依赖提示);`update` 按 `#N`
只修指定字段(未列举字段不动,零校验)。

### D8 五条写路径统一收敛(写方标签)

| 写方 | reason | 入口 |
| --- | --- | --- |
| 主模型 todo 工具 | `todo-tool` | `add/update/delete/clear` |
| 子 agent 委托状态同步 | `agent-delegation` | executor 的 claim/complete/fail |
| `submit_plan` 批准 | `approval` | plan 批准→取消旧清单+写入 |
| run 收尾回卷 | `run-downgrade` | finalize 收尾回卷(幂等) |
| 面板 `/api/todos` | `api` | 用户手动操作(claim/update/complete/...) |

`withTodoReason(store, reason, fn)` 在写事件时给事件打标签(审计)。单进程写假设与现有架构
一致——一次快照事件内的多条写路径串行,二写同会话并发不出现。

### D9 回填迁移与向后兼容

(schema v22,v22 迁移)逐会话读旧 `todos` 行 → 按创建序赋物化号 `#1..#n` → append 一条
`reason='backfill'` 快照事件 → 旧表留备份 `todos_legacy`(空表直接 DROP)。程序启动以每会话
最后一条事件重建内存;旧接口(`getTodosByConversation` 等)与旧外观完全不变。

## 6. 与 runtime.md 的关系

- runtime.md 管"这个 run 怎么跑"(One Loop / One Canvas / One Close);
- 本文管"run 之间、压缩之间、会话之间,任务清单怎么活"(账本)。

I1/I2 不变;本节只把 I2 在 todo 层的残余调度器清除——**系统不做模型该决定的事,模型不碰 runtime 状态。**