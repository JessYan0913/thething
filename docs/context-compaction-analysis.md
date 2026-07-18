# 上下文压缩机制分析报告

> 分析日期:2026-07-17
> 分析范围:`packages/core/src/modules/compaction/`、`packages/core/src/modules/budget/`、`packages/core/src/composition/app/create.ts`、`packages/core/src/modules/agent-control/pipeline.ts`、`packages/app/app/api/chat/route.ts`

## 现状架构概览

当前上下文管理链路由以下部分组成:

- **Layer 1 — Agent 主动释放**:`compact_tool_result` 工具(`modules/agent/tools.ts`),模型可主动标记不再需要的工具输出,`pendingCompactIds` 在下一步 `compactBeforeStep` 时被应用。
- **Layer 2 — 工具输出生命周期管理**(`compaction/lifecycle.ts`):每步 API 调用前同步执行,将超出"最近 N 个 user 轮"或超过 8000 字符的旧工具输出替换为结构化元信息(如 `Read xxx → 120 lines`),不调用 LLM,微秒级。
- **Layer 3 — 上下文窗口管理**(`compaction/context-window.ts`):当总估算超过 `contextLimit * 85%` 时,取前段消息用 LLM 生成叙事摘要,替换为一条 summary 消息,支持增量摘要(DB 存量摘要 + 新对话整合)。
- **初始预算检查**(`compaction/budget-check.ts`):首次 API 调用前按策略降级:激进 Layer 2 → 工具过滤 → Layer 3 → 紧急头部截断。
- **消息级工具结果预算**(`budget/message-budget.ts` + `tool-result-storage.ts`):单轮工具输出总额超限时,最大的先持久化到磁盘,替换为预览 + 文件路径,模型可通过 `read_file` 找回。
- **被动重试**(`compaction/retry.ts`):API 返回 context_length 错误时,激进 Layer 2(keepRecentTurns=1)+ Layer 3 紧急摘要后重试。

整体设计思路(主动释放 → 元信息替换 → LLM 摘要 + 磁盘持久化兜底)是对的,但实现中存在几个真 bug 和明显的智能化提升空间。

---

## 一、疑似 Bug(建议先修,比"优化"更紧急)

### 1. 压缩摘要丢失所有关键参数 — `args` 恒为 `null`

`lifecycle.ts:159-163` 和 `index.ts:105-109` 调用 `extractToolMeta(toolName, null, result)`,第二个参数永远是 `null`。但所有 extractor 都依赖 args:

- `Read` → 输出变成 `"Read  → 120 lines (.)"`(**文件路径丢失**)
- `Bash` → `"Bash '' → exit 0: ..."`(**命令丢失**)
- `Grep`/`Glob`/`WebFetch` 同理,pattern/URL 全丢

压缩后的元信息本该让模型知道"我曾读过 X 文件",现在只剩"我读过某个文件"。

**修法**:tool-call 的 `input` 就在同一条(或前一条)assistant 消息的 `tool-call` item 里。budget 模块的 `buildToolNameMap`(`message-budget.ts:298`)已经演示了如何建 `toolCallId → toolName` 映射,同样方式建 `toolCallId → input` 映射,把 input 传进 extractor 即可。

### 2. Token 估算严重低估 — ModelMessage 的 text 内容没被统计

`token-counter.ts:67-81`:当消息是 ModelMessage 格式(`content` 数组)时,只统计了 `tool-result` 项,**`text` 项和 `tool-call` 的 input 完全没计入**。assistant 的长回复在流水线里只按 10 token 的消息开销计算。

**后果**:`compactBeforeStep` 的触发判断持续低估,直到撞上 API 的 context_length 错误才被动兜底(而被动兜底路径本身也有问题,见 #4)。

### 3. 中文对话的 LLM 摘要几乎必然被丢弃

`context-window.ts:216-238` 的 `validateSummaryQuality` 用**空格分词**提取关键词——中文没有空格,`keyPhrases` 会变成一整段 30 字符的字串,要求它原样出现在摘要里基本不可能;逃生条件是摘要包含英文单词 `'topic'` 或 `'then'`。

**结果**:中文会话的高质量 LLM 摘要大概率验证失败,回落到 `generateTemplateSummary` 的机械模板(仅拼接最近几对 QA 的截断文本)。而本项目(TheThing 个人助手)的主要用户语言就是中文。

**修法**:验证逻辑改为语言无关的信号(长度区间 + 非复制检测,如摘要与原文的最长公共子串占比),或对 CJK 文本按 n-gram 匹配。

### 4. 消息格式双轨制导致多处静默失效

- Layer 3 生成的 summaryMessage 用 `.parts` 格式(`context-window.ts:113-120`),但 prepareStep 流水线里流转的是 ModelMessage(`.content`)。这条摘要消息在发给模型时是否被正确序列化,值得写测试验证——很可能是**空消息**,摘要白做了。
- `route.ts:305` 的 reactive retry 传入的是 UIMessage(`.parts`),但 `manageToolOutputLifecycle` 只认 `.content`(`lifecycle.ts:68`),所以被动重试里 Layer 2 是 **no-op**,只有 Layer 3 在干活。

整个 compaction/budget 模块充斥 `msg as unknown as Record<string, unknown>`,根因就是 UIMessage/ModelMessage 双格式。建议在模块边界统一成一种格式 + 一个显式转换层,消掉这类静默失效。

### 5. 估算系数不一致

- tokenizer:`chars / 2.5`(`tokenizer.ts:3`)
- lifecycle freed 估算:`chars / 3.5`(`lifecycle.ts:164`)
- budget 模块:`chars / 3.5`,JSON 用 `/ 2`

且 `/2.5` 对中文偏差很大(中文约 1~1.5 字符/token,会**低估近一倍**)→ 压缩触发过晚。至少应统一为一个常量,并按内容语言(CJK 占比)校准。

---

## 二、朝"更智能"方向的优化空间

### A. Layer 2 的老化维度不适配长 agentic 任务(影响最大)

`findNthUserMessageFromEnd`(`lifecycle.ts:285`)按 **user 消息轮数**计算老化边界。但 agentic 场景下一个 user 轮里可能有上百次工具调用——不足 N 个 user 轮时边界返回 0,**整个长任务期间旧工具输出永远不老化**,只剩 `largeOutputThreshold`(8000 字符)一条规则起作用。恰恰是"单轮内大量工具调用"最需要压缩。

**建议**:老化单位改成 **assistant step 数**(或 tool-call 序号):"保留最近 K 个 step 的完整输出,更早的降级为元信息"。这是 Claude Code 式的做法,对长任务的上下文控制是数量级的改善。

### B. Layer 2 压缩不可逆,而隔壁 budget 模块已有恢复机制

`budget/` 的持久化路径做得很好:大输出写盘 + 预览 + 文件路径,模型可以 `read_file` 找回。但 Layer 2 的元信息替换**直接销毁原文,无恢复路径**——如果模型后来发现还需要那个 grep 结果,只能重新执行(浪费时间,且 bash 类操作可能不可重放)。

**建议**:合并两套机制。Layer 2 压缩时同样落盘,元信息里带上 `saved to: <path>`。压缩从"有损丢弃"变成"分层存储"——模型永远有办法找回任何历史输出,这是质变。目前 `compaction/lifecycle` 和 `budget/message-budget` 在流水线里先后执行、职责高度重叠(都是"发现大 tool-result → 替换"),合并后也消除两次遍历和两套状态。

### C. 压缩决策从"一刀切"到"价值感知"

当前规则只有:轮次 + 大小。更智能的排序信号(实现成本从低到高):

1. **错误结果不压缩**:失败的工具输出被压成 `exit ?` 后,模型会忘记失败原因、重蹈覆辙。error 输出信息密度高、体积通常不大,应进保护逻辑。
2. **同文件重复读取去重**:同一个文件被 Read 多次,只保留最后一次完整输出,更早的直接压缩——最安全、收益最高的规则。
3. **被引用过的结果晚压缩**:后续 assistant 文本里出现了该文件路径/该输出的内容片段,说明它是当前任务的工作集,降低压缩优先级。
4. **激活 Layer 1**:`compact_tool_result` 工具设计不错但模型很少主动调用;可在上下文水位 >60% 时向系统提示注入一行提醒,把被动能力激活。

### D. Layer 3 摘要:从"叙事体"到"结构化任务状态"

当前 prompt 要求 200-500 字第三人称叙事,适合闲聊,**不适合任务型 agent**。任务中断后真正需要恢复的是:

```
- 用户目标 / 验收标准
- 已完成步骤 & 关键结论
- 涉及的文件路径及改动
- 当前卡点 / 下一步计划
- 用户明确表达过的约束与偏好
```

**建议**:改为结构化模板摘要(Claude Code 的 8-section 风格);`MAX_SUMMARY_LENGTH=3000` 可放宽——摘要的目的是保任务连续性,不是省这几百 token。

### E. 压缩结果不持久化 → 每个请求重复付费

Layer 3 的替换只作用于本次请求的内存消息;下个请求从 DB 重新加载全量历史,超过阈值就**再次触发 LLM 摘要调用**(增量摘要缓解了质量问题,但每次请求仍要付一次摘要生成的延迟和成本)。

**建议**:持久化"compaction checkpoint"(摘要 + 覆盖到的消息 order),加载历史时直接从 checkpoint 之后加载,摘要只在边界推进时重新生成。这同时改善 prompt cache 命中率——每次请求发给 API 的前缀才会稳定。

### F. 用真实 usage 反馈校准估算(低成本高收益)

每次 API 响应都带真实 `usage.input_tokens`。把 `实际 tokens / 估算 tokens` 作为校准系数做滑动平均存入 session state,后续估算乘以该系数。不引入真 tokenizer 依赖,就能把字符估算的误差从 ±50% 收敛到 ±10% 以内,让 85% 触发阈值真正可信。

---

## 三、优先级建议

| 优先级 | 事项 | 类型 | 工作量 |
|---|---|---|---|
| P0 | 修 extractToolMeta 的 args=null(#1) | bug | 小 |
| P0 | 修 ModelMessage token 统计遗漏(#2) | bug | 小 |
| P0 | 修中文摘要验证(#3)+ 摘要消息格式(#4) | bug | 小 |
| P1 | 老化维度改为 step 计数(A) | 智能化 | 中 |
| P1 | Layer 2 压缩落盘可恢复,与 budget 模块合并(B) | 架构 | 中 |
| P1 | 结构化任务状态摘要(D) | 智能化 | 小 |
| P2 | compaction checkpoint 持久化(E) | 性能/成本 | 中 |
| P2 | usage 反馈校准估算(F) | 智能化 | 小 |
| P2 | 价值感知压缩规则:error 保护、重复读取去重(C) | 智能化 | 中 |
| P3 | 消息格式统一,消掉 `as unknown as` 双轨 | 架构 | 大 |

**总体判断**:这套系统"节流"的部分(budget、持久化、紧急截断)已经比较完备,薄弱点集中在**压缩时保留什么信息**(P0 的三个 bug 都在丢关键信息)和**老化模型不匹配 agentic 工作负载**。先把 P0 修掉,P1 三项做完后,这套机制就能达到接近 Claude Code 的水准。
