# 上下文压缩优化 — 合并执行计划

> 创建日期:2026-07-18
> 来源文档:
> - [context-compaction-analysis.md](./context-compaction-analysis.md)(下称"主文档"):压缩/预算机制本身的 bug 与优化
> - [built-in-tools-compaction-analysis.md](./built-in-tools-compaction-analysis.md)(下称"工具文档"):内置工具与压缩层的适配问题
>
> 核心依赖关系:主文档 P0 #1(extractToolMeta args=null)**依赖**工具文档 #1(EXTRACTORS 键名不匹配)先修——键名对不上时,专用 extractor 根本不执行,传 args 是无效功。而工具文档 #2 的"result 回显字段"方案会让主文档 #1 的 args 映射从必选变为不需要。因此两个文档必须交叉执行,不能按单文档顺序推进。

---

## 执行顺序总表

| 顺序 | 事项 | 来源 | 主要改动文件 | 工作量 | 状态 |
|---|---|---|---|---|---|
| 1 | EXTRACTORS 键名修复 + result 回显字段 + JSON 字符串兼容 | 工具文档 #1/#2(同时消掉主文档 P0 #1) | `compaction/lifecycle.ts` | 小 | ⬜ |
| 2 | ModelMessage token 统计遗漏(text / tool-call input 未计入) | 主文档 #2 | `compaction/token-counter.ts` | 小 | ⬜ |
| 3 | 中文摘要验证修复 + 摘要消息格式(.parts vs .content) | 主文档 #3/#4 | `compaction/context-window.ts`、`app/api/chat/route.ts` | 小 | ⬜ |
| 4 | `web_fetch` 阈值对齐 + originalLength 在截断前记录 | 工具文档 #3 | `tools/web-fetch.ts`、`budget/tool-output-manager.ts` | 小 | ⬜ |
| 5 | `skill`/`read_wiki_page` 纳入 compactable + 对应 extractor | 工具文档 #5 | `compaction/types.ts`、`compaction/lifecycle.ts` | 小 | ⬜ |
| 6 | 老化维度从 user 轮数改为 assistant step 计数 | 主文档 A | `compaction/lifecycle.ts` | 中 | ⬜ |
| 7 | Layer 2 压缩落盘可恢复(与 budget 合并)+ bash 超 buffer 从杀进程改为落盘 | 主文档 B + 工具文档 #4 | `compaction/lifecycle.ts`、`budget/*`、`tools/bash.ts` | 中 | ⬜ |
| 8 | 其余 P2:结构化任务状态摘要、compaction checkpoint、usage 校准、估算系数统一、价值感知压缩、grep/glob token 效率、read_file/bash toModelOutput | 主文档 D/E/F/#5/C + 工具文档 A/B/C/D | 多处 | 按需排期 | ⬜ |

关键点:

- **步骤 1 是唯一的硬前置**,做完后主文档 P0 #1 同时解决。
- **步骤 2、3 与步骤 1 互不依赖**,可以并行做;如果一次只做一件事,按序号推进即可。
- **做完前 5 步**,所有 P0/P1 级别的"信息丢失"类 bug 清零。
- **步骤 6、7 是架构改进**,建议在前 5 步完成并验证后再动。

---

## 各步骤详情与验收标准

### 步骤 1:修 extractor 断层(工具文档 #1/#2 + 主文档 #1)

改动集中在 [lifecycle.ts](../packages/core/src/modules/compaction/lifecycle.ts):

1. `EXTRACTORS` 键改为实际注册名(`read_file`、`bash`、`grep`、`glob`、`edit_file`、`write_file`、`web_fetch`),或在 `extractToolMeta` 加名字归一化层。
2. extractor 内部:`typeof result === 'string' && result.startsWith('{')` 则先 `JSON.parse`(兼容 grep/glob/web_fetch 的 JSON 字符串输出)。
3. 字段提取顺序:**result 回显字段(`result.path`/`result.command`/`result.pattern`/`result.url`)→ camelCase args → snake_case args**。args 映射不再是必选项。

**验收**:单测覆盖每个内置工具的真实输出格式,断言压缩摘要包含关键输入值——如 `Read packages/core/src/index.ts → 120 lines`、`Bash 'npm test' → exit 0: ...`、`Grep 'foo' → 12 matches in 3 files`。

### 步骤 2:修 token 统计遗漏(主文档 #2)

[token-counter.ts](../packages/core/src/modules/compaction/token-counter.ts):ModelMessage 的 `content` 数组中,`text` 项和 `tool-call` 的 input 也计入估算(当前只统计了 `tool-result`)。

**验收**:构造一条含长 text 的 assistant 消息,断言估算值 ≈ 字符数/系数,而非固定的消息开销。

### 步骤 3:修中文摘要验证与摘要消息格式(主文档 #3/#4)

- [context-window.ts](../packages/core/src/modules/compaction/context-window.ts) `validateSummaryQuality`:改为语言无关信号(长度区间 + 非复制检测),或对 CJK 按 n-gram 匹配;去掉对英文单词 `'topic'`/`'then'` 的依赖。
- summaryMessage 从 `.parts` 改为流水线实际流转的 ModelMessage `.content` 格式;`route.ts` 被动重试路径传入的消息格式与 `manageToolOutputLifecycle` 期望的一致。

**验收**:中文会话生成的 LLM 摘要通过验证不再回落模板;写一个测试验证 summaryMessage 序列化后发给模型的内容非空。

### 步骤 4:web_fetch 阈值对齐(工具文档 #3)

- [web-fetch.ts](../packages/core/src/modules/tools/web-fetch.ts) 默认 `maxLength` 降到 ≤20k(或提高 budget 侧 `web_fetch` 阈值),两者对齐。
- `originalLength` 在截断**前**记录。

**验收**:抓一个大页面,断言 `originalLength > content.length` 且 truncated 标记正确;正常网页不再触发 budget 写盘。

### 步骤 5:skill / read_wiki_page 纳入生命周期(工具文档 #5)

- `DEFAULT_COMPACTABLE`([types.ts](../packages/core/src/modules/compaction/types.ts))加入 `skill`、`read_wiki_page`。
- 新增 extractor:`Skill '<skillName>' → loaded (N chars)`、`ReadWiki '<pageName>' → N chars`。
- skill 的"任务执行期间不压缩"语义:暂以现有 keepRecentTurns 兜底,待步骤 6 的 step 老化落地后自然解决。

**验收**:长会话中旧的 skill 输出被压缩为一行元信息;当前轮正在执行的 skill 指令保持完整。

### 步骤 6:老化维度改为 step 计数(主文档 A)

`findNthUserMessageFromEnd` 改为按 assistant step(或 tool-call 序号)计算老化边界:"保留最近 K 个 step 的完整输出,更早的降级为元信息"。解决单个 user 轮内上百次工具调用永不老化的问题。

**验收**:构造一个单 user 轮 + 50 次工具调用的消息序列,断言只有最近 K 个 step 的输出保持完整;以 skill 输出作为验收用例(步骤 5 的遗留语义在此闭环)。

### 步骤 7:分层存储闭环(主文档 B + 工具文档 #4)

- Layer 2 压缩时同步落盘(复用 [tool-result-storage.ts](../packages/core/src/modules/budget/tool-result-storage.ts)),元信息带 `saved to: <path>`,压缩从有损丢弃变为可找回。
- 合并 `compaction/lifecycle` 与 `budget/message-budget` 两套"发现大 tool-result → 替换"的重叠逻辑。
- [bash.ts](../packages/core/src/modules/tools/bash.ts) 超过 200k buffer 后不再杀进程,改为把后续输出管道到磁盘文件,进程跑完返回预览 + 文件路径(与 background 模式 logFile 机制合并)。

**验收**:压缩后的任意历史输出可通过 `read_file` 找回;bash 执行超大输出命令能正常完成并返回文件路径。

### 步骤 8:P2 项(按需排期)

| 事项 | 来源 |
|---|---|
| 结构化任务状态摘要(8-section 风格替代叙事体) | 主文档 D |
| compaction checkpoint 持久化(摘要不重复生成 + prompt cache 稳定) | 主文档 E |
| usage 反馈校准 token 估算 | 主文档 F |
| 估算系数统一(2.5 vs 3.5 vs 2)+ CJK 校准 | 主文档 #5 |
| 价值感知压缩(error 保护、同文件重复读取去重、引用感知、激活 Layer 1) | 主文档 C |
| grep/glob 默认文本格式、glob limit 降为 100-200、grep per-file 上限 | 工具文档 B/C/D |
| read_file/bash 加 toModelOutput 纯文本输出(省 5-15% 转义开销) | 工具文档 A |
| agent 报告纳入 budget 持久化 | 工具文档 #5(P3) |
| 消息格式统一,消掉 `as unknown as` 双轨 | 主文档 P3 |

---

## 执行约定

- 每步完成后更新本表"状态"列(⬜ → ✅),并在对应源文档的条目上标注已完成。
- 每步以"验收标准通过 + 既有测试(`compaction/__tests__`、`budget/__tests__`)不回归"为完成定义。
- 步骤 1-5 每步单独提交,便于回溯;步骤 6、7 涉及架构调整,先在本文档补充设计要点再动手。
