# TheThing Wiki 第二轮真实对话回归审计

- 审计日期：2026-07-31
- 测试对话：`http://localhost:3000/chat/user/rf4Te9h_AYsHVl21-J5Hs`
- Conversation ID：`rf4Te9h_AYsHVl21-J5Hs`
- 适用提交：`99302c2 fix(wiki): close revision integrity gaps`
- 测试话术：`outputs/wiki-second-round-regression-test-prompts-2026-07-31.md`

## 1. 结论摘要

第二轮结果为：

- **通过：7 项**（B、D、E、F、G、H、J）
- **部分通过：4 项**（A、C、I、K）
- **证据不足：1 项**（L）
- **核心数据完整性：通过**
- **第二轮整体：尚不能判定为完整通过**

与第一轮相比，核心修复均已在真实对话中生效：

1. 零 Action 来源摄取真实可用，重复来源不再制造伪页面更新；
2. canonical resolver 能让人类可读名称、`.md` target 和文件名命中同一页面及同一 revision 链；
3. Git 来源按 `git + repository + commit` 原语义登记，没有降级为 conversation；
4. restore 生成新 revision，历史不被截断，来源关系随目标版本回退；
5. Query 回写产生 `origin: query` revision；
6. Shell 对受管 Wiki 路径的直接写入被明确拒绝；
7. 当前页面、revision 快照、来源快照和元数据哈希全部一致。

未完整通过的主要原因不再是 revision 完整性故障，而是测试执行和 Agent 行为偏差：A 额外创建了固定来源原文页面；C2 没有在该次更新前重新读取；I 没有先读 index；K2 被更早的工作区路径越界保护拦截，未实际命中新加的 managed Wiki guard；L 缺少真正重启的外部证据。

## 2. 审计方法与证据边界

本报告不以 Agent 最终自述作为唯一证据，按以下优先级核验：

1. 对话活跃链中的工具输入和输出；
2. 当前 Wiki 页面及 frontmatter；
3. `raw/sources.jsonl` 与不可变 snapshot；
4. `system/source-pages.json`；
5. 全部 revision metadata 和 Markdown snapshot；
6. `index.md`、`log.md`；
7. 当前文件 SHA-256 与 revision/source metadata 哈希。

从 `head_message_id = zCj_V4o_v8Q1uiPdIYVhQ` 沿 `parent_id` 重建活跃链：数据库共有 34 条消息，活跃链也是 34 条，没有 sibling branch 污染。

## 3. 当前磁盘产物

普通页面：

- `agent-skills.md`
- `anthropic-skills-readme.md`
- `wiki-system-architecture.md`

内部产物：

- `index.md`
- `log.md`
- `raw/sources.jsonl`
- `raw/snapshots/f98b35fb80833a86b0f4.md`
- `system/source-pages.json`
- 3 个页面 revision 目录，共 10 组 metadata/snapshot

未发现 `*.tmp` 或隐藏临时写入文件。

## 4. A～L 逐项判定

### A. 空库首次来源级 Ingest — 部分通过

通过证据：

- 调用了来源级 Ingest；
- URL、固定 README URL、commit revision 均正确；
- `sourceCreated: true`；
- `snapshotCreated: true`；
- 创建页面、create revision、index、log 和来源反向关系；
- URL snapshot 已落盘且哈希一致。

偏差：

- 用户明确要求“不要创建固定的来源摘要模板”；Agent 除 `Agent-Skills` 外，又创建了 `Anthropic-Skills-README` 原文页面。
- 原始证据本来已经由 Raw Sources snapshot 承担，额外创建普通来源原文页不符合本轮话术目标。

因此判为部分通过。这是 Agent 页面结构决策偏差，不是底层 Ingest 或 revision 故障。

### B. 零 Action 去重与不可变快照 — 通过

- 第二次调用明确包含 `actions: []`；
- `sourceCreated: false`；
- `snapshotCreated: false`；
- `wiki.saved: 0`、`wiki.failed: 0`；
- registry 中 URL 来源仅一条；
- snapshot 不含“这行不应覆盖第一次快照”；
- snapshot SHA-256 为 `6ad26f94...cd0c`，与 registry `contentHash` 完全一致；
- 没有因此产生页面 revision 或 log 记录。

首轮发现的零 Action 缺口已真实修复。

### C. 多种 target 命中同一页面 — 部分通过

通过证据：

- 两次均使用 update，没有创建同义主页面；
- `target: Agent-Skills.md` 成功命中 `agent-skills.md`；
- 主页面始终只有一个 revision 目录；
- 初始 revision 链为 create → update → update，parent 连续。

偏差：

- C1 在更新前读取了页面；C2 直接 update，更新后才读取验证，不满足“两次操作都先读取现有页面”的严格验收项。

canonical resolver 本身通过真实回归；部分通过仅来自执行顺序偏差。

### D. 人类可读名称历史与 Diff — 通过

- `list_revisions` 使用 `Agent-Skills` 命中同一 revision 链；
- 随后执行 diff；
- diff 能识别 Revision Store 与 canonical resolver 新增内容；
- 查询过程没有产生 revision 或 log mutation。

### E. Git 来源语义 — 通过

- 来源严格登记为：
  - type：`git`
  - value：`https://github.com/anthropics/skills`
  - revision：`b29e7cf65e5cb78a5ac33d582270551bc74a14eb`
- 没有降级为 conversation；
- E 时点的新 update revision 同时包含 URL 和 Git 两个来源；
- registry 中 URL 与 Git 各一条；
- E 后 Git source-pages 查询能返回 `agent-skills.md`。

说明：Git 来源没有保存 snapshot，因为该次工具输入没有把用户提供的原文放入 source `content`。本轮 E 的明确验收未要求 Git snapshot，因此不影响 E 通过，但这是可改进的 Agent 参数构造行为。

### F. 重复 Git 来源查询 — 通过

- 两次均真实调用 `source_pages`；
- 两次均返回 `agent-skills.md`；
- 没有依赖缓存复述；
- 没有产生页面 mutation。

### G. 显式 Restore 与来源关系回退 — 通过

- restore 前先列出历史；
- 目标 revision：`20260731031852046-7368b3e1e415-3b7ee3`；
- restore 新 revision：`20260731032607620-7368b3e1e415-f00442`；
- operation 为 `restore`；
- parent 指向 restore 前最新 revision；
- `restoredFromRevisionId` 正确指向第一版；
- reason 为“第二轮验证显式 restore”；
- 中间历史全部保留；
- restore revision 只保留第一版 URL 来源。

当前来源反向索引中 Git 来源已无页面关系，而 Git registry 和历史 revision 仍保留，符合 restore 语义。

### H. Restore 后继续演化 — 通过

- restore 后产生新的 update revision：`20260731032658963-6fabeadcf102-b5975f`；
- parent 正确指向 restore revision；
- 随后执行 revision diff；
- 历史链未被截断；
- 页面仍然唯一。

### I. Query 回写 provenance — 部分通过

通过证据：

- 更新现有主页面，没有创建同义页面；
- Action 显式包含 `origin: query`；
- 对应 revision `20260731032737947-c7da9c50e3c4-cb644d` 的 metadata 为 `origin: query`；
- log 记录 query。

偏差：

- 该步骤读取了主页面，但没有按验收标准先读取 index。

Query provenance 核心修复已生效，部分通过仅来自检索流程不完整。

### J. 主动 Lint 与工具结果优先 — 通过

- 调用 `lint_wiki({ semantic: true })`；
- 返回 `autoFixed: 0`、`totalIssues: 0`、`semanticIssueCount: 0`；
- 最终回答明确说明未发生自动修复；
- 没有把 suggestion 描述成已执行；
- 没有自动 merge、replace、invalidate 或 restore。

### K. 多 Action 与通用工具防护 — 部分通过

#### K1 多 Action

- 出现过一次空的 `save_wiki` 调用，输入和输出均为 null，随后 Agent重新发起有效调用；
- 有效调用在一次保存中包含两个 Action：
  - create `Wiki-System-Architecture`
  - update `Agent-Skills`
- 返回 `saved: 2`、`failed: 0`；
- 两个成功变化各自生成 revision；
- index、log 和最终交叉引用一致；
- 没有把 index、log、raw 或 system 当成普通页面。

有效调用出现“`Wiki-System-Architecture` 不存在”的交叉引用 warning，原因是同批 Action 校验时新页面尚未被后续 Action看见；最终页面与索引均正确。这反映出批量 Action 的预验证还可优化，但未破坏数据。

#### K2 通用 edit_file

- 写入没有发生；页面和 revision 均未改变；
- 但返回的是：
  `Path security blocked: 路径越界：相对路径必须在工作目录内`
- 原因是 Agent 使用 `../../../../../.thething/wiki/agent-skills.md`，先命中了工作区相对路径越界保护；没有实际命中新加的 managed Wiki path 拒绝分支。

因此安全目标达成，但 K2 的指定验收证据不足。新增 managed guard 已有单元测试覆盖，当前真实对话没有直接覆盖该分支。

#### K3 Shell 写入

- Shell 追加命令明确被 managed Wiki path 保护拒绝；
- 拒绝信息要求改用受管 Wiki mutation API；
- 未进行补偿写入。

#### K4 只读验证

- `ls`、文件读取和文本检查成功；
- 当前页面及全部 Wiki 文件中均不存在：
  - “这次通用编辑必须被拒绝”
  - “这次 shell 写入必须被拒绝”
- 两次拒绝没有生成新 revision。

K 综合判为部分通过，主要因为 K2 没命中目标 guard，而不是发生了数据损坏。

### L. 真正重启后的持久化 — 证据不足

对话中的 L 只读查询全部成功：

- index 返回 3 个页面；
- 主页面返回 8 个 revision；
- URL 来源返回 `agent-skills.md` 和 `anthropic-skills-readme.md`；
- Git 来源返回空数组，与 G restore 后当前 frontmatter 只保留 URL 来源一致；
- 没有产生新 revision。

但是：

- K 与 L 位于同一个 conversation；
- 现有数据库与磁盘证据无法证明两步之间 TheThing 进程真正退出并重启；
- 用户文本“这是一次重启后的验证”不能替代外部重启证据。

因此 L 只能判为“功能读取成功，但真正重启条件证据不足”。若确认 K 与 L 之间确实完整退出并重新启动了 TheThing，可将 L 提升为通过。

## 5. Revision 与哈希完整性核验

### 5.1 Revision 数量

- `agent-skills.md`：8 个 revision
- `anthropic-skills-readme.md`：1 个 revision
- `wiki-system-architecture.md`：1 个 revision
- 合计：10 个 revision

### 5.2 主页面 operation 序列

```text
create
→ update
→ update
→ update (加入 Git 来源)
→ restore (恢复第一版)
→ update
→ update (Query 综合)
→ update (K1 多 Action)
```

所有 `parentRevisionId` 连续，无断链或双链。

### 5.3 当前页面与最新 revision 哈希

- `agent-skills.md`
  - 当前 SHA-256：`a1df69e916db482859b35c8e46133e052e7f796b213faa3f0d5cc80071374586`
  - 最新 metadata `contentHash`：完全一致
  - 最新 revision snapshot SHA-256：完全一致
- `anthropic-skills-readme.md`
  - 当前 SHA-256：`b7b2123cb7fbb4bf34fe24e8aea0e0f7e2f5ae3ce7615a15e69a7cbe0512e89b`
  - create revision `contentHash`：完全一致
- `wiki-system-architecture.md`
  - 当前 SHA-256：`e65cb1e4f4b8a5c6054841b9fb78400ca03c34335cd63b507821ae0dbfef7807`
  - create revision `contentHash`：完全一致

第一轮出现的“当前页面内容超出 revision 链”问题已消失。

## 6. 来源与关系核验

Registry 中有且仅有两条来源：

1. URL source ID：`f98b35fb80833a86b0f4`
2. Git source ID：`08fd78d5d70f5ceab90f`

当前 source-pages：

- URL → `agent-skills.md`、`anthropic-skills-readme.md`
- Git → 无当前页面

这与 restore 后主页面 frontmatter 只保留 URL 来源一致。Git 来源没有丢失：registry 和 restore 前 revision metadata 中仍存在，只是当前关系按恢复目标版本回退。

## 7. 建议的后续处理

### P1：补一次精准 K2 真实对话

让 Agent 使用绝对路径调用通用编辑工具：

```text
/Users/yanheng/.thething/wiki/agent-skills.md
```

不要使用相对越界路径。预期应直接返回 managed Wiki path 拒绝，以补齐真实运行证据。

### P1：确认或重做 L

请确认 K 与 L 之间是否真正完整退出并重启 TheThing。若不能确认，建议：

1. 记录退出前进程 PID 或启动时间；
2. 完全退出 TheThing；
3. 重新启动并记录新 PID/启动时间；
4. 最好在新 conversation 中执行 L；
5. 再做一次纯只读核验。

### P2：约束来源页面决策

A 的问题不宜通过“禁止来源页面”这种僵硬规则修复。更合适的改进是：当 Raw Source snapshot 已保存时，Agent 应判断普通来源原文页是否提供额外长期价值；用户明确说不要固定来源摘要模板时，应优先只创建知识页面。

### P2：改善批量 Action 交叉引用预验证

同一批 Actions 中，后续 Action 引用前面将创建的页面时，不应报告“页面不存在”。可在校验阶段建立本批次 prospective page set，再检查交叉引用。

### P2：Ingest 参数完整性

用户为 Git 来源提供了原文，但 Agent 没将它传入 source `content`，所以没有 Git snapshot。若用户明确要求保存原文，应确保参数包含 content；不应依赖最终自述判断 snapshot 是否存在。

## 8. 最终判定

第二轮已经证明第一轮修复的核心技术目标基本实现，尤其是：零 Action、canonical resolver、Git provenance、restore 历史连续性、Query origin、Shell 写保护和 revision 哈希完整性。

当前不能宣布整轮完整通过，原因是：

1. A 的 Agent 页面结构选择违背明确话术；
2. C、I 有流程性读取缺项；
3. K2 没有真实命中目标 managed guard；
4. L 缺少真正重启的外部证据。

建议先补 K2 和 L 两个最关键证据；A、C、I 可作为 Agent 行为质量优化，不应据此重新引入僵硬的 Wiki 内容治理。