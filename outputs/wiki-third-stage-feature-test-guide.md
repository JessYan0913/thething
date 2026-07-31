# TheThing Wiki 新特性回归测试指南

> 测试起点：`~/.thething/wiki/` 为空  
> 适用提交：`8b6cb57`、`4dce006`  
> 目标：验证 Raw Sources、Ingest、Revision、diff、来源反向索引、restore、Query 回写和 Lint 闭环。

## 一、测试前准备

1. 重启 TheThing，确保新代码和新的 Agent 工具已加载。
2. 每条话术发送后，等待 Agent 完全结束再继续。
3. 不要只看最终回答，同时检查：
   - 实际工具调用；
   - `~/.thething/wiki/` 文件；
   - 页面 frontmatter；
   - `system/revisions/`；
   - `system/source-pages.json`；
   - `raw/sources.jsonl` 与 `raw/snapshots/`；
   - `index.md` 和 `log.md`。
4. A～G 建议在同一个对话中顺序执行，以形成连续历史。
5. H～J 可另开新对话，测试重启后的持久化和维护能力。

## 二、A：从空库执行来源级 Ingest

### 测试话术 A1

```text
请学习下面这段资料，并将有长期价值的理解整合进 Wiki。把它登记为一个 URL 来源并保存原始文本快照；不要创建固定的“来源摘要”模板，请根据内容自行决定页面结构。

来源：https://example.com/thething-wiki-test-v1
标题：TheThing Wiki 测试资料 v1

原文：
TheThing Wiki 是由 Agent 持续维护的复利知识工件。Ingest 将来源整合进已有知识；Query 可以把新分析选择性回写；Lint 负责发现矛盾、陈旧页面、孤儿页面和知识缺口。Wiki 页面不要求固定知识类型。
```

### 预期行为

- 调用 `ingest_wiki_source`；
- 登记 URL 来源并保存文本快照；
- 创建一个或多个普通 Wiki 页面；
- 页面包含 `origin: ingest` 和 URL source；
- 自动生成 `index.md`、`log.md`；
- 自动生成首个 revision；
- 自动生成来源反向索引。

### 磁盘验收

```text
wiki/
  index.md
  log.md
  <普通页面>.md
  raw/sources.jsonl
  raw/snapshots/<source-id>.md
  system/source-pages.json
  system/revisions/<page-id>/<revision-id>.json
  system/revisions/<page-id>/<revision-id>.md
```

检查：

- `raw/sources.jsonl` 只有一条该来源记录；
- snapshot 内容与输入原文一致；
- 页面 frontmatter 中有 URL source；
- revision metadata 的 operation 为 `create`；
- `source-pages.json` 能找到该页面。

## 三、B：重复来源去重与不可变快照

### 测试话术 B1

```text
再次摄取同一个来源和同一个版本，但这次原文末尾故意增加一句“这行不应覆盖旧快照”。如果来源已经登记，请不要覆盖已有原始快照；只在确实产生新理解时更新 Wiki。

来源：https://example.com/thething-wiki-test-v1
标题：TheThing Wiki 测试资料 v1
原文：沿用上一条全文，并在末尾增加“这行不应覆盖旧快照”。
```

### 预期行为

- 可以再次调用 `ingest_wiki_source`；
- `sourceCreated: false`；
- `snapshotCreated: false`；
- `sources.jsonl` 不增加重复记录；
- 原 snapshot 不被覆盖；
- 如果页面内容没有新增价值，可以不写页面。

## 四、C：更新页面并生成 Revision

### 测试话术 C1

```text
请读取刚才创建的 Wiki 页面，并补充以下新结论：TheThing 的 Revision Store 不依赖 Git；每次成功页面变化保存不可变完整 Markdown 快照，restore 会形成新修订而不是删除后续历史。请更新原页面，不要另建同义页面。
```

### 预期行为

- 先调用 `read_wiki_page`；
- 使用 `save_wiki` 的 update；
- 不创建同义重复页面；
- 产生 operation 为 `update` 的新 revision；
- 新 revision 的 `parentRevisionId` 指向第一版。

### 磁盘验收

- 页面正文包含新增结论；
- 页面修订目录至少有 2 组 `.json + .md`；
- 第一版 snapshot 保持不变；
- `index.md` 仍只列出一个对应页面。

## 五、D：查看历史和 Diff

### 测试话术 D1

```text
请查看刚才那个 Wiki 页面的全部修订历史，并比较第一版与当前版本。告诉我新增了哪些内容；只查看，不要修改 Wiki。
```

### 预期行为

- 调用 `inspect_wiki_history`：
  - `list_revisions`；
  - `diff`；
- 不调用 `save_wiki`；
- 不调用 `restore_wiki_revision`；
- diff 包含新增 Revision Store 结论。

### 判定重点

- 工具返回至少两个 revision；
- unified diff 中有 `+` 开头的新增行；
- 只读操作不产生新 revision。

## 六、E：第二来源影响同一页面

### 测试话术 E1

```text
请摄取第二个来源，并用它修订现有页面，不要创建重复页面。

来源类型：git
仓库：example/thething
版本：commit-test-002
原文：
TheThing 在 Wiki 目录中维护 source-to-page 反向索引。该索引是派生数据，删除后可以根据页面 frontmatter 中的 sources 重建。一个来源可以影响多个页面，一个页面也可以关联多个来源。
```

### 预期行为

- 调用 `ingest_wiki_source`；
- Git 来源带 `revision: commit-test-002`；
- 更新已有页面；
- 页面保留第一个 URL 来源，并增加 Git 来源；
- 产生新的 update revision；
- `source-pages.json` 中两个 source ID 都关联该页面。

## 七、F：按来源查询影响页面

### 测试话术 F1

```text
请查询 Git 来源 example/thething、版本 commit-test-002 影响了哪些 Wiki 页面。只查询，不修改任何页面。
```

### 预期行为

- 调用 `inspect_wiki_history` 的 `source_pages`；
- 返回上一步更新的页面；
- 不扫描并改写页面；
- 不产生 revision。

## 八、G：显式 Restore

### 测试话术 G1

```text
请先列出该页面的修订历史。我确认要把它恢复到第一版，恢复原因是“验证显式 restore”。执行恢复，并告诉我恢复前版本、目标版本和恢复后新生成的 revision ID。
```

### 预期行为

- 先调用 `inspect_wiki_history`；
- 调用 `restore_wiki_revision`；
- 当前页面恢复为第一版内容；
- 产生一个新的 `restore` revision；
- 新 revision 包含 `restoredFromRevisionId`；
- 中间的 update revision 全部保留；
- `index.md`、`log.md` 和来源反向索引同步更新。

### 来源关系验收

第一版只包含 URL 来源，因此 restore 后：

- URL 来源仍关联该页面；
- 后加入的 Git 来源不再关联当前页面；
- Git 来源的历史信息仍存在于旧 revision metadata 中；
- Raw Source registry 和 snapshot 不被删除。

## 九、H：Restore 后继续更新

### 测试话术 H1

```text
在刚恢复的页面上重新加入一句：版本历史使 Agent 的自主修订可审计、可比较、可恢复。请更新现有页面，然后比较“恢复产生的版本”和“本次更新版本”。
```

### 预期行为

- update 产生 restore 之后的新 revision；
- parent 指向 restore revision；
- 随后使用 `inspect_wiki_history` 生成 diff；
- 历史链没有被 restore 截断。

## 十、I：Query 可选回写

### 测试话术 I1

```text
基于现有 Wiki 回答：为什么 TheThing 的 Revision Store 不应该依赖 Git？如果你在回答过程中形成了新的、有长期价值的比较，可以选择性回写 Wiki；如果只是复述已有内容，就不要写入。
```

### 预期行为

- 先查询 index 和相关页面；
- 正常回答当前问题；
- 不强制写 Wiki；
- 如果产生实质新比较，可以使用 `save_wiki` 且 `origin: query`；
- 如果只是复述，不调用写入工具也算通过。

### 失败判定

- 为了满足流程而机械写入；
- 创建没有新增价值的同义页面；
- 把“是否调用工具”当作回答完成条件。

## 十一、J：主动 Lint 与非破坏性语义建议

### 测试话术 J1

```text
请对当前 Wiki 做一次完整健康检查，包括语义问题。先报告发现的问题；不要自动 merge、replace、invalidate 或 restore 任何页面。
```

### 预期行为

- 调用 `lint_wiki`；
- 确定性索引问题可以自动修复；
- 矛盾、缺失引用和知识缺口只返回建议；
- 不自动调用 `restore_wiki_revision`；
- 不根据语义判断覆盖页面；
- `log.md` 记录 lint。

## 十二、K：并发与多 Action

### 测试话术 K1

```text
	请一次性把下面三个互相关联的结论整合进 Wiki，可创建或更新最多三个页面，并建立必要的 [[交叉引用]]：
	1. Raw Sources 保存不可变来源快照；
	2. Revision Store 保存页面演化历史；
	3. Source-page Index 表达来源影响范围。
	不要固定为某种知识类型，请根据现有 Wiki 结构决定页面组织。
```

### 预期行为

- 一次 `save_wiki` 或来源级 Ingest 可包含多个 Action；
- 每个成功变化都产生 revision；
- 批量完成后 `index.md`、关系索引和 `log.md` 一致；
- 不出现临时文件残留；
- 不修改 `index.md` / `log.md` 作为普通页面。

## 十三、L：重启后的持久化验证

完成前面测试后重启 TheThing，再发送：

```text
请列出当前 Wiki 的页面，并查看测试主页面的修订历史和来源影响关系。不要修改任何内容。
```

### 预期行为

- 重启后仍能读取页面、revision、Raw Sources 和来源关系；
- 不依赖当前聊天上下文恢复历史；
- 只读查询不产生新 revision。

## 十四、整体通过标准

以下全部满足才算新特性回归通过：

1. 空 Wiki 可以完成首次来源级 Ingest；
2. 相同来源版本去重且快照不可覆盖；
3. 页面每次成功变化产生不可变 revision；
4. 历史 revision 可列出、读取和 diff；
5. 来源反向索引能回答来源影响页面；
6. restore 产生新 revision，不删除后续历史；
7. restore 后来源关系与目标历史版本一致；
8. Lint 不自动执行高风险语义修改或 restore；
9. Query 回写是可选行为，不是强制验收；
10. `index.md`、`log.md`、`raw/` 和 `system/` 不被当作普通 Wiki 页面写入；
11. 重启后所有文件和历史仍可读取；
12. 全流程不要求 Git 仓库存在。

## 十五、建议保存的失败证据

如果任一步不符合预期，请保留：

- 对话 URL 或 conversation ID；
- 用户原始话术；
- Agent 工具调用输入和输出；
- `~/.thething/wiki/` 文件树；
- 目标页面原文；
- 对应 revision `.json`；
- `system/source-pages.json`；
- `raw/sources.jsonl`；
- `log.md`。

不要只记录 Agent 最终自述，磁盘产物与工具结果优先。
