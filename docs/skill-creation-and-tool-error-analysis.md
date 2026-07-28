# Skill 创建失败与工具错误反馈问题分析

> 最后更新：2026-07-27
> 状态：实施完成并通过专项验收（错误反馈修复、技能创建恢复及 Anthropic Agent Skills 通用标准对齐均已完成）。基于会话 `A5j5lHn-oFHFf67Pc1-LR`「请求视频字幕提取技能」。

## 概览

会话 `A5j5lHn` 中用户想从 `chengfeng-videocut-skills:剪口播` 提取一个独立的「视频字幕提取」skill。最终 Agent 未能创建出可用的 skill，且最后一条消息在排查时 `read_file` 反复失败、模型输出退化。

本文拆解两个独立但相互加剧的问题，并附带一个观察：

- **问题 A**：创建的 skill 没出现在 `/` 命令面板
- **问题 B**：`read_file` 等文件工具失败时只吐 `"An error occurred."`，吞掉真实原因
- **问题 C**（附带）：模型输出退化（`<unk>` 乱码、章节重复）

核心结论：**系统已有内置 `create-skill` 技能包，无需新增 `create_skill` 工具**。问题 A 的修复应聚焦在「让 Agent 走对路 + 补反馈回路 + 补热重载缺口」，而非平行造轮子。问题 B 则是文件类工具普遍的「throw 吞错误」设计缺陷。

---

## 问题 A：创建的 skill 未出现在 `/` 命令面板

### A.1 现象

消息 [15] Agent 自称「已完成 Skill 实现」，但：

- `skill download_douyin_video` 当场返回 `Unknown skill: download_douyin_video`
- 用户在 `/` 面板搜不到该技能
- 最后消息 [21] 排查时发现 `download_douyin_video.py` 文件已不存在

### A.2 Agent 实际做了什么（消息 [15] 工具调用序列）

| 步骤 | 工具 | 输入摘要 | 结果 |
|---|---|---|---|
| [2] | `save_wiki` | name=`download_douyin_video`, category=`agent`, content=... | saved:1 success ✓（存进 Wiki 知识库）|
| [5] | `read_file` | `skills/download_douyin_video.py` | error（此时文件还没写）|
| [17] | `write_file` | `skills/download_douyin_video.py`（裸 Python 脚本）| created ✓（写到 `packages/app/skills/`）|
| [29] | `skill` | skill=`download_douyin_video` | **Unknown skill** ✗ |
| [32] | `skill` | skill=`skill-creator`, args={name,description,content...} | 加载了 skill-creator 文档（仅入上下文）|

最终 Agent 文本称「已写入 `skills/download_douyin_video.py`」，但**没有按 skill-creator 的流程产出 `SKILL.md`**。

### A.3 根因

技能加载器 [loader.ts](../packages/core/src/modules/skills/loader.ts) 用 `createMultiSourceLoader` 配置：

- `filePattern: 'SKILL.md'`（严格使用标准文件名，不扫描 `.py`；在大小写不敏感文件系统上也会拒绝实际名为 `skill.md` 的文件）
- `scanMode: 'configDir'`（要求 `<name>/SKILL.md` 子目录结构）
- `priorityOrder: ['project', 'user', 'builtin']`

配置目录由 [compute.ts](../packages/core/src/primitives/paths/compute.ts) 的 `computeProjectConfigDir`/`computeUserConfigDir` 算出（`configDir` 注入 `~/.thething`）：

- **USER**：`~/.thething/skills/<name>/SKILL.md`
- **PROJECT**：`<cwd>/.thething/skills/<name>/SKILL.md`（cwd = projectRoot = `packages/app`）
- **BUILTIN**：随包分发

用户提到的 `chengfeng-videocut-skills:剪口播` 之所以能用，是因为它在 `~/.thething/skills/chengfeng-videocut-skills/` 下，是正经的 `SKILL.md` 目录结构。Agent 的两条路径都不满足：

1. **`save_wiki`**：Wiki 是知识库，不是技能注册表，loader 根本不扫它。
2. **`write_file` 写 `.py`**：格式错（`.py` 非 `SKILL.md`，无 frontmatter）+ 位置错（plain `skills/`，非配置目录）。

#### 关键事实：系统已有内置 `create-skill` 技能

`packages/core/src/skills-builtin/create-skill/SKILL.md`（内置，随包分发）现已按 Anthropic Agent Skills 通用标准收敛，流程如下：

- Step 1: bash 取 `~/.thething/skills` 绝对路径（绕过 `~` 安拦截）
- Step 2: 收集标准 `name`、`description` 和正文；`description` 同时描述“做什么”和“何时使用”
- Step 3: 校验 `name`（≤64、`[a-z0-9-]`、无 XML、无保留词）和 `description`（非空、≤1024、无 XML）
- Step 4: 默认只写标准最小 frontmatter：`name` + `description`
- Step 5: 按渐进披露原则将细节拆入 `references/`、确定性程序放入 `scripts/`、输出资源放入 `assets/`
- Step 6: 确认 `/` 调用方式和有意添加的兼容扩展

（曾另有用户级 `skill-creator` 作为备选，已删除以收敛到单一内置 `create-skill`。）

**所以问题不是「缺少创建能力」，而是 Agent 没有走这条路。** 进一步拆成三个根因：

**根因 A-1：Agent 没有走 create-skill 流程（主因）。** 它在 [32] 加载了 skill-creator 文档，却没有执行其流程，反而用 `save_wiki` + `write_file` 走了捷径。这是模型行为问题，工具层无法完全兜底，但可以通过引导降低概率。

**根因 A-2：缺少「技能未注册」的即时反馈回路。** [29] 的 `Unknown skill` 本身就是反馈，但 Agent 没据此纠偏。`skill` 工具对未知技能名只返回错误，不引导回 create-skill，反馈信号太弱。

**根因 A-3：技能无热重载。** `dynamicReload` 默认 false，且只接了 agent（[agent-tool.ts:80](../packages/core/src/modules/agent/agent-tool.ts#L80)），skills 没有对应机制。即便 `SKILL.md` 写对了，也要重启才生效，当前会话 `/` 面板不会更新。

**附带 A-4**：Agent 把文件写到 `packages/app/skills/`（非 git 跟踪的游离目录），两次消息之间被清掉。即使格式对，这个位置也不持久。

### A.4 解决方案

> 结论：**不新增 `create_skill` 工具**。内置 `create-skill` 已是项目官方创建路径（写 SKILL.md 到 `~/.thething/skills/<name>/`），加工具是重复造轮子。修复聚焦在「让 Agent 走对路」+「补热重载缺口」。

| 方案 | 内容 | 改动位置 | 优先级 |
|---|---|---|---|
| **A-sol-1** | `skill` 工具对未知技能名返回错误时，追加引导：「要创建新技能，请用 `create-skill` 技能，它会写 `~/.thething/skills/<name>/SKILL.md`」。强化失败点的反馈回路。 | [skill.ts](../packages/core/src/modules/tools/skill.ts) unknown 分支 | ✅ P1 |
| **A-sol-2** | （已改）原计划在 `save_wiki` description 加警示；最终改为把技能创建规范统一放到系统提示（A-sol-4），保持 `save_wiki` description 纯正面。 | [save-wiki.ts](../packages/core/src/modules/tools/save-wiki.ts) | ✅ P1 |
| **A-sol-3** | （已改实现）skill 工具未命中时从磁盘重扫（`reloadSkills` 回调），让会话中途新建的技能可被调用。不 gate 在 `dynamicReload`（默认 false，实为死代码），always-on 对齐 `/api/skills` 的「直接读磁盘」理念（前端 `/` 面板本就读磁盘，真正 stale 的是 skill 工具的会话快照）。已知残留：系统提示里的技能列表仍是 session 缓存，agent 不会主动发现新技能，但显式调用能命中。 | [skill.ts](../packages/core/src/modules/tools/skill.ts) + [tools.ts](../packages/core/src/modules/agent/tools.ts) | ✅ P2 |
| **A-sol-4** | 系统提示 skill-matching 段补一句技能创建规范：技能 = 配置目录下的 `SKILL.md`（不是 `.py`、不是 Wiki 页面），要创建技能调用 `create-skill`。 | [builder.ts](../packages/core/src/modules/system-prompt/builder.ts) skill-matching 段 | ✅ P2 |

**诚实声明**：A-1 是模型行为问题，A-sol-1/2/4 只能降低失败概率、增强反馈，无法 100% 保证 Agent 走对。若要强保证，唯一手段是原子化的 `create_skill` 工具--但那与现有 create-skill 设计冲突，本次不采用，接受这个权衡。

---

## 问题 B：`read_file` 失败只显示 "An error occurred."

### B.1 现象

消息 [21] 中 3 次 `read_file` 全部 `state: output-error`、`errorText: "An error occurred."`：

| # | 输入 filePath | 真实原因 |
|---|---|---|
| 1 | `skills/download_douyin_video.py` | 文件不存在（A-4 的游离目录已被清掉）|
| 2 | `packages/app/skills/download_douyin_video.py` | 相对路径在 cwd=`packages/app` 下解析成 `packages/app/packages/app/skills/...`（双层嵌套），不存在 |
| 3 | `/Users/.../packages/app/app/api/skills/` | 是目录，不是文件 |

### B.2 根因

**根因 B-1：`read_file.execute` 对运行时错误 throw，不 return 结构化错误。**

看 [read.ts](../packages/core/src/modules/tools/read.ts) 的 `execute`：

- 权限/安全拦截：`return { error: true, message: "Path security blocked: ..." }`（模型可见真实原因）✓
- 运行时错误：**throw**
  - 文件不存在 → `await ops.access(absolutePath)` 抛 `ENOENT`
  - 路径是目录 → `throw new Error("Path is not a file: ...")`

而 `toModelOutput` 已能渲染 `❌ ${message} (${path})`（基础设施已就位），只是 `execute` 没用它。

**根因 B-2：AI SDK 默认 `onError` 把异常统一替换成通用串。**

`ai@7.0.7` 的 `toUIMessageChunk`：

```js
onError = () => "An error occurred.",
// prevent leaking server error details to the client by default
```

抛出的异常被 SDK 接住，真实 message（`ENOENT` / `Path is not a file`）被丢弃，统一替换成 `"An error occurred."`。

**根因 B-3：agent-handler.ts 存的是已替换的串。**

[agent-handler.ts:138](../packages/core/src/composition/inbound/agent-handler.ts#L138)：

```ts
errorText: String(errorsByToolCallId[toolCallId].error ?? 'Unknown error')
```

此处 `.error` 已经是 `"An error occurred."`。

**影响**：模型只看到 `"An error occurred."`，分不清「文件不存在 / 是目录 / 权限拒绝」，无法自我纠正 → 消息 [21] 里 50+ 次 `find`/`grep`/`ls`/`web_fetch`/`read_wiki_page` 疯狂试探。

**且非 read_file 独有**：已核实 [write.ts:156](../packages/core/src/modules/tools/write.ts#L156)、[edit.ts:43/90/99/118/232](../packages/core/src/modules/tools/edit.ts#L43) 同样直接 throw，同病。

### B.3 解决方案

| 方案 | 内容 | 改动位置 | 优先级 |
|---|---|---|---|
| **B-sol-1** | 文件类工具统一「catch 运行时错误 → return 结构化错误」，覆盖 read 的 MIME 探测/access/stat/read 竞态、write 的 append/create/write 失败，以及 edit 的 read/校验/write 失败。契口沿用 `toModelOutput` 的 error 分支。 | [read.ts](../packages/core/src/modules/tools/read.ts) / [write.ts](../packages/core/src/modules/tools/write.ts) / [edit.ts](../packages/core/src/modules/tools/edit.ts) | ✅ P0 |
| **B-sol-2** | 共享 `agentStreamOnError` 仅透传 `ENOENT`/`EISDIR`/`ENOTDIR`/`EACCES`，未知或可能敏感的异常保留通用脱敏串；Web chat/workbench/connector 与 CLI Agent 流均已接入。 | [stream-error.ts](../packages/core/src/modules/agent/stream-error.ts) + Web/CLI 调用层 | ✅ P0 |

两者建议都做：B-sol-1 让每个工具的常见错误信息准确，B-sol-2 作全局兜底防止遗漏。

---

## 问题 C：模型输出退化（附带观察）

### C.1 现象

消息 [21] 最终文本出现大量 `<unk><unk>...` 乱码、章节重复（多个 `## 4️⃣ Step-by-Step Plan`）、表格错乱。

### C.2 诊断结论（2026-07-27）

检查原始消息数据后确认：**是模型侧退化，不是本项目代码 bug**。证据：

1. `<unk>` 是模型流里输出的**字面字符串**，共 83 次；其中 81 个**连续成串**出现在一句话中间（`只要平台支持 "` 之后），reasoning 部分也有 2 个——说明来自模型解码器，而非存储/渲染层。
2. 章节重复（三个 `## 4️⃣` 标题）是典型的小模型重复循环（repetition loop）。
3. 全会话 22 条消息中**只有消息 [21] 受影响**——正是 50+ 次工具调用、上下文最长的那条。
4. 会话所用模型是 `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`（30B-A3B MoE nano 级小模型），且 models.json 里 `fast`/`smart`/`default` 三个别名**全部指向同一个 nano 模型**。

因果链：小模型 + 错误信息被吞（问题 B）→ 50+ 次盲目重试 → 上下文膨胀 → 解码器退化（`<unk>` 串 + 重复循环）。

处置：
- B 修好后，盲试循环的诱因已消除，C 会大幅缓解——但 nano 模型本身的能力上限（不遵循 skill-creator 指令、长上下文退化）无法靠框架修复。
- 建议：`smart` 别名至少配一个更强的模型。注意（已核实）：仅改别名**不会**让长任务自动升级——框架的复杂度自动切换（`model-switching.ts` `checkTaskComplexity`，复杂度 ≥70 时切向更高 `capabilityTier`）需要 `behavior.availableModels`（带 capabilityTier）+ `taskComplexitySwitch.enabled` 两项配置，当前均未配置，处于休眠状态；且三别名同模型时也无更强模型可切。要么手动在前端选强模型，要么补齐这两项配置激活自动切换。
- 关于扩展字段的边界：Anthropic Agent Skills 跨产品通用标准只要求 `name` 和 `description`。`model`、`effort`、`context`、`allowedTools`、`whenToUse`、`paths` 在 TheThing 中作为可选兼容扩展保留，不再由 schema 或默认模板无条件注入。其中 `model` 与 `context: 'fork'` 有 Claude Code 扩展语义先例，但 TheThing 当前仍未完成相应机械接线：`model` 只作为工具输出提示和设置页元数据，`fork` 尚无执行分支。因此兼容解析不等于运行时已生效，默认 create-skill 不生成这些字段。
- 不建议加「重复检测熔断」之类的投机性防御——先换模型观察。

---

## 解决方案总览与优先级

| 优先级 | 项 | 类型 | 改动范围 |
|---|---|---|---|
| **P0** | B-sol-1：read/write/edit return 结构化错误 | ✅ 代码 bug | 3 个工具文件 + 专项测试 |
| **P0** | B-sol-2：安全 `onError` 兜底 | ✅ 代码 bug | core 共享处理器 + Web/CLI 接线 + 专项测试 |
| **P1** | A-sol-1：`skill` 工具 unknown 分支引导 create-skill | ✅ 引导 | skill.ts + 专项测试 |
| **P1** | A-sol-2：合并入 A-sol-4（系统提示） | 引导 | ✅ |
| **P2** | A-sol-3：skill 工具未命中重扫 | 能力补齐 | ✅ skill.ts + tools.ts |
| **P2** | A-sol-4：系统提示补技能创建规范 | 引导 | ✅ builder.ts |
| **P3** | 问题 C 诊断 | 诊断 | ✅ 模型侧退化（nemotron-3-nano），见 C.2 |

建议实施顺序：**B-sol-1 → B-sol-2 → A-sol-1/2 → A-sol-3/4 → C 诊断**。以上项目均已按该顺序完成。

### Anthropic Agent Skills 标准对齐（2026-07-27）

- `SkillFrontmatterSchema` 严格校验标准字段：`name` 最大 64、仅小写字母/数字/连字符、禁止 XML 和 `anthropic`/`claude`；`description` trim 后非空、最大 1024、禁止 XML。
- `name` 是唯一标准技能标识；旧版 `id` 可兼容解析，但不再覆盖 `name`。
- `allowedTools`、`model`、`effort`、`context`、`agent`、`background`、`whenToUse`、`paths` 改为真正可选，不再向标准最小 frontmatter 注入默认值。
- loader 严格识别文件名 `SKILL.md`，bulk load 只加载 metadata；调用 Skill 后才读取 body 和目录资源。
- 内置 `create-skill` 的唯一手写真源是 `packages/core/src/skills-builtin/create-skill/SKILL.md`；`packages/core/src/modules/skills/bundled.ts` 由 `generate-bundled-skills.mjs` 确定性生成，文件头明确禁止手改。Core 的 `test` 和 `typecheck` 会先执行一致性检查，防止生成产物与标准 Skill 源文件漂移。

### Claude Code 风格运行时扩展接线（2026-07-28）

- `model` 在 Skill 激活后写入请求内 `skillTurnOverride`，支持 `fast`/`smart`/`default` alias、具体模型 ID 和 `inherit`。配置了 `availableModels` 时，alias 解析后的模型不在白名单会被静默忽略；空白名单表示没有显式限制。
- 主 Agent 的 `prepareStep` 现在返回真实 `LanguageModel`，而不是只修改 `sessionState.model` 字符串；动态模型同样套用遥测和成本中间件。SessionState 每条用户消息重建，因此覆盖只持续当前 turn 的后续步骤。
- `effort` 支持 `low`、`medium`、`high`、`xhigh`、`max`，通过每步 `providerOptions.openai.reasoningEffort` 覆盖当前 turn。
- `context: fork` 复用统一子代理执行器，Skill body（含参数替换和资源提示）作为任务 prompt，强制 `parentMessages: []`；`agent` 指定子代理类型，Skill `model` 优先于 Agent definition 的模型。
- `background` 已纳入 schema。由于当前没有持久后台 run handle 和可靠结果回收，fork 暂只支持显式 `background: false` 的同步执行；默认或显式后台请求会返回可操作错误，不进行不可靠的 fire-and-forget 伪实现。

### 实施验收（2026-07-27）

- `@the-thing/core`：类型检查通过；完整测试 **71 个测试文件、701 项测试全部通过**。
- `@the-thing/cli`：类型检查通过，CLI Agent 流已接入同一安全错误处理器。
- 新增专项覆盖：文件工具结构化错误、流错误安全透传/脱敏、unknown skill 引导、技能未命中重扫、系统提示技能创建规范，以及标准 name/description 边界、扩展兼容、`id` 不覆盖 `name`、严格 `SKILL.md` 文件名、渐进披露、turn 级模型/effort 覆盖、alias/白名单/`inherit`、同步 fork 无父历史、指定 Agent 和后台 fork 保守拒绝。
- `git diff --check` 通过。
- 严格校验会跳过现有非标准用户 Skill；验收环境中已观察到中文 `name` 和 description 内含 XML 标签的旧 Skill 被报告为无效。这是标准迁移的预期影响，需要逐个迁移其 frontmatter。
- `@the-thing/app` 全包类型检查仍有与本文方案无关的既有错误（审批恢复消息类型、Reasoning/Collapsible 组件类型等）；其中 `chat/route.ts` 的 compaction 参数类型也属于既有 UIMessage/ModelMessage 接口不匹配。本次改动的 Web 接线本身未新增类型错误。

---

## 附录：关键代码位置

| 关注点 | 路径 |
|---|---|
| 技能 frontmatter 标准 | `packages/core/src/modules/skills/types.ts` |
| 技能加载器 | `packages/core/src/modules/skills/loader.ts` |
| 配置目录计算 | `packages/core/src/primitives/paths/compute.ts` |
| 工具装配（cwd 来源） | `packages/core/src/modules/agent/tools.ts:47-66` |
| read_file 工具 | `packages/core/src/modules/tools/read.ts` |
| write_file 工具 | `packages/core/src/modules/tools/write.ts` |
| edit_file 工具 | `packages/core/src/modules/tools/edit.ts` |
| 流错误安全处理 | `packages/core/src/modules/agent/stream-error.ts` |
| Web 流错误转发 | `packages/app/lib/agent-stream-on-error.ts` |
| CLI Agent 流接线 | `packages/cli/src/interactive/hooks/useAgentStream.ts` |
| 文件错误专项测试 | `packages/core/src/modules/tools/__tests__/file-errors.test.ts` |
| 技能重扫专项测试 | `packages/core/src/modules/tools/__tests__/skill-reload.test.ts` |
| 错误脱敏专项测试 | `packages/core/src/modules/agent/__tests__/stream-error.test.ts` |
| skill 工具（调用技能、turn 覆盖、fork 入口） | `packages/core/src/modules/tools/skill.ts` |
| 每步模型/effort 覆盖 | `packages/core/src/modules/agent-control/pipeline.ts` |
| 共享子代理执行入口 | `packages/core/src/modules/agent/agent-tool.ts` |
| save_wiki 工具 | `packages/core/src/modules/tools/save-wiki.ts` |
| 错误存档点 | `packages/core/src/composition/inbound/agent-handler.ts:137-138` |
| agent 热重载参照 | `packages/core/src/modules/agent/agent-tool.ts:80` |
| 内置 create-skill | `packages/core/src/skills-builtin/create-skill/SKILL.md` |

## 附录：会话事实快照

- 会话 ID：`A5j5lHn-oFHFf67Pc1-LR`，标题「请求视频字幕提取技能」
- 消息总数：22 条（[0]–[21]）
- 技能创建发生于消息 [15]，排查发生于消息 [21]
- 消息 [21] 工具调用：约 50 次（bash ×36、read_file ×3 失败、web_fetch、read_wiki_page 等）
- `read_wiki_page download_douyin_video` 返回 `found: true`--证明内容存进了 Wiki，但 Wiki ≠ 技能注册表
- `skill download_douyin_video` 返回 `Unknown skill`--证明从未注册为 slash-command
