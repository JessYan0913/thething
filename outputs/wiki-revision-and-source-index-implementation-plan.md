# TheThing Wiki 第三阶段实施方案：来源关系索引与修订历史

> 编写日期：2026-07-31
> 前置阶段：可选 Provenance、Raw Sources 文本快照、来源级 Ingest、Query 可选回写、主动与周期 Lint
> 核心定位：为 Agent 自主维护 Wiki 提供可追溯、可比较、可恢复的基础设施，不增加固定知识分类或内容准入规则。

## 一、背景与目标

前两阶段已经形成以下闭环：

```text
Raw Source → Ingest → 带来源的 Wiki 页面 → Query 可选回写 → Lint 建议式维护
```

当前仍有两个基础缺口：

1. 页面保存了 `sources`，但系统必须扫描所有页面才能回答“某个来源影响了哪些页面”；
2. `log.md` 只能说明发生过操作，不能恢复页面写入前的完整状态，也不能生成可靠 diff。

第三阶段目标是补齐：

- 来源到页面的反向影响索引；
- Wiki 内部 Revision Store；
- 页面修订列表与版本读取；
- 任意两个修订或修订与当前页面之间的 diff；
- 将历史修订恢复为新的当前版本；
- 所有能力均不依赖 Git。

## 二、非目标

本阶段不实施：

- 固定 `knowledgeType` 或新的内容分类制度；
- 强制所有页面必须包含来源；
- 根据来源数量判断内容是否允许写入；
- 二进制 Raw Source 资产；
- 任意 frontmatter 字段透传；
- 全文、BM25 或向量搜索；
- Git 双向同步、分支或 PR 工作流；
- 自动恢复或自动执行语义回滚。

Git 只保留为未来可选 Adapter，用于导出、团队审查或外部协作，不作为 Wiki 正常运行、diff 或 restore 的前置条件。

## 三、设计原则

1. **当前页面仍是事实入口**：Wiki 根目录中的 Markdown 页面保持现有读写方式。
2. **修订不可变**：已保存的 revision 不覆盖、不原地修改。
3. **恢复也是新修订**：restore 不删除后续历史，而是把历史内容重新写成当前页面，并留下新的修订记录。
4. **反向索引可重建**：来源关系索引是派生数据，损坏或丢失时可由页面 frontmatter 重建。
5. **写入失败不破坏当前页**：先准备修订快照，再原子替换页面；派生索引失败时允许重建，但必须暴露错误。
6. **不改变内容自主性**：Revision 与关系索引只记录事实，不评价 Wiki 内容是否“应该存在”。
7. **核心能力不依赖 Git**：本地 revision、diff、restore 在没有仓库的用户目录中也能工作。

## 四、目录布局

建议在 Wiki 目录中增加：

```text
wiki/
  index.md
  log.md
  <page>.md
  raw/
    sources.jsonl
    snapshots/
  system/
    source-pages.json
    revisions/
      <page-id>/
        <revision-id>.json
        <revision-id>.md
```

说明：

- `system/` 是内部维护目录，不作为 Wiki 页面参与索引和查询；
- `source-pages.json` 是可重建的来源反向索引；
- `<page-id>` 由标准化页面文件名生成稳定哈希，避免页面名包含特殊字符；
- `<revision-id>` 建议使用时间前缀加内容哈希短值，兼顾排序和去重；
- `.json` 保存修订元数据，`.md` 保存完整原始页面文本（含 frontmatter）。

## 五、数据结构

### 5.1 来源反向索引

```typescript
interface WikiSourcePageIndex {
  version: 1
  updatedAt: string
  sources: Record<string, {
    sourceId: string
    pages: Array<{
      filename: string
      name: string
      lastLinkedAt: string
    }>
  }>
}
```

- `sourceId` 复用 `createWikiSourceId()` 的 `type + value + revision` 规则；
- 页面没有来源时不产生关系；
- 页面更新、replace、merge、invalidate 或 restore 后，以当前页面 frontmatter 为准更新关系；
- merge 删除来源页面后，重建索引应自动移除旧关系。

### 5.2 修订元数据

```typescript
interface WikiRevisionRecord {
  id: string
  pageId: string
  filename: string
  pageName?: string
  createdAt: string
  operation: 'create' | 'update' | 'replace' | 'merge' | 'invalidate' | 'restore' | 'delete'
  origin?: 'ingest' | 'query' | 'maintenance'
  contentHash: string
  parentRevisionId?: string
  restoredFromRevisionId?: string
  reason?: string
  sources?: WikiSourceData[]
  snapshot: string
}
```

修订保存完整页面原文，而不是只保存 patch。原因：

- 恢复逻辑简单且可靠；
- 不依赖漫长 patch 链；
- Wiki 页面通常是中小型文本，空间成本可控；
- diff 可在读取时动态计算。

## 六、核心模块与 API

### 6.1 `wiki-relations.ts`

```typescript
rebuildSourcePageIndex(wikiDir, config?): Promise<WikiSourcePageIndex>
readSourcePageIndex(wikiDir): Promise<WikiSourcePageIndex>
listPagesForSource(wikiDir, source): Promise<WikiSourcePageRelation[]>
listSourcesForPage(wikiDir, filename): Promise<WikiSourceData[]>
```

第一版优先采用“每批 Wiki Action 完成后重建索引”。Wiki 规模较小时实现简单、结果可靠；只有真实性能数据表明全量扫描成为瓶颈后，才改为增量更新。

### 6.2 `wiki-revisions.ts`

```typescript
capturePageRevision(wikiDir, input): Promise<WikiRevisionRecord | null>
listPageRevisions(wikiDir, filename): Promise<WikiRevisionRecord[]>
readPageRevision(wikiDir, filename, revisionId): Promise<WikiRevisionSnapshot | null>
diffPageRevisions(wikiDir, input): Promise<WikiRevisionDiff>
restorePageRevision(wikiDir, input): Promise<WikiRevisionRecord>
```

`capturePageRevision()` 接受页面写入后的完整原文并生成不可变修订。若内容哈希与页面最新修订相同，可返回现有记录，避免重复版本。

### 6.3 diff 返回结构

```typescript
interface WikiRevisionDiff {
  filename: string
  from: { revisionId?: string; contentHash: string }
  to: { revisionId?: string; contentHash: string }
  changed: boolean
  unifiedDiff: string
}
```

第一版实现行级 unified diff，不引入语义判断。`fromRevisionId` 或 `toRevisionId` 为空时可代表当前页面。

### 6.4 Agent 工具

新增一个只读工具和一个写工具：

```text
inspect_wiki_history
restore_wiki_revision
```

`inspect_wiki_history` 支持：

- 列出页面修订；
- 读取指定修订摘要；
- 比较两个修订；
- 查询来源影响页面。

`restore_wiki_revision`：

- 必须显式指定页面和 revision ID；
- 可选填写恢复原因；
- 恢复后重建 `index.md` 与来源反向索引；
- 在 `log.md` 记录 restore；
- 返回新修订 ID 和被恢复的旧修订 ID。

restore 是显式 Agent 动作，不由 Lint 自动触发。

## 七、写入链路接入

### 7.1 接入位置

当前页面写入集中在：

- `writePage()`
- `updatePage()`
- `mergePages()`
- `replacePage()`
- `invalidatePage()`
- `deletePage()`

为避免在底层 IO 中引入隐式递归，建议增加统一的 `WikiMutationContext` 或在 `save-wiki.ts` 的单条 Action 成功后调用 revision API：

1. 执行页面变化；
2. 读取成功后的完整页面；
3. 保存新 revision；
4. 批量 Action 完成后重建 `index.md`；
5. 重建来源反向索引；
6. 追加 `log.md`。

merge 需要对以下事实留痕：

- 合并后的目标页面生成 `merge` revision；
- 被删除的来源页面在删除前保存 `delete` revision；
- revision metadata 中记录合并参与页面或 reason。

### 7.2 失败语义

- 页面写入失败：不生成成功 revision；
- revision 保存失败：工具应将该 Action 标记失败，并避免声称已完整保存；
- 索引重建失败：页面和 revision 仍保留，返回可恢复错误，后续可调用重建；
- restore 过程中先验证快照哈希与路径，再写当前页；
- 不接受 `index.md`、`log.md` 或 `system/` 内部文件作为 restore 目标。

## 八、原子性与并发

### 8.1 原子写入

当前页面直接 `writeFile()`，第三阶段建议引入同目录临时文件加 rename：

```text
<filename>.tmp-<random> → fsync（可选）→ rename(<filename>)
```

适用于：

- 当前 Wiki 页面；
- `source-pages.json`；
- revision metadata。

不可变 revision 文件继续使用 `flag: 'wx'`，防止覆盖。

### 8.2 并发边界

第一版采用 Wiki 目录级进程内写锁，覆盖：

```text
页面变化 → revision → index → source relations → log
```

这能避免同一进程内多个 Agent 同时覆盖派生索引。跨进程锁暂不实现，但所有派生索引都可重建，revision 文件不可覆盖。

## 九、迁移与兼容

无需强制迁移现有页面。

首次使用第三阶段能力时：

1. 扫描现有页面；
2. 为每个页面创建 `baseline` 修订（操作可映射为 `create`，reason 标记为 `baseline`）；
3. 根据页面 `sources` 重建 `source-pages.json`；
4. 不修改页面 frontmatter 和正文；
5. 不要求页面具有来源。

应提供幂等初始化函数：重复运行不会为相同内容生成重复 baseline revision。

## 十、安全边界

必须保留和新增：

- 禁止将 `index.md`、`log.md`、`raw/`、`system/` 当作普通页面修改或恢复；
- revision ID、文件名必须经过标准化，禁止路径穿越；
- restore 前验证 revision 属于目标页面；
- restore 不删除任何历史版本；
- delete 或 merge 删除页面前必须先留存可恢复快照；
- 语义 Lint 不自动调用 restore；
- 反向索引仅表达关系，不根据关系数量执行删除或拒绝写入。

## 十一、测试计划

### 11.1 Revision Store

- 新页面生成首个 revision；
- update/append/replace/invalidate 分别生成新 revision；
- 相同内容不重复生成 revision；
- revision 文件不可覆盖；
- 列表按时间稳定排序；
- 非法 revision ID 和路径穿越被拒绝；
- merge 删除前保存来源页面快照。

### 11.2 Diff

- 两个 revision 产生可读 unified diff；
- revision 与当前页可比较；
- 相同内容返回 `changed: false`；
- 不存在的 revision 返回明确错误。

### 11.3 Restore

- 恢复后当前页面等于目标 revision 内容；
- restore 产生新的 revision；
- 新 revision 记录 `restoredFromRevisionId`；
- restore 后 index、来源关系和 log 同步；
- 后续 revision 不被删除；
- 内部页面不能恢复。

### 11.4 来源关系索引

- 一个来源关联多个页面；
- 一个页面关联多个来源；
- update 合并来源后索引同步；
- merge 后旧页面关系消失、目标页关系汇总；
- restore 到旧来源集合后关系正确回退；
- 删除 `source-pages.json` 后可重建且结果一致。

### 11.5 回归验证

- 现有 `save_wiki`、`ingest_wiki_source`、`lint_wiki` 测试继续通过；
- Core TypeScript typecheck 通过；
- `git diff --check` 通过；
- 旧 Wiki 页面无需迁移即可读取和更新。

## 十二、验收标准

满足以下条件视为第三阶段完成：

1. 不依赖 Git 即可列出页面历史、查看 diff、恢复旧版本；
2. 所有 Agent 正常页面变更都会生成不可变 revision；
3. restore 会生成新版本，不破坏历史；
4. 可以由 source ID 或来源描述查询受影响页面；
5. 来源反向索引可从页面完整重建；
6. merge、replace、invalidate 和 restore 的来源关系正确；
7. 内部文件和路径穿越受到保护；
8. 未引入固定知识分类、内容纯度拒绝或强制 Query 回写；
9. 定向测试、既有 Wiki 回归测试和 Core typecheck 全部通过。

## 十三、实施顺序

1. 实现原子写入与 Wiki 目录级写锁基础设施；
2. 实现 `wiki-revisions.ts` 及单元测试；
3. 在 `save_wiki` 写入成功边界接入 revision；
4. 实现 `wiki-relations.ts` 与可重建反向索引；
5. 接入 ingest、merge、invalidate 和 restore 后的关系同步；
6. 实现 history/diff 只读工具；
7. 实现显式 restore 工具；
8. 接入工具注册、白名单和上下文压缩分类；
9. 跑完整定向测试、typecheck 和差异检查；
10. 更新 Karpathy 差距文档中的能力矩阵与实施进度。

## 十四、实施完成情况（2026-07-31）

第三阶段及安全收口已经完成：

- 普通 Wiki 页面和 `index.md` 改为同目录临时文件加 rename 的原子写入；
- `save_wiki` 与 restore 使用 Wiki 目录级进程内写锁，防止同一进程并发覆盖页面、索引和日志；
- 已有页面首次进入写入链路时会获得幂等 baseline revision；
- merge 删除来源页面前会保存 `delete` revision，删除后的页面仍可通过历史快照读取；
- create、update、replace、merge、invalidate 和 restore 均有 revision 覆盖；
- restore 后会按历史来源集合重建来源反向索引；
- 补充并发保存、baseline、merge 删除历史和 Action revision 测试。

验证结果：

- 第三阶段加固定向测试通过；
- Core TypeScript 类型检查通过；
- Core 完整测试为 80 个测试文件、757 项测试通过，剩余 2 项既有环境/对话路线失败：真实 DB 抽样为空；主分支 projection 名称实际为 `null`，旧测试仍期待“主分支”。二者与 Wiki 修改无关。

当前原子性边界为单进程串行和单文件原子替换，不提供跨进程事务。Revision 文件不可变、来源索引可重建，因此跨进程异常不会成为静默不可恢复的数据覆盖机制；如未来出现多进程写入需求，再增加文件锁或数据库事务协调。

## 十五、未来 Git Adapter

内部 Revision Store 完成后，Git 可作为独立可选层：

```text
TheThing Wiki Core
  ├─ Revision Store / diff / restore（默认能力）
  └─ Git Adapter（可选）
       ├─ 单向导出
       ├─ 自动 commit
       ├─ 团队 PR 审查
       └─ 外部仓库同步
```

第一版 Git Adapter 应优先单向导出，不做双向自动合并。这样既能保持个人本地 Wiki 的零依赖体验，也为团队协作保留标准工具链入口。
