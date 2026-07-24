# 上下文压缩机制重构方案

> 状态:设计待审,**未实施**。审阅通过后按"实施顺序"分步落地。
> 依据:2026-07-24 通读当前 compaction 模块(19 文件 / 3824 行)全部代码,非记忆。

## 一、为什么重构

抖音下载原理丢失事故后,我们逐点打了补丁(删 Layer 2.5、L3 保尾部、tool-result 路径补回)。
每个补丁都堵住了具体 case,但都是**在系统侧替 Agent 猜"该保什么"**,而且是在
一个已经 19 文件、两条并行压缩路径的结构上继续叠加。补丁修得越多,越说明问题不在
某一层,而在结构。本方案不再加机制,目标是**收敛**。

## 二、当前机制真实全貌(代码事实)

系统有**两条独立压缩路径**,各切各的:

**路径 A — 加载时 checkpoint**
- 落库:`finalize.ts:72` → `maybeCheckpointAfterRun`(运行结束后台,>50% 水位触发)
- 生成:`context-window.ts:45` `generateAndPersistCheckpointSummary`,用 `SUMMARY_SYSTEM_PROMPT`
- 加载:`checkpoint.ts:61` `applyCheckpointOnLoad` → `[摘要, ...锚点后消息]`
- split:从尾部往前留 ≈30% token(`checkpoint.ts:152`)

**路径 B — 每步请求前 compactBeforeStep**(`index.ts:36`)
- Layer 0 视图(前缀替换) → Layer 2 工具输出老化 → (超限才)Layer 3 LLM 摘要 → forceTruncate 兜底
- 摘要:`emergency-summary.ts` 用 `EMERGENCY_SUMMARY_PROMPT`(与 A 不同的另一套)
- split:压中间段 60%(`emergency-summary.ts` splitMessages)

**闸门 — assertContextInvariant**(`gate.ts`)
- 只验证不压缩,超限抛 413
- **仅接入建 Agent 入口**(`create.ts:282`),每步请求路径 B 未接

## 三、结构性问题(按严重度)

### 问题 1:两条路径各切各的,不共享 split / 摘要 / 锚点 —— 最严重

- 两套 split 逻辑(尾部 30% vs 中间 60%)、两套 keep 比例、**两个摘要提示词**
  (`SUMMARY_SYSTEM_PROMPT` 5 段 + 校验 + 增量,`EMERGENCY_SUMMARY_PROMPT` 4 段无校验)
- 一条对话可能先被 A 摘要、加载后再被 B 摘要一遍,交接处无人负责
- 抖音事故正发生在这类交接缝隙。**这是"修了很多次还漏"的根源**

### 问题 2:全管线用"位置"决定该保什么,Agent 从不参与 —— 最根本

- 路径 A、B、forceTruncate 全是位置启发式(首条 user + 尾部 N 条)
- 系统在**赌**哪些信息重要;唯一真正知道"下一步依赖什么"的是 Agent 自己,它却不参与
- 已加的"保尾部""路径补回"都是替 Agent 猜,再准也是猜 —— 决策权错位
- 修不动的证据:结论若落在中间段,L3 摘要会把它改写降精度,forceTruncate 直接丢弃

### 问题 3:闸门只接了一个入口 —— 安全底线漏

- `assertContextInvariant` 号称"唯一强制点",但每步请求路径(`pipeline.ts:175`、
  `state.ts:138`)压缩完不过闸门直接发
- forceTruncate 若没压够,没有最后拦截 → 静默发超标请求或 413 由 provider 抛

### 问题 4:19 文件 3824 行,失败静默降级

- L3 失败→悄悄 forceTruncate;checkpoint 失败→悄悄全量
- 每层单独合理,合起来没有一处能回答"这次请求为什么变成现在这样"

## 四、目标架构 -- 一条干净的压缩路径

一句话:**压缩由懂任务的主模型自己做,不再用专门的小模型 + 拍扁文本 + 位置预切去猜该保什么;压缩完所有请求过同一道闸门。**

整条路径只有一个入口、一次压缩、一道闸门,顺流而下不分叉:

```
① 触发(系统侧,与现状一致)
   · A 运行结束 idle 后台(>50% 水位,无用户等待)
   · B 每步前濒死(prepareStep 内超阈值,用户等待但到极限必须压)
                       │
                       ▼
② Agent 压缩(主模型,自带任务上下文) ── 核心变化
   输入 = 真实 ModelMessage(增量:上一轮摘要 + 锚点后新消息),不拍扁不预切,按当前模型窗口 W 裁定(默认成功)
   主模型读自己的对话,自决保留:
     · prose 摘要(用户目标 / 进度结论 / 卡点下一步)
     · 原样保留项(文件路径 / 命令 / 关键结论)
   输出 = [system, 摘要+保留块, 锚点后最新消息] ─▶ 落 summaryStore
                       │
                       ▼
③ 闸门 · gateFromEstimation(复用 ② 末尾估算,零新增开销)
   ├─ ≤ 窗口 ─▶ PASS ─▶ 发送
   └─ > 窗口 ─▶ REJECT ─▶ 抛 413(不静默截断,不偷偷 forceTruncate)
                       │
                       ▼
                    模型
```
注:"锚点后最新消息"若单条超 W,由 Layer 2(工具输出老化+落盘)在摘要前置处理,责任不归压缩层。Layer 2 先于 ② 执行,确保摘要输入每条 bounded ≤ W。

重载时:`applyCheckpointOnLoad` 命中已存摘要就直接 `[摘要, ...锚点后]`,不重跑 LLM。

对比现状,这条路径"干净"在三处:
1. **一个压缩器,且由 Agent 驱动**:不再 A/B 两套,也不再用专门 compactModel(haiku)+ 拍扁 `role:text` + `slice(0,800)` 截断 + 两个提示词。主模型读真实对话,自带任务上下文。
2. **决策权回到 Agent**:压缩什么由懂任务的模型决定,不是位置启发式。旧 P3 的 `remember_context` 工具因此不再需要 -- Agent 压缩时自然保留;`restoreMissingPaths` 这类确定性补回继续作为不依赖模型的保真兜底。
3. **一道闸门**:压缩完必经 gate,REJECT 显式 413;无 forceTruncate 静默截断,失败不偷砍 prose。

两个支柱对应四个问题:
- **Agent 驱动的统一压缩器** -> 解问题 1(两路径缝隙)+ 问题 2(决策权错位)
- **闸门全接 + 决策日志** -> 解问题 3、4(安全底线 + 可观测)

## 五、实施顺序(关键:每步都能独立验证,后一步依赖前一步兜底)

### P1. 闸门接入所有请求路径 —— 先做,纯验证零风险

**接入点(读码后确认,比预想简单):**
- 每步请求的必经点是 `pipeline.ts` 的 `prepareStep`:它先调 `sessionState.compact`
  (`pipeline.ts:176`,内部即 `state.ts:123` 或 `create.ts:305` 注入的 compactBeforeStep),
  **随后 L183-196 已经为 context bar 做了一次 `estimateFullRequest`**。
- 因此闸门只需接**一处**:prepareStep 末尾、return 前,**复用这次已有的估算**,
  不新增估算开销。`state.ts` 不需要单独接(它只被 pipeline 调用)。

**改动:**
1. `gate.ts` 增加纯函数 `gateFromEstimation(estimation): GateResult`
   (把现有 `assertContextInvariant` 的判定/日志部分抽出来;后者变成
   "估算 + gateFromEstimation" 的组合,行为不变)
2. `pipeline.ts` prepareStep 在 context bar 估算后调 `gateFromEstimation`,
   REJECT → 抛 `CONTEXT_BUDGET_EXCEEDED`(上层已有该错误的 413 映射,见 create.ts:274)

**已知限制(写明,不隐藏):**
- prepareStep 的估算依赖 `config.instructions != null && config.tools`(L183 条件);
  条件不满足时无法估算,闸门跳过——与现状一致,不新增风险
- 验证:构造 forceTruncate 也压不下去的请求,断言抛 413 而非静默发出

### P2. 统一为 Agent 驱动的压缩 -- 消除缝隙 + 决策权回 Agent

核心:压缩由主模型(`state.model`)做,不再用专门的 compactModel(haiku)+ 拍扁文本 + 位置预切。这是本方案的根变化,直接解问题 1 与问题 2。

- 合并两套摘要器为一套:删除 `emergency-summary.ts` 的 `emergencySummarize` + `EMERGENCY_SUMMARY_PROMPT` 与 `context-window.ts` 的 `generateAndPersistCheckpointSummary` + `SUMMARY_SYSTEM_PROMPT`,收敛为单一 `agentCompress`。
- 模型:用主模型(任务上下文在消息里,主模型读得懂)。成本敏感时由 modelSwapper 降级,但默认主模型保质量 -- 这是用成本换质量,与用户优先级一致,也是 Claude Code auto-compact 的做法。
- 输入:传真实 `ModelMessage`(保留 toolCall / toolResult 结构、文件路径原文),不再 `role: text` 拍扁、不再 `slice(0,800)` 截断。
- 去位置预切:不再"中间 60% 摘要 / 尾部 30% 原样"。改为最小切分 -- 只把"锚点之前的老消息"交给 Agent 压缩,锚点之后原样保留(连续对话引用)。切什么由锚点定,不由百分比赌。
- 单一提示词:一个自指涉的 COMPRESSION_PROMPT("你在继续自己的任务,压缩到能无缝接手;文件路径 / 命令 / 关键结论原样保留")。两套旧提示词的差异(5 段 vs 4 段、3000 vs 1500 上限)归一。
- 保真兜底:`restoreMissingPaths` 这类确定性补回保留(不依赖模型行为,保证找回路径不丢)。
- 摘要默认成功(输入按 W 裁定);极端情况结果仍超限 -> 闸门 413,不 forceTruncate。
- 验证:同一段老消息经 A(idle)和 B(濒死)产出结构一致的摘要;抖音场景回归(结论 prose 压缩后仍可引用)。

### P3. 触发、落库与重载 -- 让 Agent 摘要只算一次

旧 P3 的 `remember_context` 工具不再需要:Agent 自己压缩时已自决保留,无需运行中另开工具声明。本步处理 Agent 压缩的编排,确保摘要只算一次、跨重载复用。

- 触发时机沿用现状差异:A 运行结束 idle 后台(无用户等待,主模型慢慢压);B 每步前濒死(用户等待,但到极限必须压)。两者都调 P2 的 `agentCompress`。
- 落库:Agent 产出的[摘要 + 保留块]写入 summaryStore(复用现有 store + `buildSummaryMessage` 格式)。A 路径天然落库;B 路径成功后也落库,避免下一步重算。
- 重载:`applyCheckpointOnLoad` 不变 -- 命中已存摘要就直接 `[摘要, ...锚点后]`,不重跑 LLM。A/B 落库格式统一后,重载对两者一致。
- 增量:已有锚点的会话,只对锚点之后的新消息做增量压缩(沿用 `context-window.ts` 现有增量逻辑,搬进 `agentCompress`)。
- 保真增强(若实践中发现 Agent 压缩对某些 verbatim 项保真不足再考虑,不是基线):可加 `remember_context` 工具让 Agent 运行中钉住必须原样的项。基线不加,保持收敛。
- 验证:运行结束 idle 压缩落库 -> 重载命中 -> 首请求即达标;濒死压缩 -> 落库 -> 下一步不重算。

### P4. 决策日志 -- 可观测,收尾

原则与前三步一致:**收敛**。路径只有一道闸门,日志也只在闸门处汇总发一条,而非每层各打各的 `logger.info`(那正是问题 4"没有一处能回答为什么"的来源)。

- **一处汇总**:所有请求都过闸门,闸门是唯一天然汇合点。各层往已有 `CompactionTelemetry` record,gate 末尾读出拼成一行发出,不各层独立打日志。
- **记因果链**(示例格式):
  ```
  [Compaction] conv=xxx trigger=B
    L2:   aged=3 offloaded=2 freed=45k            (工具输出老化/落盘)
    ②:    fired anchor=@42 in=78k->out=6k retained=8   (Agent 压缩:锚点/输入/摘要/保留块)
    ③gate: PASS 82% (188k/230k)                   (闸门:结论+利用率)
  ```
- **trigger 必记**:A(idle)/ B(濒死)/ none(未触发)。A/B 两套最难查的就是"到底谁切的"。
- **② in->out 必记**:直接验证"输入按 W 裁定"不变式,`in` 应恒 ≤ W。`in > W` 出现即 Layer 2 前置漏了单条超 W(见四节边界),日志立刻暴露职责越界。
- **REJECT 带 breakdown**:沿用 `gate.ts` 现有 `msgs+inst+tools+out` 明细;413 时一行定位哪部分撑爆。
- **skip 记原因**:`prepareStep` 估算依赖 `instructions != null && tools`,不满足时闸门跳过,必须留痕,否则又是静默降级。
- **不做**:不建新遥测系统、不落库、不做 dashboard;仅补齐 `CompactionTelemetry` 记录点,gate 处 flush 一行。P4 是收尾,不引入新复杂度。
- 验证:构造病态单条超 W 请求,断言日志输出 REJECT 行且含 breakdown;构造闸门跳过场景,断言记 skip 原因。

## 六、非目标(本次不做)

- 不动 token 估算 / tokenizer / 增量估算(`token-counter.ts` 等)—— 与结构问题无关
- 不改前端水位展示(`compaction-view.ts` 的 writer 部分)
- 不追求删文件数指标;收敛是结果,不是目标。P2 完成后 `emergency-summary.ts` 与
  `context-window.ts` 的摘要逻辑合并,自然减负

## 七、风险与回退

- **P1 可能让 413 显式化**:原本静默截断(forceTruncate)勉强发出的请求,现在若仍超限则显式 413。
  但 Layer 2(工具输出老化 + 落盘)+ 增量摘要(输入按 W 裁定)让常态路径够不到 413;真触达时是病态单条 > W,显式报错优于静默截断(抖音式丢 prose),不要求用户开新会话
- **P3 保留区可能被 Agent 滥标**:靠 token 上限 + 提示词约束控制;上限打满时退化为纯摘要,
  即当前行为,不会更差
- 每步独立可回退:P1 单独上线即有价值;P2、P3 各自有回归用例,失败只影响本步

