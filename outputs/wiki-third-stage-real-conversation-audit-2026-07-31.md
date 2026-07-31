# TheThing Wiki 第三阶段真实对话回归审计

> 审计对象：`jluFC2O1glCPUx-sv10Ef`  
> 对话地址：`http://localhost:3000/chat/user/jluFC2O1glCPUx-sv10Ef`  
> 审计时间：2026-07-31  
> 对照指南：`outputs/wiki-third-stage-feature-test-guide.md`

## 1. 结论摘要

本轮不能判定为整体通过。A、G、H、I、J 的核心能力得到真实验证；B 的底层去重和不可变快照成立，但工具契约迫使 Agent 制造无价值页面更新；C、D 受页面目标名称未规范化影响，只能部分通过；E、F 因第二来源被登记为 conversation 而非指定 Git 来源而失败；K 完成了页面组织与交叉引用，但 Agent 直接编辑 Wiki 文件，绕过 Revision Store，破坏了“每次成功页面变化均可审计”的不变量；L 没有真正重启 TheThing，因此未执行。

综合判定：**5 项通过、4 项部分通过、2 项失败、1 项未执行。**

更重要的是，核心存储机制本身表现较好：URL 来源快照未被覆盖，主页面 7 条 revision 的 parent 链完整，restore 产生新 revision 且保留历史，来源反向索引可以从当前 frontmatter 正确表达 URL 来源关系。主要问题集中在 Agent 工具使用约束和工具输入契约，而不是 Revision Store 的基础存储实现。

## 2. 审计方法与证据优先级

### 2.1 活跃消息链

从 conversation 的 `head_message_id`：

```text
OyJjwJ-98_aKMBOnrA1Hu
```

沿 `parent_id` 逆向重建唯一活跃链，共 26 条消息。未选中的 sibling `q5ipCPnBzXMLQGJovHQHB` 被排除，避免把重试分支重复计入结果。

### 2.2 证据优先级

1. 活跃链中的工具输入和工具输出；
2. `~/.thething/wiki/` 当前磁盘文件；
3. revision metadata 与 snapshot；
4. `raw/sources.jsonl` 和 Raw Source snapshot；
5. `system/source-pages.json`；
6. `index.md` 与 `log.md`；
7. Agent 最终文字说明仅作辅助，不作为独立通过证据。

## 3. 当前磁盘状态

### 3.1 普通页面

```text
wiki-维护核心操作.md
wiki-数据架构.md
```

自动维护文件存在：

```text
index.md
log.md
```

没有发现临时文件残留。

### 3.2 Raw Sources

`raw/sources.jsonl` 当前有 2 条来源：

1. URL 来源 `https://example.com/thething-wiki-test-v1`
   - ID：`e0f9bcaf1a242a516e7f`
   - snapshot 存在；
   - snapshot SHA-256 与 registry 中 `contentHash` 完全一致；
   - snapshot 不包含第二次测试追加的“这行不应覆盖旧快照”。
2. conversation 来源 `TheThing Wiki 对话（第 10 条消息起）`
   - ID：`9d3ba6bec088f40e8f0f`
   - 没有 snapshot；
   - 当前没有关联页面。

指定的 Git 来源 `example/thething@commit-test-002` 不存在于 registry。

### 3.3 来源反向索引

`system/source-pages.json` 当前只包含 URL 来源：

```text
e0f9bcaf1a242a516e7f -> wiki-维护核心操作.md
```

不存在 Git 来源关系；conversation 来源也没有当前页面关系。

### 3.4 Revision Store

- `wiki-维护核心操作.md`：7 条 revision，操作序列为：
  `create → update → merge → update → restore → update → update`
- 7 条 revision 的 `parentRevisionId` 链完整。
- restore revision：
  `20260731012156643-5e86baf599ba-7ac613`
  - `operation: restore`
  - `restoredFromRevisionId: 20260731011547552-5e86baf599ba-559a6c`
  - `reason: 验证显式 restore`
- `wiki-数据架构.md`：1 条 create revision，当前文件与该 revision 一致。
- 另有页面 ID `64c63b4e0febd6320ea0` 的 2 条历史，文件名为 `Wiki 维护核心操作.md`，是大小写/空格名称分裂后 merge 删除留下的历史链。

关键异常：`wiki-维护核心操作.md` 当前文件 SHA-256 与最新 revision 的 `contentHash` 不一致。原因是 K 场景中 Agent 使用通用文件编辑工具直接加入交叉引用，绕过了 `save_wiki`，因此没有新 revision、没有 updated 时间更新，也没有 log 记录。

## 4. A～L 逐项判定

| 场景 | 判定 | 关键证据 |
|---|---|---|
| A 首次来源级 Ingest | **通过** | 调用 `ingest_wiki_source`；`sourceCreated: true`、`snapshotCreated: true`；创建页面、首个 revision、index、log 和来源索引。 |
| B 重复来源与不可变快照 | **部分通过** | 底层返回 `sourceCreated: false`、`snapshotCreated: false`，registry 未重复且快照哈希不变；但 `actions: []` 被 Schema 拒绝，Agent 被迫制造 update，页面一度被验证文字覆盖。 |
| C 更新页面并生成 Revision | **部分通过** | 先读取页面并产生后续 revision；但使用 `replace` 而非预期 update，且 target `Wiki 维护核心操作` 生成了另一文件/页面 ID，之后通过 lint + merge 修复。 |
| D 历史与 Diff | **部分通过** | 使用了 `inspect_wiki_history` 的 list/read/diff，未 restore；但首先查询了错误文件名 `Wiki 维护核心操作.md`，看到的是分裂历史，随后才查询规范文件名。目标解析不稳定。 |
| E 第二来源影响同一页面 | **失败** | 用户输入没有完整采用指南中的 Git 来源格式；Agent将内容登记为 conversation 来源，而非 `git: example/thething@commit-test-002`；Git 来源、快照和双来源 frontmatter 均不存在。 |
| F 按来源查询页面 | **失败** | 首次调用 `source_pages` 返回 `pages: []`；第二次重复提问时 Agent直接复述旧结果，没有再次调用工具。由于 E 未完成，空结果符合当前数据但不符合测试预期。 |
| G 显式 Restore | **通过** | 先列历史，再调用 restore；产生新 restore revision，记录目标 revision、恢复原因和 parent；此前历史全部保留。 |
| H Restore 后继续更新 | **通过** | update revision 位于 restore 之后，parent 指向 restore revision；随后生成 diff，历史链未截断。 |
| I Query 可选回写 | **通过** | 先读 index 和相关页面；形成了新的 Git 对比分析并使用 `save_wiki` 回写，未新建同义页面。虽然 action 未显式传 `origin: query`，实现沿用页面 `origin: ingest`，暴露 origin 表达问题，但“可选而非机械写入”的行为成立。 |
| J 主动 Lint | **通过** | `semantic: true`；2 个低风险确定性问题、0 个语义问题、`autoFixed: 0`；未自动 merge、replace、invalidate 或 restore。 |
| K 多 Action/并发 | **部分通过** | 创建 `Wiki 数据架构` 页面并建立双向交叉引用，index/log 无临时文件；但只用一次 create Action，随后直接 `edit_file` 修改主页面，绕过 revision、索引重建和 log，当前主页面与最新 revision 不一致。并发没有被真实压测。 |
| L 重启持久化 | **未执行** | 最后只读列页和历史成功，但没有证据表明 TheThing 在该步骤前真正重启；只能证明同一进程/会话中的持久读取，不能证明重启恢复。 |

## 5. 已验证成立的能力

1. **Raw Source 快照不可覆盖**：重复登记同一来源版本不会覆盖首个 snapshot。
2. **来源 registry 去重**：URL 来源只保留一条注册记录。
3. **Revision 快照不可变且链完整**：主页面 7 条 revision 的父链连续。
4. **显式 restore 非破坏性**：restore 创建新 revision，中间历史仍存在。
5. **restore 后可继续演化**：后续 update 的 parent 指向 restore revision。
6. **diff 可用**：历史版本之间可以生成行级差异。
7. **来源反向索引可查询**：URL 来源可返回当前关联页面。
8. **Lint 非破坏性**：语义检查只报告建议，没有高风险自动修改。
9. **无需 Git 仓库**：整个回归在没有真实 Git 仓库的情况下运行。

## 6. 发现的产品问题

### P0：禁止绕过 Wiki 写入链路破坏 revision 不变量

Agent 能使用 `edit_file`、`write_file`、shell 等通用工具直接修改 `~/.thething/wiki/*.md`。本轮真实发生了直接编辑，导致：

- 当前页面内容与最新 revision 不一致；
- `updated` 未更新；
- `log.md` 未记录；
- 来源关系和 index 可能不同步；
- restore/diff 无法覆盖所有真实页面变化。

这是最高优先级问题。若 Revision Store 要成为产品级审计能力，就必须保证普通页面写入只经过 Wiki mutation API。建议在工具解析或文件操作保护层中禁止通用写工具修改 Wiki 管理目录，而不是依赖 Prompt 提醒。

### P1：`ingest_wiki_source` 应允许零页面 Action

当前 Schema：

```typescript
actions: z.array(wikiActionSchema).min(1).max(5)
```

无法表达以下合法场景：

- 只登记来源和快照；
- 重复摄取后确认没有新理解，因此不改页面；
- 只验证来源是否已存在和 snapshot 是否不可覆盖。

建议改为 `.max(5)` 并允许空数组。返回值仍应明确给出 registry/snapshot 结果，`wiki.saved` 可为 0。这样符合 Karpathy 式“有价值才整合”，避免为了满足工具契约制造伪知识更新。

### P1：统一页面 target 和 filename 规范化

本轮同时形成：

```text
Wiki 维护核心操作.md
wiki-维护核心操作.md
```

两套 page ID 和 revision 目录。虽然最终通过 merge 收口，但历史查询先落到错误链，Agent 还尝试直接删除文件。

建议：

- `save_wiki`、`read_wiki_page`、history/restore 工具共用同一 canonical filename resolver；
- name、filename、无扩展名 target 均先解析现有页面；
- 对仅大小写、空格、连字符差异的候选返回歧义提示，不直接新建；
- create 前检查规范化冲突。

### P1：来源级 Ingest 应更明确保留来源类型

E 场景没有登记成 Git 来源，说明自然语言到 source schema 的映射不稳。工具没有问题地支持 Git，但 Agent对省略标签或简化输入容易自行改成 conversation。

建议在来源级 Ingest 指南中强调：用户提供了明确 type/value/revision 时必须原样映射；缺少关键信息时应询问或只按用户明确内容登记，不应擅自替换来源类型。

### P1：让 Query 回写 origin 可观测

I 场景回写产生了新比较，但 action 未显式携带 `origin: query`，最终页面和 revision 继续显示 `origin: ingest`。这会削弱 provenance。

建议系统提示明确要求：因 Query 形成新分析而回写时，action 显式传 `origin: query`；同时补测试验证 revision metadata。

### P2：只读场景避免 shell 扫描和结果缓存误用

F 第二次提问时 Agent没有重新调用查询工具；L 列页使用 shell 扫描。建议提供正式的 list pages 查询能力，并要求只读验证优先使用 Wiki 工具，避免旧结果复述和工作目录误判。

### P2：Lint 自述应严格服从返回值

J 工具返回 `autoFixed: 0`，但 Agent reasoning 中出现“description was auto-updated”的误判，最终回答又说未修改。应避免根据 suggestion 文案推断已修复状态，只以 `autoFixed` 和工具输出为准。

## 7. 建议实施顺序

1. **先修通用文件工具绕过问题**，恢复 Revision Store 的完整性不变量。
2. **允许 `ingest_wiki_source.actions` 为空**，消除伪更新诱因。
3. **实现统一 canonical page resolver**，阻止名称分裂。
4. **补 Query origin 和来源类型映射约束**。
5. 补定向测试：
   - 零 Action 来源登记与重复登记；
   - 通用文件工具不能改 Wiki 管理目录；
   - 多种 target 写法解析到同一页面；
   - Query 回写 revision 的 `origin: query`；
   - Git 来源影响页面与 restore 后关系回退。
6. 修复后重新清空测试 Wiki，按 A～L 重跑；L 必须在明确重启 TheThing 后执行。

## 8. 最终判定

第三阶段的底层 Revision、restore、diff、Raw Sources 和关系索引能力已经具备可用基础，但当前尚未达到“整体回归通过”。阻止发布级验收的首要问题不是 Git 集成，也不是搜索或 UI，而是：

> **任何 Wiki 页面变化都必须进入统一写入链路，否则 Revision Store 不能被视为完整审计记录。**

因此下一阶段应先完成上述安全和工具契约收口，再进行第二轮真实对话回归。