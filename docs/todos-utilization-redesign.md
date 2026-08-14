# todos 利用率重构设计（让 agent 善于利用 todos）

> 日期：2026-08-15
> 范围：`packages/core/src/modules/todos/`、`modules/agent-control/pipeline.ts`、`modules/system-prompt/sections/task-planning.ts`、`modules/plan/plan-tool.ts`、`scripts/todo-baseline/`
> 状态：**设计稿 + 实施记录**。基于真实模型量化基线（Phase 0）驱动，非纯静态分析。
> 参考：
> - `docs/todos-module.md`（todos 模块职责说明）
> - `scripts/todo-baseline/`（无头基线 harness，可复跑回归测试）
> - `outputs/todo-baseline/`（基线报告，latest.json 为最近一次）

> **实施状态（2026-08-15）**：
> - ✅ Phase 0：无头基线 harness + 症状量化（多步建单率 ≈ 40%）
> - ✅ Phase A：确定性多步检测 + 首轮注入 + 5 步兜底 + 执行型收紧（难例建单率 14% → 55%）
> - ✅ Phase B：账本承重不变量 8 条 + 压缩快照富化（verify/失败/error）
> - ✅ A4/A5：触发词汇校准到助手域 + submit_plan/todo_write 双入口路由澄清（执行型 c02 1/2 → 2/2）
> - ⏸ 工具级强制（把执行型建单率推向 100%）：设计风险高（可能死锁/改变用户可见行为），待决策

---

## 1. 问题定义与现状

### 1.1 战略判断（为什么值得做）

**todos 是 agent 自主完成长任务的关键，是进入「更智能、更能干事」新水平的门槛。**
LLM 本质无状态，长任务自主依赖把执行状态外化到上下文之外：压缩存活、中断恢复、
子 Agent 交接、进度可验证、失败自纠。todos 就是这面承重墙——它的可靠性决定能力上限。

### 1.2 症状

「agent 有时候建 todo，有时候不建，不稳定」——同类请求行为不一致。

### 1.3 根因链（静态分析，6 项）

| # | 根因 | 证据 |
|---|------|------|
| 1 | 触发零确定性：建 todo 全靠 LLM 在 t=0 的自愿元判断，无任何确定性检测 | 全仓库无多步检测逻辑；触发仅靠系统提示词散文 |
| 2 | 触发词汇错配任务域：「多个文件/多次工具调用/write code」是编码域信号 | task-planning 段、todo_write/submit_plan 描述均编码域示例 |
| 3 | 双入口竞争：submit_plan 与 todo_write 都自称「首选」，模型多一层判断 | 两处描述均写 "Prefer this over..." |
| 4 | 行动偏向压力：推理循环守卫推着「立即动手」，最省事是干活不是规划 | pipeline 推理循环守卫 |
| 5 | 无负反馈：该建没建没有任何代价 | lint 只在已建时触发 |
| 6 | 兜底机制是死的：5 步无活动提醒在 todo 为空时不注入 | pipeline 快照注入依赖 snapshot 非空 |

### 1.4 量化基线（Phase 0，deepseek-v4-pro）

用 `scripts/todo-baseline/` 在真实模型上无头跑 12 条固定请求（编码/非编码多步、单步、边界）+ 多次重复：

| 指标 | 值 |
|------|----|
| 多步建单率 | **≈ 40%**（15 次多步运行建单 6 次） |
| 单步/模糊误建率 | **0%** |
| 建单后推进/result 完备率 | 100%（一旦建单质量优秀） |
| 同请求多次运行 | g01 1/7、g03 3/4、c02 1/3（行为分裂） |

**结论**：薄弱环节全在冷启动触发（rung-1），不在使用质量。模型一旦建单即规范（单一
in_progress、逐步更新、result 完备）。「不稳定」= 纯模型自觉决策的随机性，编码域（~67%）
略高于非编码域（~31%）但主因是「零兜底」，不是词汇。

> 注：基线过程曾发现 todo 写库 `FOREIGN KEY constraint failed`——是 harness 未先建
> conversation 行的工件，非产品 bug（真实流程发消息时自动建会话行）。Phase 0 报告在
> 14:53 之前生成的均为该假数据，已删除。

## 2. 方向框架：从「看板」到「账本」

todos 当前是**看板**（模型自觉维护的展示），要成为**账本**（执行状态的可靠事实源）。

**账本承重原则**：让账本成为执行状态的唯一可靠来源，让保持账本准确成为 agent 的最优策略。
子 Agent 交接只走账本、压缩后只能从账本恢复、离开账本就吃亏（委托丢结果/压缩失忆）→
维护账本变成理性选择而非提示词吩咐。这时「善于利用 todos」是内化的，不是被教导的。

**七级阶梯**（利用质量，逐级递进）：

| 级 | 行为 | 状态（2026-08-15） |
|----|------|----|
| 1 | 建——多步请求开头建清单 | ✅ Phase A 确定性触发 |
| 2 | 推——每步推进更新状态 | ✅ 已具备，A 收紧强化 |
| 3 | 验——完成写 result | ✅ 已具备 + lint |
| 4 | 循——失败写 error + 修订计划 | ✅ 快照含 error + 快照富化 |
| 5 | 托——委托传 todoId 回写账本 | ✅ 已实现（Phase B 钉死不变量） |
| 6 | 存——压缩/中断后账本仍准确 | ✅ 架构天然成立 + 快照富化 |
| 7 | 纳——把账本当唯一事实源规划下一步 | 部分（提示层已教，未强制） |

## 3. Phase A：确定性触发（rung 1-2）

### 3.1 设计

新增 `packages/core/src/modules/agent-control/multi-step-detector.ts`：

- `looksMultiStep(text)`：确定性多步判定——显式枚举（"三件事/第一步/① ②"）、多动词串联
  （"写 X 并/然后 做 Y"）、排序词（"先…再"）、多交付物（"和一份清单/并生成报告"）、
  连接词+长度（≥20 字）、超长兜底（≥80 字）。保守宁多勿漏。
- `executionIntent(text)`：执行型（改代码/文件/外部系统：文件操作动词、运行/部署/发送等
  副作用动词、研究到交付物）vs 内容型（输出即答案）。收紧注入的依据。
- `workedWithoutPlanning(step)`：上一步是否「没建清单就开始干活」。

`pipeline.ts` 两处注入：

1. **首轮注入**（step 0，多步且未建单）：
   - 执行型 → 无出口硬注入「必须先用 todo_write 建清单再动手」
   - 内容型 → 软注入，带「若为单步可忽略」出口
2. **5 步兜底**（todo 为空 + 多步 + 5 步无活动）：注入提醒。**修死了原空清单不注入的死路径**。
3. **执行型反复提醒**：只要开始干活仍未建单（调用了非 todo 工具），就再注入硬提醒。

### 3.2 验证（同一 harness，deepseek-v4-pro）

| 用例 | Phase 0 基线 | Phase A 后 |
|------|------|------|
| g01 行程（内容型，软） | 1/7 | 3/3、2/2（step0 建 4-5 项） |
| g04 调研（执行型，硬） | 0/3 | 1/1（step0 建 4 项） |
| c02 重构（执行型，硬） | 1/3 | 2/4（建单那次推进到完成） |
| g02 整理（内容型，软） | 0/1 | 0/3 →（A4/A5 后 1/2，出口设计如此） |
| 难例合计 | ~14% | ~55% |

### 3.3 天花板（诚实记录）

纯消息注入有天花板：模型可以无视 user 消息（c02 曾 5 次硬提醒仍直接干完）。
逼近 100% 需**工具级强制**（清单不存在时拦截非 todo 工具执行），风险：可能死锁
（模型不建单就卡住）、改变用户可见行为。设计见 §6，尚未实施。

## 4. Phase B：账本承重（rung 5-7）

### 4.1 摸底结论：B1-B4 大多已实现

| 项 | 状态 | 证据 |
|----|------|------|
| B1 子 Agent 交接闭环 | ✅ 已实现 | agent-tool/parallel-agent-tool 传 todoId；executor 启动置 in_progress、成功 completeTodo(result.summary)、失败 failTodo(error)；updateTodo metadata 合并（父整表替换不抹子结果）；工具描述已教父传 todoId |
| B2 压缩存活 | ✅ 架构天然 | 账本 SQLite 持久化（压缩只动消息历史）；压缩后快照自动再注入；todo-overview 常驻系统提示 |
| B3 中断恢复 | ✅ app 层已处理 | 未完成任务检测 + 停止时 todo 状态管理 |
| B4 verify→result | ✅ 已实现 | verify 字段 + lint 警告 + result 写入 |

### 4.2 真正缺口：闭环无自动化验证

`ledger-load-bearing.test.ts`（8 条不变量，`modules/todos/__tests__/`）钉死：
- 委托回写：completeTodo/failTodo 把 result/error 写进账本、启动置 in_progress
- 父 todo_write 整表替换不抹子 Agent result（metadata merge）
- 已完成 todo 豁免整表替换（父漏传不删）；活跃项按语义删除
- 快照作为压缩/续做依据：含 result/verify/error

### 4.3 压缩快照富化（B2 续做依据）

`buildCompactTaskSnapshot` 新增：待办/进行中附 `(verify: …)`（怎样算做完）、失败区
`[!] #id subject: error`（修订计划依据）、统计含失败数。压缩后注入的状态成为完整续做来源。

## 5. A4/A5：触发校准与双入口路由

原 task-planning 段「3 个以上步骤、涉及多个文件或多次工具调用」是编码域词汇，且
「复杂请求先调用 submit_plan」与 todo_write 指导自相矛盾（双入口混乱的根源）。已改写：

- **task-planning**：触发词汇改助手域（多步骤/多项交付物/多次操作）；明确「普通多步任务
  一律用 todo_write，不要调用 submit_plan」
- **submit_plan 描述**：收窄为仅「用户明确要求先确认」或「高风险（不可逆/对外发送/删数据）」
- **todo_write 描述**：示例从 coding 改通用助手场景；说明「仅高风险/需确认才用 submit_plan」

验证：c02 1/2 → 2/2 且推进到完成；g01 不再误用 submit_plan（直接 todo_write）；全量 1063 tests 通过。

## 6. 剩余方向（待决策）

1. **工具级强制**（把执行型建单率 50% → ~100%）：清单不存在时拦截非 todo 工具执行，
   返回「先建清单」错误。需设逃生（如 N 次后放行）防死锁。改变用户可见行为，需谨慎。
2. **遥测/指标**：多步建单率、推进率、result 完备率的持续观测（harness 已具备，可接入）。
3. **恢复续做显式化**：resume 时显式注入「上次进行中任务 + 已完成结果」的续做提示。
4. **落文档/README**：向产品文档同步「agent 会自动规划」的用户侧预期。

## 7. 附录：如何复跑基线

```bash
# 全量 12 条（约 10-25 分钟，需 ~/.agents/models.json 与 API 可用）
pnpm --filter @the-thing/core exec tsx ../../scripts/todo-baseline/run.ts

# 指定用例 + 重复采样（量化不稳定）
pnpm --filter @the-thing/core exec tsx ../../scripts/todo-baseline/run.ts --cases=g01,c02 --repeat=3

# 常用参数：--model=deepseek-v4-flash（低成本） --timeout-ms=120000 --max-steps=12
```

安全：resourceRoot/dataDir/configDir 全指向临时沙箱，不触碰真实 ~/.thething；禁用
mcps/connectors/skills。报告输出到 `outputs/todo-baseline/`（latest.json 最近一次）。
