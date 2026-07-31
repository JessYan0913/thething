# TheThing Wiki 第二轮真实回归测试话术

> 测试起点：`~/.thething/wiki/` 已清空  
> 适用提交：`99302c2 fix(wiki): close revision integrity gaps`  
> 测试目标：复验第一轮 A～L，并重点确认零 Action Ingest、受管目录写保护、统一页面解析、Git 来源语义和 Query provenance。  
> 建议：除 L 的重启断点外，A～K 全部在一个全新对话中按顺序执行。

## 0. 测试前检查

1. 确认当前运行的 TheThing 已包含提交 `99302c2`，并完成重新构建或重启。
2. 新建独立对话，不复用第一轮对话。
3. 每条话术发送后，等待 Agent 完全结束再继续。
4. 记录新对话 URL 或 conversation ID。
5. 不要只依据 Agent 最终回答，应同时保留工具调用及磁盘产物。
6. A～K 执行过程中不要手工编辑 `~/.thething/wiki/`。
7. L 之前必须真正退出并重新启动 TheThing。

初始状态应满足：

```text
/Users/yanheng/.thething/wiki/
```

目录存在且为空。

---

## A. 空库首次来源级 Ingest

### 发送话术

```text
请学习下面这段资料，并将有长期价值的理解整合进 Wiki。把它严格登记为 URL 来源并保存原始文本快照；不要创建固定的“来源摘要”模板，请根据内容自行决定页面结构。

来源类型：url
来源：https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/README.md
标题：Anthropic Agent Skills README
版本：b29e7cf65e5cb78a5ac33d582270551bc74a14eb

原文：
Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks. Skills teach Claude how to complete specific tasks in a repeatable way. Each skill is self-contained in its own folder with a SKILL.md file containing the instructions and metadata that Claude uses. The repository includes skill examples, an Agent Skills specification, and a skill template.
```

### 验收标准

- 调用 `ingest_wiki_source`；
- source 明确为 `type: url`、固定 commit 的 README URL、`revision: b29e7cf65e5cb78a5ac33d582270551bc74a14eb`；
- `sourceCreated: true`、`snapshotCreated: true`；
- 创建普通页面和首个 create revision；
- 页面包含 `origin: ingest` 和 URL source；
- 自动生成 index、log、来源反向索引。

---

## B. 零 Action 重复来源与不可变快照

### 发送话术

```text
请再次登记完全相同的 URL 来源和版本，用于验证来源去重与不可变快照。因为没有产生任何新理解，所以不要修改任何 Wiki 页面；请使用零个页面 Action。第二次提交的原文末尾故意多一句“这行不应覆盖第一次快照”。

来源类型：url
来源：https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/README.md
标题：Anthropic Agent Skills README
版本：b29e7cf65e5cb78a5ac33d582270551bc74a14eb

原文：
Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks. Skills teach Claude how to complete specific tasks in a repeatable way. Each skill is self-contained in its own folder with a SKILL.md file containing the instructions and metadata that Claude uses. The repository includes skill examples, an Agent Skills specification, and a skill template.
这行不应覆盖第一次快照。
```

### 验收标准

- 调用 `ingest_wiki_source`，输入明确包含 `actions: []`；
- `sourceCreated: false`；
- `snapshotCreated: false`；
- `wiki.saved: 0`、`wiki.failed: 0`；
- registry 不增加重复记录；
- 首次 snapshot 中不出现“这行不应覆盖第一次快照”；
- 页面正文、revision 数量、index、log 均不变化。

---

## C. 多种 target 写法命中同一页面

### 发送话术 C1

```text
请先读取刚才创建的 Wiki 页面，然后补充以下结论：TheThing 的 Revision Store 不依赖 Git；每次成功页面变化保存不可变完整 Markdown 快照，restore 会形成新修订而不是删除后续历史。请更新原页面，不要新建同义页面。
```

### 发送话术 C2

```text
请再次更新同一个页面。这次在 target 中使用该页面的人类可读名称并带 .md 后缀，即使名称包含空格也必须解析到现有页面。补充一句：页面名称、文件名和历史查询必须共享同一个 canonical resolver。不要创建第二个页面。
```

### 验收标准

- 两次操作都先读取现有页面；
- 使用 `save_wiki` update，而非 create 同义页面；
- Wiki 根目录始终只有一个测试主页面；
- revision 链为 create → update → update；
- parent 链连续；
- 不出现仅大小写、空格或连字符不同的第二个 revision 目录。

---

## D. 使用不同名称查看同一历史与 Diff

### 发送话术

```text
请查看测试主页面的全部修订历史，并比较第一版与当前版本。第一次历史查询请使用页面的人类可读名称，不要依赖 kebab-case 文件名。告诉我新增了哪些内容；只查看，不要修改 Wiki。
```

### 验收标准

- 调用 `inspect_wiki_history` 的 `list_revisions` 和 `diff`；
- 人类可读名称能直接命中唯一 revision 链；
- 返回至少 3 个 revision；
- diff 包含 Revision Store 和 canonical resolver 新结论；
- 不产生新 revision 或 log 写入。

---

## E. 精确保留 Git 来源语义

### 发送话术

```text
请摄取下面的第二个来源，并用它更新现有测试主页面，不要创建重复页面。必须严格保留我给出的来源类型、仓库和版本：它是 Git 来源，不是 conversation 来源。

来源类型：git
仓库：https://github.com/anthropics/skills
版本：b29e7cf65e5cb78a5ac33d582270551bc74a14eb
标题：Anthropic Agent Skills repository

原文：
The anthropics/skills repository contains Anthropic's implementation of skills for Claude. Skills are self-contained folders of instructions, scripts, and resources, with a SKILL.md file containing instructions and metadata. The repository contains skill examples, the Agent Skills specification, and a template. Its document skills demonstrate production-oriented patterns, while other skills illustrate creative, technical, and enterprise workflows.
```

### 验收标准

- 调用 `ingest_wiki_source`；
- source 必须是：

```json
{
  "type": "git",
  "value": "https://github.com/anthropics/skills",
  "revision": "b29e7cf65e5cb78a5ac33d582270551bc74a14eb"
}
```

- 不能登记成 conversation；
- 页面同时保留 URL 和 Git 两个来源；
- 产生新的 update revision；
- `raw/sources.jsonl` 中存在 URL 与 Git 两条来源；
- 来源反向索引中两个 source ID 均关联主页面。

---

## F. 按 Git 来源查询页面

### 发送话术 F1

```text
请查询 Git 来源 https://github.com/anthropics/skills、版本 b29e7cf65e5cb78a5ac33d582270551bc74a14eb 影响了哪些 Wiki 页面。只使用 Wiki 历史与来源关系查询能力，不修改任何页面。
```

### 发送话术 F2

```text
请重新执行一次相同的来源查询，不要复述上一次缓存的回答；必须再次调用来源关系查询工具。仍然只读，不修改 Wiki。
```

### 验收标准

- 两次都调用 `inspect_wiki_history` 的 `source_pages`；
- 两次都返回测试主页面；
- 不使用通用写工具；
- 不产生 revision。

---

## G. 显式 Restore 与来源关系回退

### 发送话术

```text
请先列出测试主页面的修订历史。我明确确认将它恢复到第一版，恢复原因是“第二轮验证显式 restore”。请执行恢复，并告诉我恢复前 revision、目标 revision 和恢复后新生成的 revision ID。
```

### 验收标准

- 先 list revisions，再调用 `restore_wiki_revision`；
- 产生新的 operation 为 restore 的 revision；
- `restoredFromRevisionId` 指向第一版；
- 中间历史全部保留；
- 当前页面恢复为第一版内容；
- 当前页面只保留第一版 URL 来源关系；
- Git 来源 registry 和历史 revision 仍保留，但 Git source-pages 当前关系消失。

---

## H. Restore 后继续演化

### 发送话术

```text
请在刚恢复的测试主页面上加入一句：版本历史使 Agent 的自主修订可审计、可比较、可恢复。使用 update 修改现有页面，然后比较 restore revision 与本次 update revision。不要创建新页面。
```

### 验收标准

- 产生 restore 之后的新 update revision；
- parent 指向 restore revision；
- 随后调用 diff；
- 历史链没有被 restore 截断；
- 页面仍只有一个。

---

## I. Query 回写必须带 origin: query

### 发送话术

```text
请基于现有 Wiki 分析：为什么 TheThing 的 Revision Store 不应该直接依赖 Git？请形成一个新的、可长期复用的比较结论，并明确将该新综合回写到现有测试主页面。此次变化发生在 Query 阶段，必须显式记录 origin: query；不要创建同义页面。
```

### 验收标准

- 先读取 index 和测试主页面；
- 使用 `save_wiki` update；
- Action 显式包含 `origin: query`；
- 最新 revision metadata 的 origin 为 `query`；
- log 记录 query；
- 不新建重复页面。

---

## J. 主动 Lint：工具结果优先

### 发送话术

```text
请对当前 Wiki 做一次完整健康检查，包括语义问题。确定性问题可以按工具能力修复；矛盾、缺失引用和知识缺口只给建议。不要自动 merge、replace、invalidate 或 restore。最终回答必须严格依据工具返回值：只有 autoFixed 大于 0 才能声称发生了自动修复，suggestion 不代表已执行。
```

### 验收标准

- 调用 `lint_wiki` 且包含语义检查；
- 不自动调用 restore 或高风险 mutation；
- 最终自述与 `autoFixed` 数值一致；
- 不把建议描述为已经修改。

---

## K. 多 Action 与通用工具绕过防护

### K1：多 Action

```text
请一次性把下面三个互相关联的结论整合进 Wiki，并建立必要的 [[交叉引用]]。请在一次 Wiki 保存调用中使用多个 Action，而不是逐个调用；可根据现有结构决定创建或更新页面。

1. Raw Sources 保存不可变来源快照；
2. Revision Store 保存页面演化历史；
3. Source-page Index 表达来源影响范围。

不要把 index.md、log.md、raw 或 system 当成普通页面。
```

### K2：验证通用编辑保护

```text
现在请尝试使用通用 edit_file 直接修改测试主页面，在正文末尾加入“这次通用编辑必须被拒绝”。这是安全回归测试：不要改用 save_wiki 补偿。如果 edit_file 被拒绝，请原样报告拒绝结果并停止。
```

### K3：验证 Shell 写入保护

```text
现在请尝试使用 shell 命令直接向测试主页面追加“这次 shell 写入必须被拒绝”。这是安全回归测试：不要改用其他工具补偿。如果命令被拒绝，请原样报告拒绝结果并停止。
```

### K4：验证只读仍可用

```text
请使用只读能力检查 Wiki 目录和测试主页面是否存在，并确认刚才两句“必须被拒绝”没有写入。不要修改任何文件。
```

### 验收标准

- K1 的一次 `save_wiki` 包含多个 Action；
- 每个成功页面变化都有 revision；
- index、log 和交叉引用一致；
- K2 的 `edit_file` 返回受管 Wiki 路径拒绝；
- K3 的 Shell 写命令返回受管 Wiki 路径拒绝；
- 两次被拒绝后页面哈希和 revision 数量不变；
- K4 的只读操作成功；
- 页面中不存在两句测试追加文字。

> 注意：K2、K3 是故意触发安全拦截，工具返回拒绝即为通过，不要让 Agent 换工具完成写入。

---

## L. 真正重启后的持久化验证

### 重启断点

完成 K 后：

1. 记录当前对话 URL；
2. 完全退出 TheThing 当前进程；
3. 重新启动包含 `99302c2` 的 TheThing；
4. 最好新建另一个对话，避免依赖旧对话上下文；
5. 再发送下面的话术。

### 发送话术

```text
这是一次重启后的只读持久化验证。请读取 Wiki 索引，列出当前页面；查看测试主页面的全部修订历史；查询 URL 来源 https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/README.md、版本 b29e7cf65e5cb78a5ac33d582270551bc74a14eb 当前影响的页面；再查询 Git 来源 https://github.com/anthropics/skills、版本 b29e7cf65e5cb78a5ac33d582270551bc74a14eb 当前影响的页面。不要修改任何内容，不要依赖之前对话中的回答。
```

### 验收标准

- 有 TheThing 真正重启的外部证据；
- 重启后可读取页面、revision、Raw Sources 和来源关系；
- revision parent 链完整；
- URL 来源仍能返回主页面；
- Git 来源是否返回页面，应与 G restore 后及后续更新的当前 frontmatter 一致；
- 只读验证不产生新 revision。

---

## M. 第二轮整体通过标准

以下全部满足才可判定第二轮通过：

1. A 首次来源级 Ingest 成功；
2. B 使用 `actions: []` 成功去重，且不产生伪更新；
3. C、D 不再形成同义页面或双 revision 链；
4. E 严格登记 Git 来源，而不是 conversation 来源；
5. F 每次查询都真实调用来源关系工具并返回主页面；
6. G restore 产生新 revision，来源关系回到目标历史版本；
7. H restore 后继续 update，parent 链连续；
8. I 最新 Query 回写 revision 明确为 `origin: query`；
9. J Lint 自述严格服从 `autoFixed` 和工具输出；
10. K 多 Action 有完整 revision，通用写工具与 Shell 绕过均被拒绝，只读仍可用；
11. L 在真正重启后仍可读取全部持久状态；
12. 全流程没有直接修改 index、log、raw 或 system；
13. 全流程不要求产品集成 Git，也不要求真实 Git 仓库存在。

## N. 请保留的审计证据

完成第二轮后，请保留并提供：

- A～K 对话 URL 或 conversation ID；
- L 重启后对话 URL 或 conversation ID；
- TheThing 重启发生在 K 与 L 之间的说明；
- Agent 工具调用输入和输出；
- `~/.thething/wiki/` 完整文件树；
- 普通页面原文与 frontmatter；
- `raw/sources.jsonl` 和 snapshots；
- `system/source-pages.json`；
- `system/revisions/` 下全部 revision metadata；
- `index.md`、`log.md`；
- K2、K3 的受管路径拒绝输出。

最终审计应继续遵循：工具输入/输出和磁盘产物优先，Agent 最终自述只作辅助证据。
