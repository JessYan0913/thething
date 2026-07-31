# TheThing Wiki / Skill 改造实践审计

审计对象：`http://localhost:3000/chat/user/nqPx65q3g6Z7I8abR2j46`

审计日期：2026-07-29

## 总结论

**改造部分生效，但尚未形成可靠闭环。**

已经生效的部分主要来自系统提示和 Schema：普通搜索、安装步骤、目录分析、一次性修复没有普遍触发 Wiki；明确的概念与架构知识能以 `knowledgeType` 写入 Wiki；已有概念会先查询，安装手册式内容会被拒绝；新建 Skill 后也执行了按名称重新加载。

未完全生效的部分集中在工具层缺少不可绕过的约束：短期 commit 信息仍进入 Wiki；一次“Wiki + Skill”双重交付只完成了 Wiki；Skill 可以绕过 `create-skill` 直接用 `write_file` 创建；Agent 仍向 `save_wiki` 提交 `index` 更新；`merge` 接受目标页与来源页相同的自合并。

因此当前状态应评为：**规则方向正确，正常单目标场景有效；复杂场景仍不稳定。**

## 逐项目标判定

| 改造目标 | 判定 | 实际证据 |
|---|---|---|
| 普通搜索不自动沉淀 | 生效 | “搜索 HyperFrames 最近版本变化”只读取 Wiki 和网络资料，没有调用 `save_wiki`。 |
| 安装步骤不进入 Wiki | 生效 | README macOS 安装步骤没有写 Wiki；明确要求把安装步骤写入 Wiki 时，Agent 主动拒绝。 |
| 概念、原理、架构进入 Wiki | 生效 | 创建 `HyperFrames-Timeline-Model`、`HyperFrames-适配器模式`、`HyperFrames-渲染管道`、`依赖注入-降低耦合`，且调用携带 `knowledgeType`。 |
| 少量代码示例不误伤概念知识 | 生效 | 时间线、适配器和依赖注入页面包含 TypeScript 示例，仍被正常保存。 |
| 重复知识先查询、不重复创建 | 生效 | MCP 相关请求先读取已有页面，没有重复创建同义页面。 |
| 一次性代码修复不自动沉淀 | 生效 | 修复具体错误后运行检查，最终明确不更新 Wiki。 |
| 短期易变信息不沉淀 | 未生效 | “查最新 commit hash，并自行学习”后仍创建/更新 `HyperFrames-概述`，还提交了 `index` 更新。 |
| 明确要求 Skill 必须产出 Skill | 部分生效 | 第一次“沉淀 Wiki + 创建产品发布视频 Skill”只看到 Wiki 交付，没有新 Skill；后续单独要求插件 Skill 时才创建成功。 |
| 双重交付中 Wiki 与 Skill 不互相替代 | 未生效 | 同一轮同时要求 Wiki 和 Skill 时，工具记录只证明 Wiki 完成，Skill 子目标被遗漏。 |
| Skill 必须走标准 `create-skill` 流程 | 未生效 | `hyperframes-plugins/SKILL.md` 由 `write_file` 直接创建，违反主系统提示中的禁止规则。 |
| Skill 必须重新加载并可发现 | 生效 | 创建 `hyperframes-plugins` 后调用了 `skill` 工具按名称加载；文件 frontmatter 的 `name` 与目录一致。 |
| Skill 内容应为 AI 可执行工作流 | 部分生效 | `hyperframes-plugins` 有步骤、命令和故障排除，但主体更像面向人的安装文档；缺少清晰的输入判断、分支决策、执行边界和逐阶段 gate。 |
| Wiki `index.md` 只自动维护 | 未生效（调用边界） | `log.md` 记录多次 `update: [[index]]`，说明 Agent 仍能提交 index 操作。当前 `save_wiki` 最后会重建索引，因此手工内容没有稳定保留，但无效/危险调用没有被拒绝。 |
| 禁止 Wiki 页面自合并 | 未生效 | `log.md` 记录两次 `merge: HyperFrames-概述 → [[HyperFrames-概述]]`。工具未拒绝 `target` 与 `mergeTargets` 相同。 |

## 产物核验

### 1. `hyperframes-plugins` Skill

文件：`/Users/yanheng/.thething/skills/hyperframes-plugins/SKILL.md`

通过项：

- `SKILL.md` 存在；
- YAML frontmatter 存在；
- `name: hyperframes-plugins` 与目录名一致；
- `description` 描述了触发场景；
- 未发现 TODO；
- 未发现 `scripts/`、`references/`、`assets/` 等失效本地引用；
- 对话中进行了精确名称重新加载。

不足项：

- 通过 `write_file` 直接创建，没有走 `create-skill` 初始化与验收流程；
- 内容偏“安装说明书”，没有把 Agent 的动作组织成明确的输入分类、条件分支、停止条件和 gate；
- 硬编码版本 `0.7.82`，容易过期；
- 直接给出 `cat`、`ls` 等人工验证命令，没有定义 Agent 应如何读取结果并判定成功；
- 没有明确说明何时只解释、何时实际修改用户项目，以及执行外部安装前如何确认。

综合评价：**可发现，但交付质量只达到“可用文档型 Skill”，尚未达到稳定的 Agent 执行型 Skill。**

### 2. 产品发布视频 Skill

文件：`/Users/yanheng/.thething/skills/product-launch-video/SKILL.md`

该文件创建于 2026-06-29，修改于 2026-07-11，早于本次 2026-07-29 的实践对话。因此它是已有 Skill，不能算作本次“双重交付”新创建的结果。

它本身比 `hyperframes-plugins` 更符合执行型 Skill：有路由边界、步骤、Gate、停止条件和明确产物。但这不能弥补本轮用户要求“创建 Skill”时没有产生对应新交付的问题。

### 3. Wiki 页面

实际存在并且内容完整的页面包括：

- `hyperframes-timeline-model.md`
- `hyperframes-适配器模式.md`
- `hyperframes-渲染管道.md`
- `hyperframes-插件架构.md`
- `依赖注入-降低耦合.md`

这些页面主体以概念、架构和机制为主，整体符合新的 Wiki 定位。

需要注意：

- `hyperframes-插件架构.md` 写入了版本号 `0.7.82`。版本号可作为架构示例证据，但应标注“示例/当时版本”，不应作为长期稳定结论。
- `HyperFrames-概述` 当前没有对应文件，但 `log.md` 记录过创建、更新和自合并；其他 HyperFrames 页面仍引用 `[[HyperFrames-概述]]`，形成失效交叉链接。
- 当前 `index.md` 已由重建逻辑生成，没有继续列出缺失的 `HyperFrames-概述`，所以索引本身已自愈；问题留在页面内部链接与异常操作历史中。

## 为什么会出现“提示写了，但仍被绕过”

1. **Skill 创建规则只存在于系统提示。** `write_file` 没有针对 skills 目录的路径级拦截，因此模型仍能直接写 `SKILL.md`。
2. **`save_wiki` 的软警告只检查正文特征。** 它不能可靠判断“最新 commit hash”等时效性内容，也不能阻止 Agent 提交 `index`。
3. **`knowledgeType` 只证明模型选了一个类型。** 当前工具没有验证内容是否真的与该类型匹配，时效性信息仍可被包装成 architecture/concept。
4. **双重交付没有任务完成账本。** 系统提示要求 Wiki 不能替代 Skill，但运行时没有检查用户请求中的两个交付是否都产生了可验证产物。
5. **`merge` 缺少参数不变量。** 没有拒绝 target 出现在 mergeTargets 中，也没有去重和至少两个不同页面的要求。

## 建议的代码补强顺序

### P0：工具层硬约束

1. 在 `save_wiki` 中拒绝 `name/target` 为 `index` 或 `log` 的任何 Agent 操作；索引和日志只能由内部函数维护。
2. 在 `merge` 前校验：
   - `target` 不得出现在 `mergeTargets`；
   - `mergeTargets` 去重后至少包含一个不同来源页；
   - 所有来源页必须存在；
   - 合并完成后执行链接/索引 lint。
3. 对 skills 根目录增加写入守卫：当目标为 `**/SKILL.md` 且没有 `create-skill` 流程上下文时拒绝 `write_file`/`edit_file`。

### P1：交付闭环

4. 为“创建 Skill”建立结构化完成条件：记录 `create-skill` 调用、目标目录、验收结果、精确名称 reload；缺任何一项都不能向用户报告完成。
5. 对多目标请求建立 deliverable checklist，例如 `wikiPageCreated` 与 `skillCreatedAndReloaded`，最终回复前逐项验证。
6. 将 `hyperframes-plugins` 的内容质量验收扩展为：触发条件、输入分类、步骤、工具、异常/停止条件、Gate、最终产物必须齐全。

### P2：Wiki 稳定性

7. 为 `save_wiki` 增加时效性元数据或稳定性声明，例如 `stability: stable | versioned | transient`；`transient` 默认拒绝写 Wiki，`versioned` 必须带来源版本和核验日期。
8. `wiki-lint` 增加失效 `[[...]]` 链接检测，并在保存后返回告警；当前应能发现 `[[HyperFrames-概述]]` 已无对应页面。
9. 将操作手册检测从简单正则升级为“正文主体分类 + 软警告”，继续允许概念文章中的少量命令示例。

## 最终判断

这轮实践证明前述改造已经改善了 Agent 的默认行为，但还没有解决最关键的可靠性问题：**系统提示可以引导，却不能充当权限边界和交付验收器。**

下一轮改造应停止继续堆提示词，优先把以下三条变成代码级不可绕过规则：

1. `save_wiki` 不能操作 `index/log`，不能自合并；
2. 创建 Skill 不能绕过 `create-skill` 和 reload 验收；
3. 多交付请求必须逐项产生可验证产物后才能报告完成。
