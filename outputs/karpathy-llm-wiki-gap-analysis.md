# TheThing Wiki 与 Karpathy LLM Wiki 机制差距分析

> 分析日期：2026-07-30
> 分析范围：Karpathy《LLM Wiki》原始构想与 TheThing 当前 Wiki 源码实现
> 核心结论：TheThing 已经具备 Wiki 的文件系统内核，但尚未形成来源、综合、查询、回写和维护相互连接的持续复利闭环。

## 一、对照基线：Karpathy LLM Wiki 的核心思想

Karpathy 描述的不是一套固定知识分类制度，而是一种由 LLM 持续维护个人知识库的模式。

它与传统 RAG 的差别在于：传统 RAG 在每次查询时重新检索原始片段并临时综合；LLM Wiki 则让 Agent 增量构建并维护一个持久化、相互链接的 Wiki，把已经形成的理解保存下来，并随着新来源和新问题持续修订。

核心原则包括：

1. Wiki 是持久化、可复利积累的知识工件。
2. LLM 负责 Wiki 的创建、更新、交叉引用和维护。
3. 人负责选择来源、提出问题和指导分析重点。
4. 页面结构、Schema 和具体工作流由用户与 Agent 在实践中共同演化。
5. 具体实现是可选且模块化的，不要求固定目录、字段、页面类型或搜索技术。

Karpathy 提出的三层架构是：

```text
Raw sources
    ↓
Wiki
    ↓
Query / synthesis
```

三个核心操作是：

- **Ingest**：读取新来源，将信息整合进已有 Wiki。
- **Query**：基于 Wiki 回答问题，并把有价值的新分析回写 Wiki。
- **Lint**：持续检查矛盾、陈旧信息、孤儿页面、缺失引用和知识空白。

## 二、TheThing 当前已经具备的能力

### 2.1 Markdown Wiki 页面

TheThing 已经采用 Markdown 文件保存 Wiki 页面，并使用 frontmatter 记录基本元数据：

```yaml
---
name: ...
description: ...
category: ...
created: ...
updated: ...
---
```

关键实现：

- `packages/core/src/modules/wiki/wiki-io.ts`
- `packages/core/src/modules/wiki/wiki-paths.ts`

已经支持：

- 创建页面；
- 替换或追加更新页面；
- 合并页面；
- 替换页面；
- 标记页面失效；
- 删除页面；
- 使用 `[[页面名称]]` 建立交叉引用。

### 2.2 `index.md` 与 `log.md`

TheThing 已经实现两个特殊文件：

- `index.md`：按分类列出 Wiki 页面及一行摘要；
- `log.md`：按时间记录 ingest 和 lint 等维护活动。

`save_wiki` 执行后会重建索引，并把成功操作追加到日志。这与 Karpathy 提出的索引和日志基本结构一致。

### 2.3 Index-first Query

关键实现：

- `packages/core/src/modules/wiki/wiki-query.ts`
- `packages/core/src/modules/agent/context/wiki-context.ts`
- `packages/core/src/modules/tools/read-wiki-page.ts`
- `packages/core/src/composition/app/create.ts`

当前查询链路是：

1. Agent 创建时加载 Wiki；
2. 将 `index.md` 注入系统上下文；
3. Agent 根据索引判断相关页面；
4. 通过 `read_wiki_page` 按需读取完整页面。

这符合 Karpathy 对中小规模 Wiki 的建议：先读索引，再深入相关页面。

需要注意：`loadWikiContext()` 当前会读取索引中的所有页面，但 `formatWikiContextForPrompt()` 最终只注入索引，页面正文并未直接注入。这不会造成功能错误，但存在不必要的磁盘读取。

### 2.4 Wiki 写入工具

`packages/core/src/modules/tools/save-wiki.ts` 已实现：

- `create`
- `update`
- `merge`
- `replace`
- `invalidate`

并且会：

- 验证交叉引用是否存在；
- 重建索引；
- 追加维护日志；
- 防止修改内部维护的 `index.md` 和 `log.md`；
- 防止 merge 自合并和重复来源。

其中最后三项属于数据完整性保护，应继续保留。

### 2.5 Lint 内核

`packages/core/src/modules/wiki/wiki-lint.ts` 已实现：

- 索引同步检查；
- 陈旧页面检测；
- 孤儿页面检测；
- description 与正文一致性检查；
- 基于 LLM 的矛盾检测；
- 缺失交叉引用检测；
- 知识缺口检测；
- 部分问题自动修复；
- 将 Lint 报告追加到 `log.md`。

因此 TheThing 并不是缺少 Lint 实现，而是尚未把 Lint 接入正常运行闭环。

## 三、相对于 Karpathy LLM Wiki 的主要缺失

## 3.1 缺少独立的 Raw Sources 层

这是最重要的结构性缺口。

当前外部文章、网页、GitHub 仓库、代码文件或对话内容通常由 Agent 直接阅读，然后将总结写入 Wiki。系统没有统一保存：

- 来源原文或不可变快照；
- 来源 URL 或文件路径；
- 来源抓取时间；
- Git 仓库和 commit；
- 来源版本或内容哈希；
- 来源与 Wiki 页面之间的关系；
- 页面中的结论由哪些来源支持。

当前链路更接近：

```text
外部来源 → Agent 总结 → Wiki
```

Karpathy 模式更强调：

```text
不可变来源 → 带来源关联的综合 → Wiki
```

缺少来源层会导致 Wiki 中的结论难以验证、修订和追溯。例如系统无法可靠回答：

- 这条结论来自哪里？
- 它基于哪个代码版本？
- 哪个新来源推翻了旧结论？
- 页面是否已经覆盖某个来源？

## 3.2 缺少真正的来源级 Ingest 编排

`save_wiki` 将写入操作记为 `ingest`，但它本质上仍是页面操作工具，不是完整的来源摄取流程。

Karpathy 式 Ingest 通常包含：

1. 登记原始来源；
2. 阅读并提取关键信息；
3. 生成来源摘要；
4. 查询已有 Wiki；
5. 更新多个相关实体、概念、比较或综合页面；
6. 建立交叉引用；
7. 记录新旧来源之间的冲突；
8. 更新索引和日志。

当前没有统一的 `ingestSource()` 或等价运行入口。以上步骤主要依赖 Agent 根据提示词自行组织。

因此当前属于：

> Prompt 驱动的页面写入，而不是来源级 Ingest 工作流。

未来补充这一能力时，不应把 Ingest 固定为必须生成某几类页面。它应允许 Agent 根据来源和已有 Wiki 决定实际更新范围。

## 3.3 Query 结果没有统一的回写流程

当前 Wiki 提示词已经允许把 Query 中形成的有价值分析、比较和新联系保存回 Wiki，但代码没有建立统一的 Query 回写阶段。

目前可能出现两种路径：

```text
Query → 回答
Query → 回答 → Agent 主动调用 save_wiki
```

缺少的轻量闭环是：

```text
Query
  ↓
基于 Wiki 和来源回答
  ↓
判断是否产生新的综合价值
  ↓
可选创建或更新页面
  ↓
更新 index 和 log
```

这里不应该增加强制验收，也不应该要求每次 Query 都写 Wiki。更合理的方式是提供明确但可选的回写动作，让 Agent 可以解释本次是“不写入”“更新已有页”还是“保存新的综合分析”。

## 3.4 Lint 没有接入周期运行机制

`packages/core/src/modules/wiki/wiki-config.ts` 已定义：

```typescript
lintInterval: 10
```

但当前源码中没有消费该配置，`lintWiki()` 也没有被普通运行链路调用。

实际状态是：

| 能力 | 状态 |
|---|---|
| Lint 实现 | 已有 |
| `lintInterval` 配置 | 已有 |
| Agent 可调用的 Lint 工具 | 未接入 |
| 每 N 次对话触发 | 未接入 |
| 后台维护任务 | 未接入 |

推荐按风险从低到高逐步接入：

1. 先支持用户或 Agent 主动请求 Lint；
2. 再支持每 N 次对话生成健康检查建议；
3. 最后才考虑后台自动修复。

## 3.5 Lint 的语义自动修复偏激进

当前 `lintWiki()` 在模型判断存在 contradiction 且建议包含 `replace` 时，可能直接用另一页面内容替换目标页面。

这种策略存在风险：

- 模型未必正确判断哪个页面更新；
- 两个页面可能描述不同上下文，并非真正矛盾；
- 直接替换会丢失旧结论和演化历史；
- 缺少来源信息时无法判断哪个说法更可信。

更符合 Karpathy 思想的方式是：

```text
Lint 发现问题
    ↓
记录 issue 和涉及页面
    ↓
列出相关来源和修订建议
    ↓
由 Agent 综合后执行 update / merge / invalidate
```

索引同步、明确的元数据格式问题可以自动修复；矛盾、合并、替换和失效等语义操作应默认采用建议式维护。

## 3.6 来源、引用和 Provenance 元数据不足

当前页面 frontmatter 仅包含：

```typescript
name
summary/category
created
updated
```

缺少可选的来源关联信息，例如：

```yaml
sources:
  - type: url
    value: https://example.com/article
    capturedAt: 2026-07-30T12:00:00Z
  - type: git
    repository: owner/repository
    commit: abc123
```

未来可考虑支持但不强制以下信息：

- `sources`
- `aliases`
- `tags`
- `lastVerifiedAt`
- `supersedes`
- `supersededBy`
- `sourceCount`
- `externalIds`

这些字段应保持可选，不应演化成新的固定知识类型或写入门槛。

## 3.7 Schema 演化主要停留在 Prompt 层

当前 Wiki 指南已经声明页面结构、分类和工作流可以逐步演化，但代码仍使用固定的 `WikiPageData`：

```typescript
interface WikiPageData {
  name: string
  description: string
  category: string
  created: string
  updated: string
}
```

`parsePage()` 只解析这些字段，未知 frontmatter 字段不会作为结构化数据保留下来。

因此现状是：

```text
Prompt：允许 Schema 演化
代码：元数据结构基本固定
```

合理改进方向不是设计一个更大的固定 Schema，而是：

- 保留一组最小核心字段；
- 允许额外字段透传；
- 让领域约定通过 Schema 文档或项目 Wiki 逐步形成；
- 避免把未知字段读取后丢失。

## 3.8 缺少版本和修订历史

Karpathy 提到 Wiki 可以直接作为 Git 仓库，从而获得：

- 版本历史；
- diff；
- 回滚；
- 分支；
- 协作。

TheThing 当前的 `log.md` 只记录发生过哪些操作，不能完整表达页面从什么内容变成了什么内容。

当前没有 Wiki 专用的：

- 自动 Git 版本；
- 页面历史；
- 修改前后 diff；
- 回滚入口；
- 修订理由与来源关联。

这不是第一阶段必须实现的能力，但随着 Agent 自主更新增加，版本历史会变得越来越重要。

## 3.9 缺少规模增长后的搜索机制

当前 index-first 模式适合中小规模 Wiki。Karpathy 也明确把全文、BM25、向量或混合搜索列为可选增强，而不是基础要求。

当前没有：

- 全文搜索；
- BM25；
- 向量检索；
- 混合搜索；
- 相关性排序；
- 分页；
- 关键词高亮。

这应在 Wiki 页面数量和索引长度确实出现问题后再实现，优先级低于来源追踪和复利闭环。

## 3.10 缺少人机协作模式配置

Karpathy 描述了多种维护方式：

- 单来源交互式 Ingest；
- 多来源批量 Ingest；
- 人工审阅后写入；
- 团队场景中的人类审核；
- 更自主的后台维护。

TheThing 当前主要依赖 Agent 自行决定是否调用 `save_wiki`，没有明确区分：

```text
interactive ingest
batch ingest
review before write
auto-maintain
```

未来可以把这些作为工作流模式，而不是内容类型或权限等级。

## 四、优先级建议

## P0：先补持续复利闭环

### 4.1 可选来源 Provenance

先支持保存：

- URL；
- 本地文件路径；
- Git 仓库和 commit；
- 来源抓取时间；
- 来源与 Wiki 页面的关系。

不要求所有 Wiki 页面必须填写来源，避免重新引入硬门槛。

### 4.2 轻量来源级 Ingest

增加来源级操作入口，让 Agent 能表达：

```text
这是一个新来源
这是来源摘要
它影响这些已有页面
它与这些旧结论存在冲突
```

系统统一负责保存来源记录、执行页面变更、重建索引和记录日志，但不强制固定页面类型或操作数量。

### 4.3 可选 Query 回写

在 Query 完成后允许三种自然结果：

1. 只回答，不写入；
2. 更新已有页面；
3. 保存新的比较、分析或联系。

回写应由内容价值和当前任务决定，而不是由交付验收器强制。

## P1：接入维护机制

### 4.4 接入主动和周期 Lint

推荐顺序：

1. 暴露主动 Lint 能力；
2. 使用 `lintInterval` 触发健康检查建议；
3. 将高风险语义修复改为建议式；
4. 仅对确定性问题自动修复。

### 4.5 改善冲突和失效处理

在来源机制建立后，冲突页面应记录：

- 冲突陈述；
- 各自来源；
- 来源时间或版本；
- 当前综合判断；
- 为什么 update、merge 或 invalidate。

## P2：规模化增强

### 4.6 可扩展 frontmatter

保留核心字段，允许未知和领域自定义字段透传。

### 4.7 Wiki 历史和回滚

可以使用 Git 或轻量 revision store 保存页面 diff 和修订原因。

### 4.8 搜索能力

当 index-first 方式出现规模瓶颈后，再增加全文、BM25、向量或混合搜索。

### 4.9 Wiki 可视化

可增加：

- 交叉引用图；
- 孤儿页面视图；
- 来源到页面的关系；
- 高连接页面；
- 主题聚类；
- 页面演化时间线。

## 五、不应重新引入的设计

补齐上述机制时，不应恢复此前已经回退的严格治理：

- 不应强制固定 `knowledgeType`；
- 不应禁止步骤、来源摘要或工作理解进入 Wiki；
- 不应要求内容完全稳定后才能保存；
- 不应通过关键词判断内容是否“纯净”；
- 不应把 Wiki 与 Skill 做工具层硬隔离；
- 不应要求 Query 每次必须回写；
- 不应使用工具调用证据判断 Wiki 任务是否完成；
- 不应让 Lint 在缺少来源证据时自动执行破坏性语义替换。

真正需要保留的硬边界应限于真实数据完整性，例如：

- 防止破坏内部维护的索引和日志；
- 防止自合并和重复合并；
- 高风险删除或覆盖可回滚；
- 自动维护失败时不损坏已有页面。

## 六、实施进度（2026-07-30）

本轮已经完成第一阶段闭环能力，但没有重新引入固定知识分类或强制写入。

### 6.1 已实施：可选来源 Provenance

`wikiActionSchema` 新增两个可选字段：

```typescript
origin?: 'ingest' | 'query' | 'maintenance'
sources?: Array<{
  type: 'url' | 'file' | 'git' | 'conversation' | 'other'
  value: string
  revision?: string
  capturedAt?: string
  title?: string
}>
```

实现特征：

- 旧页面不需要迁移，缺少新字段仍可正常读取；
- 来源不是必填项；
- 页面更新时保留已有来源，并按“类型 + 标识 + 版本”去重合并；
- merge 会汇总参与页面的来源；
- replace 保留原页面创建时间和已有来源；
- invalidate 可以记录导致失效的来源；
- 可区分来源摄取、查询回写和维护修订。

关键文件：

- `packages/core/src/modules/wiki/wiki-prompt.ts`
- `packages/core/src/modules/wiki/wiki-io.ts`
- `packages/core/src/modules/tools/save-wiki.ts`

### 6.2 已实施：Query 可选回写语义

`save_wiki` 现在支持：

```typescript
origin: 'query'
```

查询中产生的比较、分析或新联系可以选择性创建或更新 Wiki 页面，并在 `log.md` 中记录为 `query`。没有增加回合结束验收器，也不要求每次 Query 必须写入。

当前实现解决的是“明确的可选回写协议”；是否值得回写仍由 Agent 根据当前任务和新增价值判断。

### 6.3 已实施：主动 Lint 工具

新增：

```text
lint_wiki
```

Agent 可以主动执行 Wiki 健康检查。行为分为：

- 确定性问题：索引同步、陈旧页面、孤儿页面、元数据一致性；
- 语义问题：矛盾、缺失交叉引用、知识缺口。

安全策略：

- 索引同步等确定性问题可以自动修复；
- 语义问题只返回建议；
- 已移除根据模型建议自动替换矛盾页面的逻辑；
- Agent 需要结合来源和上下文，再通过 `save_wiki` 执行 update、merge 或 invalidate。

关键文件：

- `packages/core/src/modules/tools/lint-wiki.ts`
- `packages/core/src/modules/wiki/wiki-lint.ts`
- `packages/core/src/modules/agent/tools.ts`
- `packages/core/src/modules/agent/tool-resolver.ts`

### 6.4 已实施：提示和上下文兼容

Wiki Guidelines 已说明：

- 来源字段是可选的；
- `origin` 可表达 ingest、query、maintenance；
- `lint_wiki` 的语义问题是建议，不是自动修改命令。

同时将 `lint_wiki` 纳入工具解析和上下文压缩的语义工具范围，避免长对话压缩时完全丢失其结果语义。

### 6.5 验证结果

- 5 个定向测试文件全部通过；
- 30 项测试全部通过；
- Core TypeScript 类型检查通过；
- 来源创建、更新合并、Query 日志和确定性 Lint 修复均有测试覆盖。

## 七、第二阶段实施进度（2026-07-30）

### 7.1 已实施：Raw Sources 登记与不可变文本快照

新增 `wiki-sources.ts`，在 Wiki 内维护：

```text
raw/
  sources.jsonl
  snapshots/
    <source-id>.md
```

来源 ID 根据 `type + value + revision` 生成稳定哈希，同一来源版本重复登记时不会重复写入 registry，也不会覆盖已有快照。提供原始文本时，同时记录 SHA-256 内容哈希。

当前 Raw Sources 层支持文本快照；图片和其他二进制资产尚未纳入。

### 7.2 已实施：来源级 Ingest 入口

新增 Agent 工具：

```text
ingest_wiki_source
```

一次调用会：

1. 登记来源；
2. 可选保存不可变文本快照；
3. 将来源自动附加到本次所有 Wiki Action；
4. 以 `origin: ingest` 执行最多 5 个页面变化；
5. 统一更新 index 和 log。

该工具不要求创建固定类型页面，也不要求每个来源必须产生摘要页。Agent 可以根据来源内容和已有 Wiki 决定创建、更新、合并或失效哪些页面。

### 7.3 已实施：非打扰式周期 Lint 提示

新增 `wiki-maintenance.ts`，根据 `log.md` 统计上次 Lint 后的 `ingest`、`query` 和 `maintenance` 变化次数。

达到 `lintInterval` 后，系统提示中会增加维护提醒：当前任务完成后如有必要可运行 `lint_wiki`。该机制：

- 不自动执行 Lint；
- 不在用户任务中启动额外模型调用；
- 不阻塞当前交付；
- 新的 Lint 日志会重置变化计数。

### 7.4 第二阶段验证结果

- 6 个定向测试文件全部通过；
- 20 项测试全部通过；
- Core TypeScript 类型检查通过；
- Raw Sources 快照不可覆盖、来源去重、来源批量传播和 Lint 到期重置均有测试覆盖。

## 八、尚未完成的设计

### 8.1 二进制来源资产

Raw Sources 当前只支持文本快照。图片、PDF、音频和其他二进制资产需要独立的文件类型、大小和安全策略。

### 8.2 任意 Frontmatter 字段透传

当前解析器保留核心字段和已实现的 provenance 字段，尚未支持任意领域字段在读取、更新和重写时无损透传。

### 8.3 来源影响关系索引

页面保存了来源列表，registry 保存了来源记录，但尚未生成独立的反向索引来回答“某个来源影响了哪些页面”。当前需要扫描页面才能得到该关系。

### 8.4 版本历史、搜索和可视化

以下仍属于规模化增强：

- Wiki 页面 diff、revision 和回滚；
- Git 集成；
- 全文、BM25、向量或混合搜索；
- 来源—页面关系图；
- 页面演化时间线；
- 人机协作工作流模式。

## 九、更新后的能力矩阵

| 能力 | 当前状态 |
|---|---|
| Markdown Wiki 页面 | 已实现 |
| 页面 CRUD | 已实现 |
| 页面合并和失效 | 已实现 |
| `index.md` | 已实现 |
| `log.md` | 已实现 |
| Index-first Query | 已实现 |
| 按需读取页面 | 已实现 |
| 可选来源 Provenance | 已实现 |
| 来源在更新/合并中的传播 | 已实现 |
| Query 可选回写协议 | 已实现 |
| Raw Sources 文本快照层 | 已实现 |
| 来源级 Ingest 工具 | 已实现 |
| 主动 Lint | 已实现 |
| 语义问题建议式维护 | 已实现 |
| 周期 Lint 到期提示 | 已实现 |
| 二进制来源资产 | 未实现 |
| 来源反向影响索引 | 未实现 |
| 任意 Schema 字段透传 | 未实现 |
| 版本历史 | 未实现 |
| 大规模搜索 | 暂缺，属于可选增强 |
| 人机协作模式 | 未形成显式工作流 |

当前闭环已经推进为：

```text
来源引用或不可变文本快照
  ↓
来源级 Ingest
  ↓
带 Provenance 的多页面综合
  ↓
Index-first Query
  ↓
有价值回答可选以 query 回写
  ↓
主动 Lint + 到期提醒
  ↓
确定性自动修复 + 语义建议式修订
```

下一阶段应根据真实 Wiki 规模决定是优先实现来源反向索引、版本历史还是搜索能力，而不是继续增加内容分类和强制验收。