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
- **工具面**:`todo_write({ todos: [{ ref: '#N'|标题, status?, subject?, activeForm?, result?, note? }] })`
  —— 每次改一张或多条,零校验;lint 建议单独返回。
- **画布**:活跃列表(`#N 标题 (状态)`,按稳定编号顺序)+ 最近 done 3 行;
  不再叠加全局 `[任务运行时]` overlay(那块的全局泄漏顺带消失)。
- **收尾信号**:**`quiescent = 不存在 status ∈ {pending,in_progress,failed} 的项`**(一个查询)。
  取代整套 ready/blocked/dependencies 派生。
- **认领**:`claimedBy` 仅展示;claim 语义改为"标注 in_progress + 记录执行者(展示)",不做任何 gate。
- **依赖**:`blockedBy` 保留为**可选提示字段**,系统不做依赖门(不再因此抛错)。

## 5. 实施阶段与验收

沿用 runtime.md 的 A/B/C 式分阶段。

- **T1 编号稳定化**(snapshot-index):编号=创建序稳定号;完成/取消不移位;resolve 按稳定号含终态。
  → 验收:创建 3 项→完成 #1→剩余编号仍是 2,3;引用 #3 命中稳定行。
- **T2 拆闸门**(todo-runtime):删 assertTransition / enforceSingleInProgress / ALREADY_CLAIMED /
  DEPENDENCIES_UNMET;任何状态迁移(含终态→active)允许;runtime overlay 会话域化。
  → 验收:pending→completed 直通;跨会话一项 in_progress 不再卡他会话 claim。
- **T3 移除认领体制**(store):claimTodo 不再读/写 agent busy;agent_status 表放弃;
  updateTodo 终态与 claimedBy 处理无 busy 逻辑;killedAgentStatus / recover 不再依赖。
  → 验收:无 `agent_status` 读写路径;两个 store(`SQLiteTodoStore`/`InMemoryTodoStore`)一致。
- **T4 收尾对称化**(finalize):downgrade 置 pending + 清 claimedBy + 写 stoppedAt/interruptedReason。
  → 验收:run 结束后行= pending+claimedBy=null+metadata 有 interrupted 现场;再 claim 可成功。
- **T5 工具与画布**(todo-write 等):硬失败→lint;引用稳定编号(含终态给予提示);画布与 runtime overlay
  会话域化;清单画布编号=稳定号。
- **T6 语义树清理**:删除/废弃冲突测试、新增覆盖(稳定编号、跨会话闸门消解、回卷清认领)。

## 6. 与 runtime.md 的关系

- runtime.md 管"这个 run 怎么跑"(One Loop / One Canvas / One Close);
- 本文管"run 之间、压缩之间、会话之间,任务清单怎么活"(账本)。

I1/I2 不变;本节只把 I2 在 todo 层的残余调度器清除——**系统不做模型该决定的事,模型不碰 runtime 状态。**