# 压缩系统：从"可用"到"优秀"的路线图

> 2026-07-26 状态评估；2026-07-26 实施 gaps 2/4/5 + gap 3 场景测试 + 修 forceTruncate provenance 缺口。
> 当前：经过实战检验、有不变式保障、可用（及格偏上）。性质测试 + 可观测闭环已落地。
> 目标：优秀

## 实施进度（2026-07-26）

| 差距 | 状态 | 说明 |
|---|---|---|
| 二（性质测试） | ✅ 已实施 | `__tests__/property/invariant-property.test.ts`，fast-check 50 轮 × 4 不变式 |
| 五（可观测闭环） | ✅ 已实施 | ContextLedger.wasCompacted + recordReRead + overcompaction_detected 遥测 + 自动 pin |
| 四（模型引导） | ✅ 已实施 | renderActionLog/renderKeysOnlyActionLog 标注 [remote]/[local]/[transient] + provenance 段说明 |
| 一（合并四层） | 🟡 核心完成 | 单一分配器(lifecycle)早已落地；全合并 Layer 3 入 lifecycle 高风险延期（需改 sync->async、model 依赖，波及子 Agent 路径） |
| 三（多场景验证） | 🟡 场景完成 | `__tests__/scenario-invariants.test.ts` 4 场景（短/中/长/超大单条）；真实 DB 抽样回放延期 |

**附带修复**：场景测试抓到 forceTruncate/emergencySummarize 丢 provenance 的缺口（Layer 2.5/3/兜底都没附行动日志段），已统一用 `appendActionLogProvenance` 修复。这是性质/场景测试的价值--抓未知 bug。


## 当前在哪

8 个 commit 把一个"连读 7 次同一个文件、谎报完成"的烂泥，修到模型能从摘要里掏出 GitHub URL 去 web_fetch、正确分析目标代码。四条不变式立住（感知-行动环 / key 永不驱逐 / 语义类截断 / 读循环熔断），端到端验证过。

**但不优秀。** 因为它是补出来的，不是设计出来的。下面是到"优秀"还差的几块。

## 差距一：补偿式分层还在（架构债）

### 现状
四个独立压缩层，互相擦屁股：
- Layer 2（lifecycle）：每步 meta 化旧 tool 输出
- Layer 2.5（message-compressor）：确定性文本压缩
- Layer 3（emergency-summary）：LLM 摘要
- checkpoint（context-window）：后台摘要 + 锚点

每层有自己的"留什么"判定，层间交互面是 bug 温床（本次 tooLarge OR 绕过 staleDuplicate、route 切片 + guard 互相打架，都是层间交互出的 bug）。

### 优秀该有的样子
**一个分配器，不是四层。** 所有"留什么压什么"走一个优先级排序：
```
当前步 value(完整/截断) > 所有 key(永远全文) > 近期 value(完整) > 旧 value(meta) > 溢出(evict+台账)
```
Layer 2.5 / Layer 3 / checkpoint 都是同一个分配器在不同预算压力下的输出，不是独立机制。层间交互面归零。

### 怎么做
- 把 `message-compressor.ts` 和 `emergency-summary.ts` 的决策逻辑并入 `lifecycle.ts` 的分配器，按预算压力分档调用（小预算->确定性，大预算->LLM）。
- checkpoint 改为"分配器在低预算下产出的结构化快照"，而非独立的 LLM 摘要路径。
- 风险：大改，需要先把现有不变式测试补全（见差距二）才敢动。

## 差距二：测试是场景驱动，不是性质驱动（验证债）

### 现状
测试抓"见过的 bug"（读循环、孤儿锚点、超大消息 split 等）。下一个没见过的 bug 抓不住。

### 优秀该有的样子
**property-based 测试 + 两条不变式断言。** 随机对话生成器 + 随机压缩序列，断言：
1. 压缩后所有 tool-call 的 `input` 字段保留（key 永不驱逐）。
2. 当前步结果未被 meta（感知-行动环）。
3. 压缩后消息 ≤ 窗口上限（永不 413）。
4. 错误结果未被压缩。

跑 1000 次随机场景，不变式永不违反。这是把"抓见过的 bug"升级到"抓未知的 bug"。

### 怎么做
- 用 fast-check 或类似库写随机对话生成器（随机消息数、随机工具调用、随机输出大小）。
- 跑 `manageToolOutputLifecycle` + `compactBeforeStep` + `applyCheckpointOnLoad` 全链路。
- 断言四条不变式。
- CI 里跑 1000 次。

## 差距三：只在一条对话上验证过（覆盖债）

### 现状
A5j5lHn 是个很 adversarial 的样本（1MB read-loop + 重跑 + 歧义指令），但它是一条。edge case 一定还有。

### 优秀该有的样子
**多场景压测 + 真实对话回放。** 用历史对话（不同长度、不同工具组合、不同重跑/编辑模式）回放，验证：
- 短对话（<10 轮）：不触发任何压缩，原样返回。
- 中等对话（50 轮）：Layer 2 介入，key 全保留。
- 长对话（200 轮 + 极小 contextLimit）：Layer 3 触发，模型仍能继续任务。
- 重跑/编辑场景：孤儿锚点自愈，新摘要带 provenance。

### 怎么做
- 从 DB 抽样真实对话，回放压缩，断言不变式 + 任务可继续性（人工或 LLM judge）。
- 建立"压缩质量"基准（如：压缩后模型回复的相关性评分）。

## 差距四：模型推理层没引导（产品债）

### 现状
模型看到 provenance（GitHub URL）后，行为改善了（用 web_fetch），但仍会重复 fetch 同一文件、只读 2 个文件就说"读完了"。这是模型能力，不是压缩系统能直接管的。

### 优秀该有的样子
**系统提示词引导 + 工具语义化。** 比如：
- 系统提示词讲清"远程文件（web_fetch 抓取的）用 web_fetch 找回，本地文件用 read_file 找回"。
- context_pin 工具的 list 输出，把"哪些是远程、哪些是本地"分组，降低模型误判。
- 压缩后的 meta 信息里，远程文件标注 `[remote: web_fetch]`，本地标注 `[local: read_file]`。

### 怎么做
- 调整 `renderActionLog` / `renderKeysOnlyActionLog` 的输出格式，明确标注来源类型。
- 系统提示词加一段"如何利用压缩后的上下文继续任务"。
- 评估是否给模型一个"紧凑的上下文概览"（哪些文件读过、哪些是远程、哪些改过）作为每步注入。

## 差距五：可观测性还不够（运维债）

### 现状
有遥测（read_loop_detected、layer2_executed 等）和台账（ContextLedger）。但没有"压缩是否帮了倒忙"的闭环信号。

### 优秀该有的样子
**压缩副作用可观测。** 每次压缩记录：
- 删了什么（哪些 value 被 meta/evict）。
- 模型后续是否 re-read 了被压缩的文件（说明压缩过头了）。
- 压缩后利用率是否真的下降（如果没降，说明压缩无效）。

这些信号汇总，能主动发现"压缩在帮倒忙"的对话，而不是等用户报 bug。

### 怎么做
- `ContextLedger.recordCompaction` 已记录压缩动作。补充"后续 re-read 触发"的关联。
- 加一个"压缩有效率"指标：压缩后 N 步内模型是否 re-read 了被压的文件。
- 超过阈值（如 30% 压缩被 re-read）-> 告警 + 自动 pin。

## 优先级

| 差距 | 难度 | 收益 | 建议 |
|---|---|---|---|
| 二（性质测试） | 中 | 高（防回归） | **先做**，是其他重构的安全网 |
| 一（合并四层） | 高 | 高（消 bug 温床） | 二之后，有测试网兜底再动 |
| 五（可观测闭环） | 低 | 中 | 可并行做 |
| 三（多场景验证） | 中 | 中 | 一之后 |
| 四（模型引导） | 低 | 中 | 随时可做 |

## 一句话

**"能打、扛造、不丢关键信息"已达成。"优秀"还差：性质测试兜底 + 合并四层 + 可观测闭环。** 其中性质测试是前提--没有它，合并四层就是裸奔重构。
