# 全架构审查：LLM 决策 vs 系统环境

> 审查日期：2026-08-18
> 审查范围：子Agent 模块（`packages/core/src/modules/agent/*`）及相关 todo/归档/规划链路
> 指导思想：**LLM 负责思考，代码系统负责提供环境管理上下文，不做系统级的限制。**

---

## 一、审查结果总览

| 架构层 | 偏离点数量 | 严重度 |
| :--- | :--- | :--- |
| 工具层 | 1 | 中 |
| 执行层 | 3 | 高 |
| 上下文层 | 3 | 中 |
| 策略/规则层 | 2 | 低 |

**总体判断**：核心路由（`router.ts`）已彻底兑现设计哲学——关键词路由、父上下文启发式均已移除，由 LLM 显式选型。但系统在"交付物判定"、"输出修饰"、"上下文注入"三处仍存在替 LLM 做决策的逻辑，且均出现在 P0 主路径上。

---

## 二、逐层审查详情

### 第一层：工具层

#### 偏离点 T-1：`toModelOutput` 静默兜底文案（中）

**位置**：`agent-tool.ts:237-243`、`parallel-agent-tool.ts:299-304`

```js
toModelOutput: ({ output }) => {
  if (output && typeof output === 'object' && 'summary' in output) {
    return { type: 'text', value: result.summary };
  }
  return { type: 'text', value: 'Task completed.' };  // ← 替 LLM 编造结果
}
```

**偏离原则**：执行层"不修饰 LLM 输出"。当子 Agent 结果对象里没有 `summary` 时，系统自动注入一个并不存在的 "Task completed."——这是系统在替子 Agent（或替主 Agent 的判断）伪造一个成功结论。父 Agent 读到这句会误认为任务真的完成了。

**修复方向**：若无 `summary`，应如实暴露「子 Agent 未返回可读结论」这一事实（保留错误/空态信号），而非注入虚假成功文案。若后续引入交付物校验（见执行层 E-1），此处应与之一致。

---

### 第二层：执行层

#### 偏离点 E-1：交付物校验——系统替 LLM 判定"是否有产出"（高）

**位置**：`deliverable.ts:28-31`、`agent-tool.ts:87-103`、`parallel-agent-tool.ts:397-411`

```js
export function isSubstantiveDeliverable(summary) {
  if (!summary || summary.trim().length === 0) return false;
  return !NO_DELIVERABLE_PATTERNS.some((p) => p.test(summary));
}
```

子 Agent 成功但被认为"无实质交付物"时，系统主动降级为失败并返回指导语。这违反：

1. **任务完成判断应由 LLM 做出**——是否"有产出"是语义判断，不是词法判断。正则匹配"兜底文案"来判定"这家伙没干活"，本质是系统在替主 Agent（乃至整个编排链路）判定子 Agent 的产出价值。
2. 注释也承认这是"**保守启发式**"且"**待设计对齐 P0**"——说明设计团队尚未定案，却已上线为主路径行为。

**修复方向**：把"交付物是否实质"的信号**如实上抛**给主 Agent，由 LLM 判断该重派、该追问还是该接受，而不是系统直接降级。若保留启发式，应降级为"提示/标记"而非"拦截改写结果"。

#### 偏离点 E-2：token 预算上限 `maxTotalTokens = 200_000`（高）

**位置**：`tools.ts:176`、`executor.ts:107-109`、`executor.ts:49-52`

```js
maxTotalTokens: 200_000,
// ...
if (context.maxTotalTokens && context.maxTotalTokens > 0) {
  stopWhen.push(isTokenBudgetExceeded(context.maxTotalTokens));
}
```

这是一个**硬性终止条件**：累计 token 达 20 万即强制停止，即使子 Agent 明确表示"还差最后一步"。注释称之为"成本护栏，非完成判定"——但"成本护栏"恰恰是系统替 LLM（和替用户）预判"这个任务该花多少钱"。

**偏离原则**：执行层存在硬性终止条件即违反"不替 LLM 判断该不该继续"。

**修复方向**：区分两件事——(a) **资源护栏**（防失控烧钱）与 (b) **完成判定**（说没说完）。护栏可以作为可配置上限存在，但它不应当由**代码硬编码**一个全局限额，且触发时应是**显式的中止信号**（abort / 明确报"预算耗尽"），而不是悄然把 `stepsExecuted` 封顶后照常返回 `success: true`。当前实现触发后台与"正常跑完"路径混在同一 `success: true` 返回码里，主 Agent 无法区分。

#### 偏离点 E-3：强制摘要——在 LLM 明确"还在干活"时替换其输出（高）

**位置**：`executor.ts:207-238`

```js
if (!textContent && stepsExecuted > 0) {
  // 追加一次无工具的 LLM 调用写总结
  textContent = summaryResult.text;
}
```

当子 Agent 只做工具调用、没产出文本时，系统追加一次强制的无工具 LLM 调用，把结果**覆盖进** `textContent`——无论子 Agent 是否其实还没说完、是否本来打算继续。它假设"没写文本 = 任务该收尾了"，这是在替 LLM 判定"你该出结论了"。

**偏离原则**：执行层不应在"修饰"LLM 的输出；也不应在 LLM 还没表达完成时替它补一句"总结"。

**修复方向**：摘要应当是**可选的恢复手段**（当工具 loop 因异常/中止中断、确实无输出时兜底），而非对正常子 Agent 的固定步骤。更重要的是：它不应被标成子 Agent 的"本人产出"——应如实标注为「系统在无输出时触发的兜底摘要」，让主 Agent 知道这不是子 Agent 的原话。

---

### 第三层：上下文层

#### 偏离点 C-1：`buildContextPrompt` 把父消息截断到 6 条 + 每条摘要截断 200 字（中）

**位置**：`context-builder.ts:40-57, 62-77`

```js
const recentMessages = context.parentMessages.slice(-maxMessages);  // 6
const text = textParts.map(...).join(' ').slice(0, 200);  // 每条约 200 字
```

**偏离原则**：上下文层在"过滤信息 / 替 LLM 判断哪些内容重要"。这里系统**固定**只给子 Agent 最近 6 条、每条 200 字——这是无差别的机械截断，子 Agent 无法知道被截掉的部分是否承载关键背景。

**修复方向**：框架上，子 Agent 本应能看到完整父上下文（或至少是完整结构，而非 6×200 的碎片）。若体积必须受限，应由父 Agent（LLM）在委派 task 时主动带出关键背景（现在正是如此，模型已知任务背景），系统注入的"最近 6 条"反而是与这条意图重复且切碎的冗余。倾向：**系统不主动注入**，让 task 自带上下文；若注入，应保留结构（角色、工具结果），而非拍平为纯文本 200 字。

#### 偏离点 C-2：`buildSubAgentPrompt` 追加硬性 "Output Guidelines" / "Final Conclusion"（中）

**位置**：`context-builder.ts:22-27`

```js
prompt += `\n\n## Output Guidelines
- END your reply with a "## Final Conclusion" section: state what was accomplished...
```

**偏离原则**：指令层在"规定 LLM 怎么做"。强制要求 `## Final Conclusion` 收尾、明确"返回 RESULT 而非过程"，是在雕刻子 Agent 的输出形态，而不是提供环境。子 Agent 可能更需要先回来追问、或发现任务边界不对需要向父 Agent 澄清——此时硬性"必须以最终结论收尾"会逼它伪造结论。

**修复方向**：软化为「你可选择以结论收尾」／「父 Agent 期待你最终给出可读结论，但若你需要澄清、需要更多上下文、或发现范围不匹配，应如实说明而非编造结论」。让"是否已产出结论"由子 Agent 判断，系统不预设输出骨架。

#### 偏离点 C-3：`research.ts` / `explore.ts` 指令层内嵌"每 2-3 次调用写一段""限制 5-8 个来源"（中）

**位置**：`built-in/research.ts:24,26,36`、`built-in/explore.ts:29`

**偏离原则**：这些是"如果 X 则 Y"的硬规则——"每 2-3 个 web_fetch 后必须写一段""最多 5-8 个来源"。它们在替 LLM 预设路径。这类规则看似给模型纪律，实际是系统（通过指令文本）在替 LLM 决定研究节奏与广度。

**修复方向**：这类"节奏/上限"应移除或改写成目标导向的提示（"确保最终报告基于充分的多源证据"），把"多少来源够"的权衡交回 LLM，因任务而异。

**说明**：`research.ts:20-22` 的 "⚠️ CRITICAL: You MUST produce text output" 与 E-3 的强制摘要是**同一个问题的两面**——都是为了防止"只调工具不写结论"而在两个层面夹击 LLM。设计团队应统一决策：结论产出由 LLM 自律判断，还是系统兜底干预。二者叠加是双倍替 LLM 决策。

---

### 第四层：策略/规则层

#### 偏离点 S-1：`ToolFilterOptions` 的能力开关（connectors/skills/mcp）+ 子 Agent 禁用工具结构性剔除（低-中）

**位置**：`tool-resolver.ts:9,42-84,104`

```js
export function createSubAgentPrepareStep(...)
const SUB_AGENT_DENIED_TOOLS = new Set(['agent', 'parallel_agent']);
```

两类机制需分开看：

- **denySubAgentTools（嵌套防护）**：子 Agent 不能再派生子 Agent，这是**资源/拓扑约束**（防无限递归），属于"系统提供环境边界"，合理。它不是替 LLM 判断"该不该这样做"，而是定义"环境不允许这样"，保留。
- **connectors/skills/mcp 开关**：这些是 Agent 定义里的**能力白名单**（`definition.tools` / `definition.connectors` 等），由 Agent 作者声明它的能力域。这属于"环境配置"，不算替 LLM 决策，保留。

**无明显偏离**，此条为**确认项**。

#### 偏离点 S-2：`plan-prompt.ts` 的"5 步兜底提醒"（低）

**位置**：`agent-control/plan-prompt.ts:24-27`

```js
/** 5 步兜底：干了几步还没建清单时提醒 */
export function buildEmptyTodoReminder(): string {
  return `[任务清单为空] 已执行多步但仍未建立任务清单...`;
}
```

**偏离原则**：文档明言"复杂度 = 心智复杂度，不是步骤数"，但"已执行 5 步就提醒建清单"是**按步骤数拍板的机械规则**——与 `plan-prompt.ts:12` 自己批判的"正则判是否多步"是同一类错误，只是从"开工前"挪到了"执行中"。这在逻辑上自相矛盾。

**修复方向**：若该提醒是给 LLM 的"再判断一次"机会，应去掉"5 步"这个具体触发器（或改为不依赖步数的信号，如"长时未建清单"），避免代码预设"5 步必须建清单"。

**确认项**：`plan-prompt.ts:16` 的"并行执行决策"段（`pending 无 blockedBy → parallel_agent，有依赖 → agent 顺序`）是**指引而非规则**——它描述了环境里两类工具的区别与适用判据，由 LLM 自主判断，符合哲学。保留。

---

## 三、修复方向汇总（按优先级）

### P0（主路径上替 LLM 做决策，应优先澄清）

1. **交付物校验（E-1）**：注释自认"待设计对齐 P0"。建议设计团队定案：校验应从"系统拦截降级"改为"如实上抛信号"。若保留启发式，明确它是临时护栏并对设计透明。

2. **强制摘要（E-3）** + **research 指令夹击（C-3）**：两者是同一问题两面。统一决策"结论产出由谁负责"。若保留系统兜底摘要，须标注其为"系统兜底"而非子 Agent 原话，并仅在异常/中止路径触发。

3. **token 护栏（E-2）**：把硬编码 `200_000` 变成可配置上限，且触发时返回显式"预算耗尽"信号，与正常完成区隔，让主 Agent 有信息判断。

### P1（输出/上下文形态，改造成本低、收益明确）

4. **`toModelOutput` 兜底文案（T-1）**：不注入虚假 "Task completed."

5. **父上下文注入（C-1）**：倾向去除系统主动注入的 6×200 碎片，让 task 自带背景；若保留，保留结构而不拍平截断。

6. **硬性 Output Guidelines（C-2）**：软化为允许"澄清/追问/报告边界不匹配"，不逼伪造结论。

### P2（指令层自我矛盾，清理）

7. **"5 步"兜底触发器（S-2）**：与 `plan-prompt.ts` 自述原则矛盾，去掉步数触发器或改信号。

---

## 四、未发现偏离的确认项（环境正确）

- **路由（`router.ts`）**：无关键词路由、无父上下文启发式，agentType 由 LLM 显式选型，留空走 general——**完全符合哲学**。
- **工具白名单与能力开关（`tool-resolver.ts`）**：是环境/能力声明，非决策。
- **嵌套防护 `denySubAgentTools`**：拓扑资源约束，非替 LLM 决策。
- **`sanitize-messages.ts` / `stream-error.ts`**：纯格式修复，不涉及判断。
- **`tool-resolver` 对 agent/parallel_agent 的剔除**与 **Zod 校验、并行任务的 blockedBy 依赖检查**：前者是资源防护，后者是**阻止 LLM 的错误并行决策**——这是唯一一处"系统拦截 LLM 决策"的逻辑，但其依据是**客观的依赖事实**（blockedBy），非主观价值判断，且以"返回失败+降级指导"而非静默改写处理，属于可接受的环境护栏。

---

## 五、一句话结论

子Agent 在**选型与路由**上已彻底放权给 LLM（这是最难的部分，已做对）；剩余的偏离集中在**"产出判定"与"输出形态"**两处——系统尚未停止替 LLM 判断"有没有干成事、该怎么说话"。这两处都在 P0 主路径上，建议作为下一轮设计对齐重点。

---

# 全量模块审查（2026-08-18 第二轮）

> 范围：packages/core 除 agent 外全部模块
> 方法：分五组并行审查（编排规划 / 工具上下文 / 连接会话权限 / 存储知识 / 服务框架组装），关键偏离点已逐一读码核实

## 总体结论

全包 4 万余行中，**大多数模块高度合规**——服务层、原语层、组装层、存储层都把决策收敛为"可配置上限 / 纯数据装配 / 确定性守护"。真正的偏离集中在**三处同源问题**：① 系统在"补果·修饰输出"（补假话、模板化内容）；② 系统在"预设路径/终止"（硬轮数上限、硬规则、自动改道指令）；③ 系统在"筛选信息替 LLM 判断重要性"（top-k 打分、附件预筛、关键词过滤）。这些与本轮 agent 模块审查发现的偏离是**同一哲学病根在不同模块的表现**。

## 各处偏离点（去重后）

### A. 补果·修饰输出（执行层，最高优先级）

| # | 文件:行号 | 问题 | 方向 |
| :-- | :-- | :-- | :-- |
| A1 | `composition/inbound/agent-handler.ts:974` | `finalResponse = lastStreamText \|\| '任务已完成'`——LLM 无输出时**补假成功话** | 如实透传 finishReason/实际输出，不补断言 |
| A2 | `agent-tool.ts:242`（上轮已报） | `toModelOutput` 无 summary 时注入 `'Task completed.'` | 同上，不注入虚假结论 |
| A3 | `agent-handler.ts:722-724,967-970` | 累积 `writtenFiles` 并把文件全文拼进 responseText，LLM 没提也塞入 | 透传 LLM 原始文本，文件呈现由 LLM 决定 |
| A4 | `connector/inbound/inbound-processor.ts:83-91` | handler 后无条件 `sendReply`，失败发预设 `❌ 处理消息时出错` 模板 | 是否回复/内容由 LLM 产出，系统只做投递通道，错误原样透传 |
| A5 | `unified-output.ts:100-120` | 为工具输出补 `success/error` 结论行 | 不修饰 LLM 可见内容 |

> A1/A2 是同一个 bug 的两处：**系统在 LLM 没说出结论时替它补一句"完成了"**，父 Agent 与用户都会被误导。这是全库最危险的偏离。

### B. 预设路径 / 硬终止（执行层 + 策略层）

| # | 文件:行号 | 问题 | 方向 |
| :-- | :-- | :-- | :-- |
| B1 | `agent-handler.ts:678,681,960` | `MAX_ROUNDS = 10` 硬编码外层轮数上限，超限终止 | 并入可配置 `maxStepsPerSession`，不另设硬值 |
| B2 | `session/denial-tracking.ts:19,85-113` | 被拒达阈值注入 `请换用其他方法或工具，不要继续尝试同一操作` | 只客观报告"已被拒 N 次/原因"，由 LLM 自决下一步 |
| B3 | `system-prompt/sections/rules.ts:28-29` | 硬规则"同一路径验证 2-3 次无新发现即停止"——替 LLM 判"何时停" | 只给价值原则，停止时机交还 LLM |
| B4 | `system-prompt/sections/task-planning.ts:20-22` | 硬规则预设"何时该用 todo/submit_plan" | 规划自主由 LLM 判断 |
| B5 | `todo-write-tool.ts:110-119` | `validateSingleCompletion` 硬阻断"一次只允许一个 completed"（为单槽归档字段设的技术限制） | 改多值/队列承载 |
| B6 | `goal-prompts.ts:46-48` | 硬规则"有目标时禁止 ask_user_question" | 不预设决策路径 |
| B7 | `goal-state.ts:114-131` | `recordBlocked` 同因 3 次自动转 blocked | 由 LLM 判断"卡死"，不自动定性 |
| B8 | `bash.ts:104-135` SAFE_COMMANDS | 白名单自动放行 git commit/npm test——系统预设"这是安全操作可自动跑" | 降级透明化提示，交用户/LLM 审批 |
| B9 | `skill.ts:122-126` | 强制规定保存目录/不要 root | 只展示可选目录，不强制落点 |
| B10 | `system-prompt/sections/session.ts:84-91` | 硬性开场"问候/介绍/询问"四步 | 不预设开场行为 |
| B11 | `system-prompt/builder.ts:116-126` | skillCreationNote 硬编码"技能必须是 SKILL.md"长段判定 | 针对事故的规则注入，防事故护栏偏中度 |
| B12 | `plan-prompt.ts:16` | "多步→todo_write / 独立→parallel_agent" 预设 if-then | 分支指引交 LLM（整体方向已对，仅分支属预设） |

### C. 筛选信息·替 LLM 判断重要性（上下文层）

| # | 文件:行号 | 问题 | 方向 |
| :-- | :-- | :-- | :-- |
| C1 | `memory-query.ts:92-115` / `memory.ts rankMemories` | 三因子打分 relevance + topK 截断，前置过滤"哪些记忆重要" | 全量注入由 LLM 自选（量小时），打分仅作排序参考、截断当防塞护栏 |
| C2 | `find-skills.ts:41-58` | `scoreSkill` 打分排序返回 topK——系统预设技能相关度 | 返回全部/字面匹配，排序交 LLM |
| C3 | `connector/inbound/inbound-processor.ts:107-121` + `feishu.ts:55-64` | 附件按扩展名白名单预筛是否读内容 | 元信息/可读链接全量给 LLM 由其决定 |
| C4 | `mcp/registry.ts:526,531-546` | 工具按 modelVisible 自动分流给不给 LLM 看 | 除非硬安全边界，否则全量暴露由 LLM 判断 |
| C5 | `composition/app/create.ts:122-133,615-676` | `memoryQuery` 取"最后一条用户消息"+ 历史截最近 6 条 | 完整会话交检索层或让 LLM 决定要点 |
| C6 | `wiki-lint.ts:147-166` | 用正则判"第一句≠description"后**自动重写 description 写回** | lint 只报告不一致，由 LLM 修订 |
| C7 | `agent-handler.ts:332-344,803-808` | read/write/edit 归同一审批作用域，一次批准免后续询问 | 审批范围由用户/权限配置决定，非系统预判 |
| C8 | `goal/context-builder.ts:39-69` | 系统选"下一个待办"+ 索引池截结论 50 字符/50 条 | 由 LLM 选分支；截断仅作护栏 |
| C9 | `deterministic-compressor.ts:94-137` | 正则抽"决策"关键词作摘要 | 替 LLM 筛选重要性，改组织信息 |
| C10 | `context-window.ts:124-141` | `validateSummaryQuality` 系统判摘要好坏（照抄→丢弃） | 摘要质量由 LLM/用户判 |
| C11 | `archiver.ts:21-26,63-82` | 强制 JSON 结构 + key_facts≤5 + conclusion≤300 字 | 硬输出格式，改自由结论 |
| C12 | `memory-extract.ts:56-74` | MAX_USER_MESSAGES=12/300 字截历史再提取 | 上限仅作护栏，不主动裁剪语义 |
| C13 | `budget/tool-result-storage.ts:139-171` | generatePreview 保留头尾丢弃中间 | 属可配置上限+渐进披露，向护栏倾斜，轻度 |

## 合规护栏（明确标注，避免误报）

- **权限与安全**：`permissions/rules.ts`、`path-validation.ts`、bash 危险命令黑名单、SSRF allowed_domains、敏感路径/.env 校验——合规。
- **成本/资源**：`session/cost.ts`、`middleware/cost-tracking.ts`、`session/token-budget.ts`、`capabilities.ts`、`behavior.ts` 的 maxSteps/maxBudget/maxDenials——全部可配置上限，合规。
- **防无限递归**：denySubAgentTools、inbound 过滤 bot 自我回复、denial-count——合规。
- **纯存储/守护**：datastore、doctor、tokenizer、clock、paths、parser、scanner，cron fire-and-forget、wiki Karpathy 索引式检索、memory-prompt 引导式、context-pin（模型主动 pin）——全合规，是**环境护栏的模范**。

## 全局最需优先对齐的六大问题（跨模块同源）

1. **补假话（A1/A2）**：LLM 无输出时系统补"完成了"——父 Agent/用户会被误导。最危险。
2. **补/拼文件内容（A3/A5）**：系统把文件全文塞进回复或补结论行——修饰输出。
3. **硬轮数/硬规则/自动改道（B1/B3/B4/B2）**：系统替 LLM 决定"何时停、何时规划、下一步怎么走"。
4. **记忆/技能/附件/工具可见性 top-k 预筛（C1/C2/C3/C4）**：系统替 LLM 判断"哪些信息值得看"。
5. **todo 单完成技术限制（B5）**：为归档单槽设的硬阻断，剥夺 LLM 收尾自由。
6. **wiki/审美自动修复（C6）**：系统替 LLM 编辑内容。

> 设计团队只需对齐这六条主线，各模块的具体实现可由研发按"系统只提供环境、不做判断与修饰"的原则落地。

