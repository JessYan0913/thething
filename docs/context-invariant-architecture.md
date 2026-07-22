# 上下文压缩机制重构：做减法

> 状态：设计提案（待实施，工程估算已基于实际代码校正）
> 前置：docs/compaction-unification-design.md（格式统一已完成 — message-view.ts + buildSummaryMessage 已落地）
> 起因：2026-07-21 事故后追问——"为什么修了很多次还漏洞百出？"
> **授权范围：可重构任何相关代码。**

## 0. 一句话

不要八层防护。**两层压缩 + 一道闸门就够了。** 其余都是可以删的。

## 1. 现状：八个机制，~2500 行代码

| # | 机制 | 文件 | 行数 |
|---|------|------|------|
| 1 | 工具源头截断 | tools/read.ts, bash.ts | 分散 |
| 2 | processToolOutput | budget/tool-output-manager.ts | 361 |
| 3 | Layer 1 模型主动释放 | compaction/index.ts + tools.ts + pipeline.ts | ~70 |
| 4 | Layer 2 生命周期老化 | compaction/lifecycle.ts | 479 |
| 5 | Layer 3 LLM 濒死摘要 | compaction/context-window.ts | 417 |
| 6 | checkInitialBudget 四策略 | compaction/budget-check.ts | 277 |
| 7 | enforceToolResultBudget | budget/message-budget.ts | 324 |
| 8 | Checkpoint | compaction/checkpoint.ts | 170 |

此外 token-counter.ts（380 行）仍有 9 处双轨格式判断点（`hasParts` + 四处 `.content` 分支），不属于 compaction 模块但共享同一格式问题。compaction-unification-design.md 步骤 3 已计划将其改用 message-view 的视图，本文档不重复规划。

## 2. 减法审视：逐机制问"删了会怎样"

### 机制 3 — Layer 1（模型主动释放 compact_tool_result）

**它是干什么的**：Agent 可以在对话中调用 `compact_tool_result` 工具，
告诉系统"我不用这个工具输出了，可以压缩"。pipeline.ts 还注入了
"上下文水位 >60% 时提醒模型调用此工具"的提示。

**删了会怎样**：这里需要诚实地区分两种压缩方式：

- Layer 1 是**语义主动**的：模型声明"这个输出我用完了"——即使它在最近 K 步内
- Layer 2 是**时序被动**的：只看步数不看语义——最近 K 步内一律保留

两者不完全等价。但删除 Layer 1 的论据依然成立：

1. 模型看不到 token 数量、不知道窗口多大，调不调这个工具纯属瞎猜
2. Layer 2 的 `tooLarge` 分支（>8KB）**无视步数限制**，大输出无论如何都会被压缩
3. `tooLarge` 已经兜住了最关键的风险（一个 200KB 的 JSON 输出撑爆窗口）
4. Layer 2 的 step 老化是**确定性**的——比模型"偶尔想起来才调"更可靠

语义上模型"我用完了这个输出"这个信号确实有价值，但当前实现的
代价（工具定义 + pendingCompactIds 状态 + pipeline 提示注入 +
instructions 注入 + tool-resolver 黑名单 + session state 字段 +
interfaces 声明）远超其实际产生的收益（事故日志中未见任何一次
`compact_tool_result` 成功阻止了问题）。

**结论：删。** 工具定义、pendingCompactIds 状态、pipeline 提示注入、
instructions 注入、tool-resolver 黑名单条目、session state 字段全部移除。
Layer 2 的 `tooLarge` 阈值可适当下调（从 8KB → 6KB 或根据实际数据调参）
作为补偿。

### 机制 7 — enforceToolResultBudget（message-budget.ts，324 行）

**它是干什么的**：每步工具结果后，**跨消息**扫描所有 tool-result，
按大小排序，持久化最大的到磁盘直到总额低于预算。有 seenIds 状态
保证 prompt cache 稳定性。

**删了会怎样**：与 Layer 2 `tooLarge` 分支对比：

| 维度 | enforceToolResultBudget | Layer 2 tooLarge |
|------|------------------------|-------------------|
| 粒度 | 跨消息（本轮全部 tool-result 排序） | 单条消息内 |
| 触发 | 总额超 messageBudget 阈值 | 单条消息总输出 >8KB |
| 行为 | 持久化最大 → 替换为预览 | 压缩所有输出 + 落盘 |
| 状态 | seenIds（prompt cache 稳定） | 无状态 |
| 调用点 | pipeline.ts 每步后 | index.ts compactBeforeStep 每步前 |

两者确实在做同一件事（大工具输出 → 落盘 + 替换为摘要），只是粒度不同。
合并方案：将 `enforceToolResultBudget` 的**跨消息扫描 + 按大小排序**
逻辑移植到 Layer 2 的 `tooLarge` 分支中，使 `manageToolOutputLifecycle`
在单次遍历中同时处理步数老化和跨消息超大输出持久化。seenIds 状态迁移到
Layer 2 内部。合并后删除 message-budget.ts 全文 + pipeline.ts 调用点 +
budget/index.ts 重导出。

**结论：并入 Layer 2。** 删除 message-budget.ts（324 行），
但需保留其跨消息扫描能力，不能只是"删一个调阈值"。
合并后的 `manageToolOutputLifecycle` 预计从 479 行增加到 ~550 行，
净减 ~250 行（324 + 20 pipeline 调用 - 70 新增逻辑）。

### 机制 6 策略 4 — 紧急截断（truncateFromHead）

**它是干什么的**：checkInitialBudget 的最后一招——从头部砍消息，
保留至少 3 条，对齐到 user 消息边界。

**删了会怎样**：这是静默降级的典型——用户的消息被悄悄丢弃，毫不知情。
如果预算不够，应该**诚实地拒绝**（413 + "上下文不足，请开始新会话"），
而不是默默扔掉上下文然后祈祷模型能猜出来发生了什么。

代码审查确认：`truncateFromHead` 使用平均值估算 token（非精确），
移除消息后不保证预算不超——本质是"尽力而为"的赌博。

**结论：删。** 由闸门 413 替代。更诚实，更可诊断。

### 机制 5 — Layer 3 同步 LLM 摘要（enforceContextWindow 濒死路径）

**它是干什么的**：水位 >85% 时，同步调 LLM 生成摘要替换前半段消息。

**当前调用点（4 处）**：
1. `index.ts:82` — compactBeforeStep 每步（运行时路径）
2. `budget-check.ts:125` — checkInitialBudget 策略 3（加载时路径）
3. `retry.ts:65` — handleReactiveRetry（API 错误恢复路径）
4. `checkpoint.ts:147` — generateAndPersistCheckpointSummary（后台异步路径，保留）

**删了会怎样**：事故就是最佳证据——DeepSeek 摘要调了 66 秒两次全失败，
用户干等然后崩溃。濒死时刻是**最差的调用 LLM 的时机**：
输入巨大（贵、慢、容易失败）、用户在线等（坏体验）、失败即崩溃（无兜底）。

真正有效的摘要是**后台异步**的——checkpoint 层的 `maybeCheckpointAfterRun`
已经实现了：运行结束后会话闲置时，后台生成摘要 + 锚点落库，
下次加载 `applyCheckpointOnLoad` 命中，上下文天然缩小。

同步路径唯一的价值是"单次超长会话中间不重新加载"的场景，
但这个场景应该让用户自己决定（开始新会话），而不是靠一个脆弱的同步 LLM 调用救场。

删除同步路径后，`handleReactiveRetry`（retry.ts）需要改为：Layer 2 激进压缩后
若仍超限，直接抛出 `CONTEXT_BUDGET_EXCEEDED` 而非调 `enforceContextWindow`。
这比当前行为（同步 LLM 调用大概率也失败）更可预测。

**结论：删同步路径，保留异步路径。** `enforceContextWindow` 的同步 LLM 调用逻辑
（约 250 行：`generateSummaryWithFallback`/`callWithFallback`/质量验证/
模板兜底/`findSplitIndex`）迁入 checkpoint 层作为后台摘要生成器。
同步触发改为"不通过则闸门拒绝"。`handleReactiveRetry` 改为 Layer 2 激进压缩 +
闸门 413。

### 机制 6 整体 — checkInitialBudget（277 行）

删掉策略 1（= Layer 2 的重复调用）、策略 3（= Layer 3 同步路径）、
策略 4（= 紧急截断）之后，只剩策略 2（工具过滤）。

**结论：瘦身为 ~50 行的 Agent 创建前闸门。** 逻辑变为：

```
1. 估算(消息 + 指令 + 工具) ≤ 窗口 → 放行
2. 超标 → 跑一次激进 Layer 2 → 重新估算 → 放行或 413
3. 工具过滤作为可选降级（保留策略 2）
```

### 机制 1 + 2 — 工具源头截断 + processToolOutput

两个机制做的事一样（输出超阈值时截断/落盘），但**内置工具各写各的截断
（read.ts 500 行、bash.ts 200KB），MCP/Connector 走 processToolOutput**。
两套代码、两套阈值体系。

代码审查确认具体重叠：
- `processToolOutput`（tool-output-manager.ts:277-335）：单工具输出入口，超阈值 → 持久化 + 返回预览
- 内置工具内联截断：read.ts/bash.ts 中的硬编码截断逻辑
- `TOOL_OUTPUT_CONFIGS`（tool-output-manager.ts:116-162）：每工具自定义阈值表

统一为一个 outbound 钩子后，`processToolOutput` 函数体可大幅缩减
（删除阈值判断和持久化逻辑，改为调统一钩子），TOOL_OUTPUT_CONFIGS
可合并到钩子的配置中。tool-output-manager.ts 预计从 361 行缩减到 ~150 行。

**结论：统一为一个 outbound 钩子。** 所有工具（内置 + MCP + Connector）执行后
都经过同一个函数：超阈值 → 写盘 + 返回预览 + 路径。

---

## 3. 流程对比：实施前 vs 实施后

以下追踪四条完整路径，对比每一步经过的机制数量和调用链。

### 3.1 路径 A：工具执行后（单条输出进入消息流）

**实施前**——两条路径，各走各的：

```
工具执行
    │
    ├─ 内置工具（read.ts, bash.ts, ...）
    │    └─ 各写各的硬编码截断逻辑
    │       阈值分散，不一致
    │
    └─ MCP / Connector / 其他外部工具
         └─ processToolOutput()          ← tool-output-manager.ts:277
              ├─ getToolOutputConfig()    ← 查询 TOOL_OUTPUT_CONFIGS 表
              ├─ 阈值判断（字符 + token）
              └─ 超限 → persistToDisk() + 返回预览
              
工具输出进入消息流（格式不确定，截断程度不一致）
```

**实施后**——一条路径：

```
工具执行（内置 / MCP / Connector / Skill，无差别）
    │
    └─ unifiedToolOutputHook(output, toolName, toolCallId)
         ├─ 统一阈值配置
         ├─ 超限 → 落盘 + 返回 { preview, filepath, originalSize }
         └─ 不超限 → 原样返回

工具输出进入消息流（格式一致，全部干净）
```

**消除的机制**：#1（源头截断）、#2（processToolOutput 独立体系）

---

### 3.2 路径 B：每步 API 调用前（运行时压缩，compactBeforeStep）

**实施前**——三层串联，pipeline.ts 还在外层包了 message-budget：

```
pipeline.ts: prepareStep()
    │
    ├─ Step 0?: 注入 Layer 1 hint（一次性，"请调用 compact_tool_result"）
    │
    └─ compactBeforeStep()               ← compaction/index.ts
         │
         ├─ Layer 1: applyPendingCompactions()
         │    扫描 messages → 找到 pendingCompactIds 对应的 tool-result
         │    → 替换为元信息
         │    （仅在模型主动调了 compact_tool_result 时生效）
         │
         ├─ Layer 2: manageToolOutputLifecycle()
         │    每条消息 → extractToolResultView()
         │    ├─ beyondBoundary（最近 K 步之外）→ 压缩
         │    ├─ tooLarge（>8KB）→ 压缩 + 落盘
         │    ├─ isStaleDuplicate（同文件重复读）→ 压缩
         │    └─ isError → 跳过
         │    → applyCompactionPatches() 写回
         │
         └─ Layer 3: enforceContextWindow()
              估算 tokens → 水位 >85%?
              ├─ 否 → 跳过（绝大多数情况）
              └─ 是 → 同步 LLM 摘要
                   findSplitIndex() → generateSummaryWithFallback()
                   ├─ 主模型 2 次尝试
                   ├─ fallback 模型各 1 次
                   ├─ 质量验证（LCS 检测）
                   └─ 失败 → 模板兜底

pipeline.ts: 返回后
    │
    └─ enforceToolResultBudget()         ← message-budget.ts:64
         跨消息扫描所有 tool-result
         → 按 size 排序
         → 持久化最大的直到总额低于 budget
         → applyReplacements() 替换
         → 更新 seenIds 状态（prompt cache 稳定）
```

**实施后**——两层串联，外层无额外步骤：

```
pipeline.ts: prepareStep()
    │
    │  （Layer 1 hint 注入已删除）
    │
    └─ compactBeforeStep()               ← compaction/index.ts
         │
         ├─ Layer 2: manageToolOutputLifecycle()  ← 吸收跨消息扫描
         │    单次遍历 messages：
         │    ├─ beyondBoundary（最近 K 步之外）→ 压缩
         │    ├─ tooLarge 跨消息扫描（新增）
         │    │    本轮所有 tool-result 按 size 排序
         │    │    → 持久化最大的直到总额低于阈值
         │    │    → seenIds 状态保证 prompt cache 稳定
         │    ├─ isStaleDuplicate（同文件重复读）→ 压缩
         │    └─ isError → 跳过
         │    → applyCompactionPatches() 写回
         │
         └─ （Layer 3 同步路径已删除）
              水位 >85%? → 不触发压缩，留给闸门判断

pipeline.ts: 返回后
    │
    │  （enforceToolResultBudget 已删除——已并入 Layer 2）
    │
    └─ 直接进入 API 调用
```

**消除的机制**：#3（Layer 1）、#5 同步路径（Layer 3）、#7（enforceToolResultBudget）
**保留的能力**：Layer 2 步数老化 + 超大输出落盘 + 跨消息排序扫描 + 重复读去重 + 错误保护

---

### 3.3 路径 C：Session 加载时（初始预算检查）

**实施前**——四条策略级联：

```
create.ts → checkInitialBudget()        ← budget-check.ts:57
    │
    ├─ estimateFullRequest()
    │    messages + instructions + tools + output reserve
    │
    ├─ 不超限? → passed: true（直接返回）
    │
    ├─ Strategy 1: Layer 2 激进压缩
    │    manageToolOutputLifecycle(messages, keepRecentSteps=1)
    │    → 重新估算 → 不超限? → passed: true
    │
    ├─ Strategy 2: 工具过滤
    │    filterToolsByPriority()
    │    保留核心工具 + 按优先级添加可选工具
    │    → 重新估算 → 不超限? → passed: true
    │
    ├─ Strategy 3: Layer 3 同步 LLM 摘要
    │    enforceContextWindow()
    │    同步调 LLM → 质量验证 → 模板兜底
    │    → 重新估算 → 不超限? → passed: true
    │
    └─ Strategy 4: 紧急截断
         truncateFromHead()
         从头部砍消息（平均值估算，非精确）
         对齐到 user 消息边界
         保留至少 3 条
         → passed: 尽力而为（不保证不超）
```

**实施后**——两层判断 + 闸门：

```
create.ts → checkInitialBudget()        ← budget-check.ts（~50 行）
    │
    ├─ estimateFullRequest()
    │
    ├─ 不超限? → passed: true
    │
    ├─ Layer 2 激进压缩
    │    manageToolOutputLifecycle(messages, keepRecentSteps=1)
    │    → 重新估算 → 不超限? → passed: true
    │
    ├─ 工具过滤（策略 2 保留）
    │    → 重新估算 → 不超限? → passed: true
    │
    └─ 仍超限? → passed: false
         → 调用方抛 CONTEXT_BUDGET_EXCEEDED → 413

（Strategy 3 同步 LLM 摘要、Strategy 4 紧急截断均已删除）
```

**消除的机制**：#5 同步路径（策略 3）、#6 策略 4（紧急截断）
**瘦身的机制**：#6 整体（277 行 → ~50 行）

---

### 3.4 路径 D：API 错误恢复（Reactive Retry）

**实施前**：

```
API 返回 context_length_exceeded 错误
    │
    └─ handleReactiveRetry()             ← retry.ts:40
         ├─ Layer 2 激进压缩（keepRecentSteps=1）
         └─ Layer 3 同步 LLM 摘要
              enforceContextWindow(targetPercent=0.50)
              ├─ 主模型 2 次 + fallback 各 1 次
              └─ 大概率也失败（事故数据：0/2）
```

**实施后**：

```
API 返回 context_length_exceeded 错误
    │
    └─ handleReactiveRetry()             ← retry.ts（~30 行）
         ├─ Layer 2 激进压缩（keepRecentSteps=1）
         ├─ 重新估算
         └─ 仍超限 → 抛 CONTEXT_BUDGET_EXCEEDED → 413
            （不再调同步 LLM）
```

**消除的机制**：#5 同步路径（retry.ts 调用点）

---

### 3.5 路径 E：运行结束后（后台 Checkpoint）—— 不变

```
finalize.ts → maybeCheckpointAfterRun()  ← checkpoint.ts:103
    │
    ├─ 消息太少? → 跳过
    ├─ 水位 < 50%? → 跳过
    └─ 满足条件 → generateAndPersistCheckpointSummary()
         后台异步 LLM 摘要 + 锚点落库
         失败无害，下次运行结束再试

下次加载：applyCheckpointOnLoad()
    ├─ 有 checkpoint? → [摘要消息, ...锚点之后消息]
    └─ 无 checkpoint → 全量历史
```

**此路径完全不变**——它已经是正确的设计。

---

### 3.6 汇总对比

| 维度 | 实施前 | 实施后 |
|------|--------|--------|
| 机制总数 | 8 | 3 + 1（闸门） |
| 压缩代码行数 | ~2,500 | ~1,650 |
| 工具输出入口 | 2 套（内置内联 + processToolOutput） | 1 个统一钩子 |
| 运行时压缩层 | 3 层（L1 + L2 + L3） + 外层 message-budget | 1 层（L2，吸收跨消息扫描） |
| 加载时策略 | 4 策略级联（含静默截断） | 2 策略 + 闸门（诚实拒绝） |
| 同步 LLM 调用 | 3 个调用点（compactBeforeStep / checkInitialBudget / retry） | 0 |
| 后台 LLM 调用 | 1（maybeCheckpointAfterRun） | 1（不变） |
| 超限行为 | 静默截断 / 不可靠的 LLM 摘要 / 500 崩溃 | 413 诚实拒绝 |
| 格式判断点（compaction 目录） | 2（仅在 message-view.ts） | 2（不变） |

## 4. 减完的结果：两层 + 一道闸门

```
工具执行
    │
    ▼
┌──────────────────────────────────────┐
│ 入口层：unifiedToolOutputHook        │  ← 机制 1 + 2 合并
│ 单条输出 > 阈值 → 落盘 + 预览        │     所有工具统一走
│ "任何工具输出进入消息流时已经干净"     │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 维护层：manageToolOutputLifecycle    │  ← 机制 3 + 4 + 7 合并
│ 每步 API 调用前执行：                  │     Layer 2 吸收跨消息扫描
│ - 旧 step 工具输出 → 元信息            │     + message-budget 逻辑
│ - 跨消息超大输出 → 排序+落盘+预览      │
│ - 错误输出 → 不压缩                   │
│ "历史工具输出全部替换为可找回的摘要"    │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 断面层：checkpoint（纯后台）           │  ← 机制 5 同步路径删除
│ - maybeCheckpointAfterRun             │     机制 8 保留并接管摘要生成
│   会话闲置时后台生成摘要 + 锚点落库      │
│ - applyCheckpointOnLoad               │
│   加载时从锚点继续，跳过摘要覆盖的历史    │
│ "长对话有摘要断面，加载不走全量"         │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 闸门：assertContextInvariant          │  ← 新增（~80 行）
│ 只验证，不压缩，无配置，无豁免           │
│ 超标 → 413（诚实拒绝，不静默降级）       │
│ "任何机制失效，此处兜底"                │
└──────────────────────────────────────┘
    │
    ▼
  发给模型
```

### 中游溢出的处理

这里有一个架构文档必须诚实面对的场景：

如果中游纯文本对话积累导致溢出（无工具输出可压缩，Layer 2 无效），
同步 LLM 路径已删除，闸门会拒绝 → 用户收到 413。

这是设计取舍，不是设计缺陷。同步 LLM 摘要在濒死时刻的可靠性
（事故中 0% 成功率）低于"诚实告诉用户开始新会话"。
如果你认为这个取舍不可接受，那么同步 LLM 路径不应删除——
但事故数据表明它也不工作。两者选其一：不可靠的自动恢复 vs 诚实的拒绝。

## 5. 具体删除清单

| 删除 | 涉及代码 | 预估行数 | 理由 |
|------|---------|---------|------|
| compact_tool_result 工具 | tools.ts (~15 行) | ~15 | Layer 2 tooLarge 兜底 + step 老化覆盖其功能 |
| pendingCompactIds 状态 | index.ts (~30 行), session/state.ts, session/types.ts, session/interfaces.ts (~7 行) | ~37 | 随 compact_tool_result 删除 |
| layer1HintInjected 提示注入 | pipeline.ts (~15 行) | ~15 | 模型不应该管理上下文 |
| compactionHint 注入 | agent/context/instructions.ts (~2 行) | ~2 | 同上 |
| tool-resolver 黑名单条目 | tool-resolver.ts (~3 行) | ~3 | 工具不存在后无需黑名单 |
| enforceToolResultBudget | message-budget.ts (324 行) + pipeline.ts 调用点 (~20 行) + budget/index.ts 重导出 (~2 行) | ~346 | 跨消息扫描并入 Layer 2 tooLarge 分支 |
| checkInitialBudget 策略 4 紧急截断 | budget-check.ts truncateFromHead (~60 行) | ~60 | 静默丢消息，用闸门 413 替代 |
| enforceContextWindow 同步 LLM 路径 | context-window.ts generateSummaryWithFallback/callWithFallback/质量验证/模板兜底/findSplitIndex (~250 行) | ~250 | 濒死时刻是最差的调 LLM 时机 |
| checkInitialBudget 策略 1/3 重复编排 | budget-check.ts (~100 行) | ~100 | 改为直接调 Layer 2，删除同步 Layer 3 编排 |
| retry.ts enforceContextWindow 调用 | retry.ts (~10 行) | ~10 | 改为 Layer 2 激进压缩 + 413 |
| 内置工具各写各的截断 | tools/read.ts, bash.ts (~30 行) | ~30 | 收编进统一 outbound 钩子 |
| processToolOutput 独立体系缩减 | tool-output-manager.ts (~200 行) | ~200 | 收编进统一 outbound 钩子，保留配置表 |

**新增**：
| 新增 | 预估行数 |
|------|---------|
| gate.ts（闸门，~80 行） | +80 |
| Layer 2 跨消息扫描逻辑（~70 行） | +70 |
| 统一 outbound 钩子（~60 行） | +60 |

**净效果**：删除 ~1,068 行，新增 ~210 行，**净减 ~850 行**。
机制数：8 → 3+1（维护层 + 断面层 + 入口层 + 闸门）。

## 6. 保留了但没加的东西

**Layer 2 本身不变**——它已经通过 compaction-unification-design.md 收敛了格式分发
（message-view.ts 的 extractToolResultView / applyCompactionPatches），
决策逻辑干净（479 行，格式无关）。唯一变化：吸收 message-budget 的跨消息扫描能力
（~70 行新增）。

**checkpoint 不变**——它已经是正确的设计（后台异步，失败无害）。

**工具过滤（策略 2）保留**——它是唯一"只有 Agent 创建前才能做"的事
（Agent 初始化后工具集不能改）。瘦身后的 budget-check 只做 Layer 2 + 工具过滤 + 闸门。

**token-counter.ts 的双轨格式判断**——不在本次重构范围。
compaction-unification-design.md 步骤 3 已计划将其改用 message-view 视图，
那是独立的格式收敛任务。此处不重复。

**决策日志**——不是新机制，只是把现有的 context bar 日志结构化，
让每层做了什么、为什么跳过变得可观测。这是透明性，不是复杂性。

## 7. 不变式

> **INV-1**：发给模型的请求 ≤ 窗口。闸门是唯一强制点。
> **INV-2**：被压缩的工具输出可从磁盘找回。DB 存全量，入口层+维护层落盘。
> **INV-3**：消息格式知识只在 message-view.ts。compaction-unification-design.md 已落地。

## 8. 实施步骤

每步独立可交付、测试绿、可 revert。步骤编号反映依赖关系，非严格顺序。

| 步骤 | 内容 | 验收 |
|------|------|------|
| S1 | 修缺口 A（错误保护+尺寸上限）+ 缺口 B（加载时传 storage）| lifecycle 相关测试绿 |
| S2 | 删 Layer 1（compact_tool_result + pendingCompactIds + pipeline 提示 + instructions 注入 + tool-resolver 黑名单 + session state 字段）| 全量测试绿；`grep -r "compact_tool_result\|pendingCompactIds\|layer1HintInjected" src/` 零结果 |
| S3 | enforceToolResultBudget 跨消息扫描逻辑并入 Layer 2 tooLarge 分支；删 message-budget.ts + pipeline.ts 调用点 + budget/index.ts 重导出 | 性质测试绿；message-budget.ts 不存在 |
| S4 | 删 budget-check.ts 策略 4（truncateFromHead） | 超限场景计划走 413 |
| S5 | 删 enforceContextWindow 同步 LLM 路径（~250 行）；checkpoint 层接管摘要生成；retry.ts 改为 Layer 2 激进压缩 + 413 | checkpoint 测试绿（已覆盖后台路径）；retry 测试更新 |
| S6 | 瘦身 budget-check.ts → Agent 创建前闸门（~50 行）：只保留 Layer 2 激进压缩 + 工具过滤 + 413 | budget-check 测试绿或更少 |
| S7 | 统一 outbound 钩子（所有工具执行后走同一函数）；缩减 tool-output-manager.ts | read/bash/grep/MCP/Connector 测试绿 |
| S8 | 新建 gate.ts + 决策日志 + 性质测试 | 手构超限 → 413 + 决策日志含 REJECT |

## 9. 成功判据

1. `ls packages/core/src/modules/budget/message-budget.ts` 不存在
2. `grep -r "compact_tool_result\|pendingCompactIds\|layer1HintInjected" src/` 零结果
3. `grep -r "enforceContextWindow" src/` 只剩 checkpoint 后台调用（`generateAndPersistCheckpointSummary`）和函数定义自身
4. `grep -r "truncateFromHead" src/` 零结果
5. 全量 compaction 相关测试绿，净减 ~850 行
6. 手构 525k tokens 对话 → 413 `CONTEXT_BUDGET_EXCEEDED`，不再 500 崩溃
7. `grep -c "Array.isArray.*parts\|Array.isArray.*content" compaction/*.ts` 在 message-view.ts 之外 ≤ 1（token-counter.ts 保留，不在本次范围）

## 10. 相关文档

- docs/compaction-unification-design.md — 格式统一（已完成，INV-3 已落地）
- docs/context-invariant-architecture.md — 初版重构方案（四支柱，本文档是其"做减法"简化版）
- docs/context-compaction-analysis.md — 三层压缩原始设计
