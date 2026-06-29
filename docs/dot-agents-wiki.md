# Dot Agents 协议合规：Wiki → memories/

## 目标

将 TheThing 现有的 wiki 知识库系统与 Dot Agents 协议的 `memories/<name>.md` 格式对齐，使 `.agents/memories/` 成为 wiki 内容的一个来源。

协议规格：https://dotagentsprotocol.com/

---

## 现状

TheThing 的 wiki 系统：

```
modules/wiki/
├── wiki-paths.ts      # 路径计算
├── wiki-config.ts     # WikiConfig + DEFAULT_WIKI_CONFIG
├── wiki-io.ts         # 文件 I/O（readPage、writePage、rebuildIndex 等）
├── wiki-prompt.ts     # Agent prompt 模板 + Zod schema
├── wiki-query.ts      # 查询 + context 加载
├── wiki-lint.ts       # 静态检查 + LLM 语义检查
└── index.ts
```

### wiki 文件结构

```
~/.thething/wiki/users/{userId}/
├── index.md              # 索引（自动重建）
├── log.md                # 操作日志
├── ai-agent-概念.md       # 页面文件
├── mcp-model-context-protocol.md
└── ...
```

### wiki 页面 frontmatter

```yaml
---
name: ai-agent-概念
description: AI Agent 的核心概念和架构模式
category: domain
created: 2026-06-24T23:55:00.000Z
updated: 2026-06-25T08:57:00.000Z
---
```

### wiki 工具

- `read_wiki_page` — 按名称读取页面（或 index）
- `save_wiki` — create / update / merge / replace 操作

### system prompt 集成

- `wiki-guidelines` section（priority 45）— 告诉 Agent 如何使用 wiki
- `recalled-wiki` section（priority 46）— 注入已召回的内容

---

## 协议要求

协议定义 `memories/<name>.md`：

```markdown
---
id: arch_001
title: Database Architecture
content: PostgreSQL with Drizzle ORM
importance: high
tags: database, architecture, orm
---

We chose PostgreSQL over MongoDB for
relational data integrity and complex
query support across billing.
```

### 协议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `title` | string | 标题 |
| `content` | string | 内容摘要（也可用 body 写完整内容） |
| `importance` | "high" / "medium" / "low" | 重要性评级 |
| `tags` | CSV 或 JSON 数组 | 标签 |

Body：完整内容（Markdown）。

### 协议存储结构

```
.agents/memories/
├── arch_001.md
├── mcp_concepts.md
└── ...
```

- 平面文件结构（无子目录）
- 全局范围（非 per-user）

---

## 差异分析

### 1. 用户隔离

| TheThing wiki | 协议 memories |
|---|---|
| `wiki/users/{userId}/`（per-user） | `memories/<name>.md`（全局） |
| 每个用户有自己的知识库 | 所有用户共享 |

**方案**：memories 作为全局知识层。如果需要用户隔离，可以扩展为 `memories/users/{userId}/<name>.md`（TheThing 扩展）。

### 2. 索引和发现

| TheThing wiki | 协议 memories |
|---|---|
| 自动维护 `index.md`（分 5 类） | 无索引，按文件名遍历 |
| `log.md` 记录变更历史 | 无日志 |
| `[[wiki-link]]` 交叉引用 | 无协议定义 |

**方案**：memories 目录作为一个轻量级来源，不强制索引。如果未来需要全文搜索，可以按需添加。

### 3. Frontmatter 字段映射

| Wiki frontmatter | Memory frontmatter | 说明 |
|---|---|---|
| `name`（文件名级） | `id` | 标识符 |
| `name`（frontmatter 中） | `title` | 人类可读标题 |
| `description` | `content`（摘要） | 简短描述 |
| `category` | `tags`（部分） | 分类 → 标签 |
| `created` / `updated` | — | 协议无时间戳（可扩展） |
| — | `importance` | 协议新增，wiki 无对应 |

### 4. 文件结构

| TheThing wiki | 协议 memories |
|---|---|
| `{baseDir}/users/{userId}/{page-name}.md` | `.agents/memories/{id}.md` |
| 每个 wiki 有 `index.md` + `log.md` | 只有页面文件 |
| 支持子树 | 平面文件 |

---

## 实施步骤

### Phase 1：读取（新增 `modules/memories/`）

**新增文件**：

| 文件 | 内容 |
|---|---|
| `packages/core/src/modules/memories/types.ts` | `MemoryFrontmatterSchema`（Zod）+ `Memory` 接口 |
| `packages/core/src/modules/memories/loader.ts` | `createMultiSourceLoader` 扫描 `.agents/memories/<name>.md` |
| `packages/core/src/modules/memories/index.ts` | 模块入口 + re-exports |

**MemoryFrontmatterSchema**：

```typescript
export const MemoryFrontmatterSchema = z.object({
  id: z.string().optional(),           // 协议 id（无则用文件名）
  title: z.string().optional(),        // 协议 title（无则用 id）
  content: z.string().optional(),      // 协议 content（摘要）
  importance: z.enum(['high', 'medium', 'low']).default('medium'),
  tags: z.array(z.string()).default([]),
  // TheThing 扩展字段
  created: z.string().optional(),
  updated: z.string().optional(),
});
```

**Memory 接口**：

```typescript
interface Memory {
  id: string;
  title: string;
  content: string;
  importance: 'high' | 'medium' | 'low';
  tags: string[];
  body: string;
  sourcePath: string;
  created?: string;
  updated?: string;
}
```

### Phase 2：集成到 wiki 模块

| 文件 | 改动 |
|---|---|
| `modules/wiki/wiki-query.ts` | `loadWikiContext()` 增加从 memories 加载的逻辑：扫描 `.agents/memories/`，合并到返回的上下文中 |
| `modules/wiki/wiki-io.ts` | `readAllPages()` 增加 memories 作为额外来源 |
| `modules/system-prompt/sections/wiki.ts` | `createRecalledWikiSection()` 在召回 wiki 页面后，也追加匹配的 memories |

**集成策略**：memories 不是替换 wiki，而是并行来源。wiki 工具（read_wiki_page、save_wiki）保持对 `wiki/users/{userId}/` 的操作，memories 通过 `loader.ts` 只读加载。

### Phase 3：写入支持（可选）

| 步骤 | 内容 |
|---|---|
| `save_wiki` 工具扩展 | 新增 `save_memory` 动作或增加 `scope: 'wiki' | 'memory'` 参数 |
| 写入路径 | 写入 `.agents/memories/{id}.md`，frontmatter 使用协议字段 |

### Phase 4：system prompt 优化（可选）

| 步骤 | 内容 |
|---|---|
| 合并 wiki + memory context | 在 `recalled-wiki` section 中统一展示 wiki 页面和 memories |
| importance 权重 | 按 `importance` 字段排序，优先级高的排在前面 |
| tag 匹配 | 根据 Agent 当前任务匹配 tags 召回相关 memories |

---

## 数据流图

```
.agents/memories/<name>.md
        │
        ▼
  memories/loader.ts
  (createMultiSourceLoader)
        │
        ▼
  Memory[]
        │
        ▼
  wiki-query.ts: loadWikiContext()
  ┌─────────────────────┐
  │ wiki pages (per-user)│
  │ + memories (global)  │
  └─────────┬───────────┘
            ▼
  system-prompt/sections/wiki.ts
  (recalled-wiki section)
            ▼
       Agent
```

---

## 影响范围

- **新增 ~120 行代码**
- **新增 3 个文件**（types.ts、loader.ts、index.ts）
- **修改 3 个现有文件**（wiki-query.ts、wiki-io.ts、wiki.ts）
- **零破坏性变更**：wiki 系统完全不变，memories 作为额外来源
- 如果实施 Phase 3（写入），`save_wiki` 工具需改动

---

## 与 cron 迁移的区别

| 方面 | Cron → tasks | Wiki → memories |
|---|---|---|
| 调度精度 | 协议简化（intervalMinutes）不兼容 TheThing（cron expr） | 协议字段是 wiki 字段的子集，可无损映射 |
| 存储迁移 | 需要从 SQLite 导出到文件 | wiki 已是文件系统，可双向映射 |
| 写入 | cron tool 需同时写 SQLite + 文件 | 当前只读，写入可选 |
| 用户隔离 | 不涉及 | wiki per-user vs memories global |
| 难度 | 中（需处理兼容方案） | 低（只读集成简单） |
