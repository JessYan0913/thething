# 记忆系统设计：文件级跨对话记忆架构

> 基于 Claude Code 项目记忆系统的深度分析，结合企业私有化部署需求设计的分层记忆方案

## 文档信息

- **创建日期**: 2026-04-15
- **状态**: 设计阶段
- **参考来源**: 
  - [Claude Code 项目记忆文档](https://ccb.agent-aura.top/docs/context/project-memory)
  - [Claude Code 源码](https://github.com/claude-code-best/claude-code) `src/memdir/`

---

## 目录

- [1. 现状分析](#1-现状分析)
- [2. Claude Code 记忆系统核心架构](#2-claude-code-记忆系统核心架构)
- [3. 差距对比](#3-差距对比)
- [4. 设计决策](#4-设计决策)
- [5. 推荐架构：分层方案](#5-推荐架构分层方案)
- [6. Phase 1：文件记忆核心](#6-phase-1文件记忆核心)
- [7. Phase 2：SQLite 管理增强](#7-phase-2sqlite-管理增强)
- [8. Phase 3：可选向量索引](#8-phase-3可选向量索引)
- [9. 实施路线图](#9-实施路线图)

---

## 1. 现状分析

### 1.1 当前项目定位

| 维度 | 值 |
|---|---|
| 项目类型 | Next.js 16 Web 应用 |
| 框架 | Vercel AI SDK v6 (`ai` 包) |
| LLM 提供商 | DashScope（通义千问） |
| 持久化 | SQLite (`better-sqlite3`) at `.data/chat.db` |
| 部署模式 | 企业级私有化部署，中心化云服务器/内部服务器 |

### 1.2 当前已有能力

- ✅ 四层上下文压缩管线（micro-compact, session-memory-compact, PTL, API-compact）
- ✅ SQLite 持久化（conversations, messages, summaries, chat_costs）
- ✅ 技能系统（9 个技能，关键词 + 路径条件激活）
- ✅ 子代理系统（7 个内置代理，递归保护）
- ✅ CLAUDE.md 多级加载（用户级 + 项目级）
- ✅ MCP 集成
- ✅ 成本追踪

### 1.3 完全缺失的关键能力

| Claude Code 能力 | 当前项目 |
|---|---|
| `memdir/` 模块（9 个文件，1795 行） | ❌ 不存在 |
| `MEMORY.md` 入口索引机制 | ❌ 不存在 |
| 四类型记忆分类法 | ❌ 不存在 |
| Sonnet 侧查询智能召回 | ❌ 不存在 |
| 记忆老化/新鲜度追踪 | ❌ 不存在 |
| 记忆漂移防御 | ❌ 不存在 |
| KAIROS 模式（每日日志） | ❌ 不存在 |
| 团队记忆系统 | ❌ 不存在 |
| 背景提取代理 | ❌ 不存在 |

---

## 2. Claude Code 记忆系统核心架构

### 2.1 存储架构

```
~/.claude/projects/<sanitized-git-root>/memory/
├── MEMORY.md                    ← 入口索引（每次对话加载）
├── user_role.md                 ← 用户记忆
├── feedback_testing.md          ← 反馈记忆
├── project_mobile_release.md    ← 项目记忆
├── reference_linear_ingest.md   ← 参考记忆
└── logs/                        ← KAIROS 模式：每日日志
    └── 2026/
        └── 04/
            └── 2026-04-01.md
```

路径解析链路（`getAutoMemPath()`）：
1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 环境变量
2. `autoMemoryDirectory` 设置（排除 `projectSettings` 防恶意仓库）
3. 默认：`<memoryBase>/projects/<sanitized-git-root>/memory/`

### 2.2 MEMORY.md 入口索引

```typescript
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
```

双重上限：200 行 AND 25KB。条目格式：
```markdown
- [Title](file.md) — one-line hook
```

### 2.3 四类型分类法

| 类型 | 存储内容 | 典型触发 |
|---|---|---|
| **user** | 用户角色、偏好、技术背景 | "我是数据科学家" |
| **feedback** | 用户对 AI 行为的纠正和确认 | "别 mock 数据库" |
| **project** | 非代码可推导的项目上下文 | "合并冻结从周四开始" |
| **reference** | 外部系统指针 | "pipeline bugs 在 Linear INGEST 项目" |

关键设计约束：**只存储无法从当前项目状态推导的信息**

每条记忆的 Frontmatter 格式：
```markdown
---
name: 记忆名称
description: 一行描述（用于相关性判断）
type: user | feedback | project | reference
---

记忆内容
```

### 2.4 智能召回机制

```
用户消息 → findRelevantMemories(query, memoryDir)
  ├── scanMemoryFiles() — 扫描所有记忆文件的 frontmatter
  ├── selectRelevantMemories() — Sonnet 侧查询，筛选 ≤5 条
  └── 返回 [{path, mtimeMs}, ...]
```

去噪机制：
- `recentTools`：跳过已使用工具的参考文档
- `alreadySurfaced`：过滤之前轮次已展示过的记忆

### 2.5 记忆漂移防御

System Prompt 注入：
```
Before recommending from memory:
- If the memory names a file path: check the file exists.
- If the memory names a function or flag: grep for it.
```

### 2.6 KAIROS 模式

长期运行的 assistant 会话使用不同的记忆策略：
- **标准模式**：AI 维护 `MEMORY.md` 实时索引
- **KAIROS 模式**：只往日期文件追加日志（`logs/YYYY/MM/YYYY-MM-DD.md`）
- 夜间 `/dream` 技能将日志蒸馏为主题文件

### 2.7 团队记忆

双目录（私有 + 团队）：
- 路径：`<autoMemPath>/team/`
- 两遍 symlink 安全校验
- `<scope>` 标签区分私有/团队范围

---

## 3. 差距对比

### 3.1 核心差距

| 优先级 | 差距项 | 影响 |
|---|---|---|
| **P0** | 缺少 `MEMORY.md` 入口索引 | 无法跨对话共享知识 |
| **P0** | 缺少记忆持久化存储 | 对话重启后丢失所有上下文 |
| **P1** | 缺少四类型分类法 | AI 无法规范地存储和调用记忆 |
| **P1** | 缺少智能召回 | 无法按需选择最相关的历史记忆 |
| **P2** | 缺少背景提取代理 | 依赖会话内压缩，无法主动提炼记忆 |
| **P2** | 缺少记忆漂移防御 | 可能基于过时的记忆做出错误建议 |
| **P3** | 缺少 KAIROS/团队记忆 | 长驻会话和多用户场景受限 |

### 3.2 一句话总结差距

当前项目实现了 Claude Code 的**会话级上下文管理**（压缩、技能、子代理），但在**跨对话的持久记忆系统**上几乎完全缺失——没有文件级存储、没有记忆分类、没有智能召回、没有老化追踪。

---

## 4. 设计决策

### 4.1 为什么选择文件存储而非向量数据库

| 维度 | 文件存储 | 向量数据库 |
|---|---|---|
| **零依赖** | ✅ 不需要额外服务 | ❌ 需要部署 DB 服务 |
| **可调试** | ✅ `cat` 即可查看 | ❌ 黑盒，无法直接查看 |
| **AI 自维护** | ✅ AI 可直接读写文件 | ❌ AI 无法操作向量 DB |
| **Prompt Cache** | ✅ 文件路径固定，可命中缓存 | ❌ 向量召回结果不固定 |
| **确定性** | ✅ 索引加载确定 | ⚠️ 语义召回有不确定性 |
| **可扩展性** | ⚠️ 大量文件时检索变慢 | ✅ 语义检索效率高 |
| **安全性** | ✅ 路径校验简单 | ⚠️ 需要额外权限管理 |

**核心结论**：Claude Code 选择文件存储是经过验证的设计，不是技术落后。文件存储的优势在于简单、可靠、AI 可直接操作。

### 4.2 企业私有化部署的特殊需求

Claude Code 是 CLI 工具（单用户、本地），而本项目是企业 Web 应用（多用户、中心化），需要额外考虑：

1. **多租户隔离**：不同用户/团队需要独立记忆空间
2. **团队共享记忆**：团队间共享项目上下文
3. **集中管理**：管理员需要查看/管理记忆

### 4.3 分层架构设计

```
┌─────────────────────────────────────────────────┐
│                 记忆系统架构                       │
├─────────────────────────────────────────────────┤
│  层 1：文件存储（核心记忆载体）                      │
│  仿照 Claude Code 的 <memoryBase>/<scope>/memory/  │
│  ├── MEMORY.md        ← 入口索引                  │
│  ├── <type>_<name>.md ← 独立记忆文件               │
│  └── logs/            ← KAIROS 模式日志            │
├─────────────────────────────────────────────────┤
│  层 2：SQLite（结构化管理 + 查询加速）              │
│  扩展现有 .data/chat.db                           │
│  - memories 表: 记忆元数据索引                     │
│  - memory_usage 表: 使用统计                       │
│  - memory_age 计算: 老化追踪                       │
├─────────────────────────────────────────────────┤
│  层 3：向量索引（可选增强，按需启用）               │
│  触发条件：记忆数量 > N 条时启用                    │
│  推荐方案：sqlite-vec（单文件嵌入，无需额外服务）    │
│  功能：语义召回辅助，与文件索引互补                  │
└─────────────────────────────────────────────────┘
```

---

## 5. 推荐架构：分层方案

### 5.1 目录结构设计

```
<memoryBase>/                        # 可配置，默认 ~/.aura/
├── users/                           # 用户级记忆
│   └── <user-id>/
│       └── memory/
│           ├── MEMORY.md
│           ├── user_preferences.md
│           ├── user_feedback.md
│           └── logs/
│               └── 2026/
│                   └── 04/
│                       └── 2026-04-15.md
│
├── teams/                           # 团队级记忆
│   └── <team-id>/
│       └── memory/
│           ├── MEMORY.md
│           ├── team_project.md
│           └── team_reference.md
│
└── projects/                        # 项目级记忆（可选）
    └── <project-id>/
        └── memory/
            ├── MEMORY.md
            ├── project_architecture.md
            └── project_decisions.md
```

### 5.2 与现有系统整合

现有 `chat.db` 已有表：
- `conversations`
- `messages`
- `summaries`
- `chat_costs`

新增记忆管理表：
```sql
-- 记忆元数据索引
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('user', 'team', 'project')),
  owner_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK(memory_type IN ('user', 'feedback', 'project', 'reference')),
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  recall_count INTEGER DEFAULT 0,
  last_recalled_at TEXT
);

-- 记忆使用统计
CREATE TABLE memory_usage (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  conversation_id TEXT,
  recalled_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_memories_owner ON memories(owner_type, owner_id);
CREATE INDEX idx_memory_usage_memory ON memory_usage(memory_id);
```

### 5.3 路径安全设计

参考 Claude Code 的 `validateMemoryPath()`：

```typescript
// 拒绝相对路径
// 拒绝根目录/近根目录路径
// 拒绝 Windows 驱动器根目录、UNC 路径
// 拒绝 NUL 字节
// 团队记忆：两遍 symlink 安全校验
```

---

## 6. Phase 1：文件记忆核心

### 6.1 核心模块设计

仿照 Claude Code 的 `src/memdir/` 结构：

```
src/lib/memory/
├── paths.ts              # 路径解析与安全校验
├── memdir.ts             # Prompt 组装与目录管理
├── memory-types.ts       # 四类型分类法定义
├── memory-scan.ts        # 目录扫描与 frontmatter 解析
├── memory-age.ts         # 记忆老化计算
├── find-relevant.ts      # 查询时记忆召回
└── index.ts              # 统一导出
```

### 6.2 paths.ts - 路径解析

```typescript
// 记忆基础目录
// 优先级：环境变量 > 配置 > 默认
export function getMemoryBaseDir(): string {
  return process.env.MEMORY_BASE_DIR ??
    path.join(os.homedir(), '.aura')
}

// 用户记忆路径
export function getUserMemoryDir(userId: string): string {
  return path.join(getMemoryBaseDir(), 'users', userId, 'memory')
}

// 团队记忆路径
export function getTeamMemoryDir(teamId: string): string {
  return path.join(getMemoryBaseDir(), 'teams', teamId, 'memory')
}

// 入口索引路径
export function getMemoryEntrypoint(memoryDir: string): string {
  return path.join(memoryDir, 'MEMORY.md')
}
```

### 6.3 memdir.ts - Prompt 组装

```typescript
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

// 组装记忆 System Prompt
export async function loadMemoryPrompt(
  userId: string,
  teamId?: string
): Promise<string> {
  const lines: string[] = []
  
  // 用户记忆
  const userDir = getUserMemoryDir(userId)
  lines.push(...await buildMemoryLines('user memory', userDir))
  
  // 团队记忆（可选）
  if (teamId) {
    const teamDir = getTeamMemoryDir(teamId)
    lines.push(...await buildMemoryLines('team memory', teamDir))
  }
  
  return lines.join('\n')
}
```

### 6.4 memory-types.ts - 四类型分类法

```typescript
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const

export const MEMORY_TYPE_DEFINITIONS = {
  user: {
    scope: '个人',
    description: '用户角色、偏好、技术背景',
    whenToSave: '用户表达了个人偏好或提供了背景信息时',
    howToUse: '调整响应风格、技术深度、示例选择',
    bodyStructure: '包含用户角色、经验年限、偏好技术栈',
  },
  feedback: {
    scope: '个人',
    description: '用户对 AI 行为的纠正和确认',
    whenToSave: '用户说"不要这样做"或"对，就是这样"时',
    howToUse: '避免重复错误，保持用户认可的做法',
    bodyStructure: '包含 Why: 和 How to apply: 行',
  },
  project: {
    scope: '团队/项目',
    description: '非代码可推导的项目上下文',
    whenToSave: '用户提到项目特定的约束、决策或流程时',
    howToUse: '在提出建议时考虑项目上下文',
    bodyStructure: '包含背景 Why: 和应用方式 How to apply:',
  },
  reference: {
    scope: '团队/项目',
    description: '外部系统指针和工具推荐',
    whenToSave: '用户提到外部工具、服务、流程时',
    howToUse: '需要时指引到正确的外部系统',
    bodyStructure: '包含系统名称、访问方式、用途',
  },
}
```

### 6.5 memory-scan.ts - 目录扫描

```typescript
import { parse } from 'gray-matter'

export interface MemoryHeader {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

export async function scanMemoryFiles(memoryDir: string): Promise<MemoryHeader[]> {
  const entries = await fs.readdir(memoryDir, { recursive: true })
  const mdFiles = entries.filter(f => f.endsWith('.md') && basename(f) !== 'MEMORY.md')
  
  const results = await Promise.allSettled(
    mdFiles.map(async (file) => {
      const filePath = path.join(memoryDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const { data } = parse(content)
      const stat = await fs.stat(filePath)
      
      return {
        filename: file,
        filePath,
        mtimeMs: stat.mtimeMs,
        description: data.description ?? null,
        type: data.type as MemoryType | undefined,
      }
    })
  )
  
  return results
    .filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 200)
}
```

### 6.6 find-relevant.ts - 查询时召回

Phase 1 使用关键词匹配（不使用 LLM 侧查询）：

```typescript
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  maxResults: number = 5
): Promise<MemoryHeader[]> {
  const memories = await scanMemoryFiles(memoryDir)
  
  // 关键词匹配
  const queryTokens = query.toLowerCase().split(/\s+/)
  
  const scored = memories.map(memory => {
    let score = 0
    
    // description 匹配
    if (memory.description) {
      const descLower = memory.description.toLowerCase()
      for (const token of queryTokens) {
        if (descLower.includes(token)) score += 2
      }
    }
    
    // 文件名匹配
    const fileLower = memory.filename.toLowerCase()
    for (const token of queryTokens) {
      if (fileLower.includes(token)) score += 1
    }
    
    return { memory, score }
  })
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.memory)
}
```

### 6.7 memory-age.ts - 记忆老化

```typescript
export function memoryAgeDays(mtimeMs: number): number {
  const now = Date.now()
  const diff = now - mtimeMs
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export function memoryFreshnessText(mtimeMs: number): string | undefined {
  const age = memoryAgeDays(mtimeMs)
  if (age > 365) return `⚠️ 记忆已超过1年未更新`
  if (age > 90) return `⚠️ 记忆已超过3个月未更新`
  if (age > 30) return `⚠️ 记忆已超过1个月未更新`
  return undefined
}

export function memoryFreshnessNote(mtimeMs: number): string | undefined {
  const text = memoryFreshnessText(mtimeMs)
  if (text) {
    return `<system-reminder>${text}</system-reminder>`
  }
  return undefined
}
```

### 6.8 与 System Prompt 集成

修改 `src/lib/system-prompt/` 添加内存 section：

```
src/lib/system-prompt/
├── sections/
│   ├── memory.ts           ← 新增：记忆 Prompt 注入
│   └── ...
```

```typescript
// src/lib/system-prompt/sections/memory.ts
import { loadMemoryPrompt } from '../../memory'

export async function buildMemorySection(
  userId: string,
  teamId?: string
): Promise<SystemPromptSection | null> {
  const content = await loadMemoryPrompt(userId, teamId)
  if (!content) return null
  
  return {
    id: 'memory',
    priority: 55, // 在 project-context 和 skills 之间
    content,
    cacheStrategy: 'session', // 会话缓存，每次对话更新
  }
}
```

---

## 7. Phase 2：SQLite 管理增强

### 7.1 扩展现有数据库

在现有 `chat.db` 中添加记忆相关表：

```sql
-- 见 5.2 节 schema
```

### 7.2 记忆管理 CRUD

```typescript
// src/lib/memory/store.ts

export interface MemoryRecord {
  id: string
  ownerType: 'user' | 'team' | 'project'
  ownerId: string
  memoryType: MemoryType
  name: string
  description: string | null
  filePath: string
  createdAt: string
  updatedAt: string
  recallCount: number
  lastRecalledAt: string | null
}

export function createMemory(memory: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'recallCount'>): MemoryRecord
export function getMemory(id: string): MemoryRecord | null
export function getMemoriesByOwner(ownerType: string, ownerId: string): MemoryRecord[]
export function updateMemory(id: string, updates: Partial<MemoryRecord>): void
export function deleteMemory(id: string): void
export function syncWithFiles(memoryDir: string): void  // 扫描文件同步到 DB
```

### 7.3 记忆使用统计

```typescript
export function recordMemoryUsage(
  memoryId: string,
  conversationId: string
): void

export function getMemoryRecallHistory(memoryId: string): Array<{
  recalledAt: string
  conversationId: string | null
}>

export function getActiveMemories(
  ownerType: string,
  ownerId: string,
  days: number = 7
): MemoryRecord[]  // 返回 N 天内使用过的记忆
```

### 7.4 记忆老化追踪

在 System Prompt 注入时计算新鲜度：

```typescript
export async function buildMemoryWithAgePrompt(
  userId: string
): Promise<string> {
  const memories = await loadMemoryFiles(userId)
  
  const lines = memories.map(memory => {
    const age = memoryAgeDays(memory.mtimeMs)
    const freshnessNote = memoryFreshnessNote(memory.mtimeMs)
    
    return [
      `--- memory: ${memory.filename}`,
      `  type: ${memory.type}`,
      `  age: ${age} days ago`,
      freshnessNote,
      memory.content,
      `--- end: ${memory.filename}`,
    ].filter(Boolean).join('\n')
  })
  
  return lines.join('\n\n')
}
```

---

## 8. Phase 3：可选向量索引

### 8.1 为什么选 sqlite-vec

| 方案 | 优缺点 |
|---|---|
| sqlite-vec | ✅ 单文件嵌入，与现有 SQLite 集成，零额外服务 |
| ChromaDB | ❌ 需要额外服务部署 |
| Qdrant | ❌ 需要额外服务部署 |
| Pinecone | ❌ 云服务依赖，不适合私有化部署 |
| Milvus | ❌ 部署复杂，适合大规模场景 |

**结论**：sqlite-vec 是最适合本项目的方案，无需额外服务，与现有 SQLite 自然集成。

### 8.2 触发条件

```typescript
export const VECTOR_SEARCH_THRESHOLD = 200  // 记忆数量阈值
export const VECTOR_SEARCH_DIMENSIONS = 768  // embedding 维度
export const VECTOR_SEARCH_TOP_K = 10  // 召回数量

export function shouldEnableVectorSearch(memoryCount: number): boolean {
  return memoryCount >= VECTOR_SEARCH_THRESHOLD
}
```

### 8.3 sqlite-vec 集成

```typescript
import { vec } from 'sqlite-vec'

// 初始化时注册扩展
export function initializeDatabase(database: Database.Database): void {
  vec.load(database)
  
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors 
    USING vec0(
      embedding float[768],
      memory_id TEXT
    )
  `)
}

// 写入向量
export async function insertMemoryVector(
  db: Database.Database,
  memoryId: string,
  text: string
): Promise<void> {
  const embedding = await generateEmbedding(text)
  
  db.prepare(`
    INSERT INTO memory_vectors (memory_id, embedding)
    VALUES (?, ?)
  `).run(memoryId, embedding)
}

// 语义搜索
export async function semanticMemorySearch(
  db: Database.Database,
  query: string,
  topK: number = 10
): Promise<Array<{ memoryId: string; distance: number }>> {
  const queryEmbedding = await generateEmbedding(query)
  
  const results = db.prepare(`
    SELECT memory_id, distance
    FROM memory_vectors
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(queryEmbedding, topK)
  
  return results as Array<{ memoryId: string; distance: number }>
}
```

### 8.4 向量搜索与关键词搜索融合

```typescript
export async function findRelevantMemoriesWithVector(
  query: string,
  memoryDir: string,
  db: Database.Database,
  maxResults: number = 5
): Promise<MemoryHeader[]> {
  const memoryCount = getMemoryCount(db, memoryDir)
  
  // 记忆数量少时用关键词搜索
  if (!shouldEnableVectorSearch(memoryCount)) {
    return findRelevantMemories(query, memoryDir, maxResults)
  }
  
  // 记忆数量多时融合搜索结果
  const vectorResults = await semanticMemorySearch(db, query, 20)
  const keywordResults = await findRelevantMemories(query, memoryDir, 20)
  
  // 融合排序（向量权重 60%，关键词权重 40%）
  return fuseResults(vectorResults, keywordResults, maxResults)
}
```

---

## 9. 实施路线图

### Phase 1：文件记忆核心（2-4 周）

| 任务 | 预估时间 | 依赖 |
|---|---|---|
| 设计并实现 `src/lib/memory/paths.ts` | 2 天 | - |
| 设计并实现 `src/lib/memory/memory-types.ts` | 1 天 | - |
| 实现 `MEMORY.md` 组装与加载逻辑 | 3 天 | paths.ts, memory-types.ts |
| 实现目录扫描与 frontmatter 解析 | 2 天 | gray-matter 已安装 |
| 实现关键词匹配召回 | 2 天 | memory-scan.ts |
| 实现记忆老化计算 | 1 天 | - |
| 集成到 System Prompt | 2 天 | system-prompt/ |
| 实现记忆写入逻辑 | 3 天 | AI 自主维护能力 |
| **总计** | **~2.5 周** | |

### Phase 2：SQLite 管理增强（1-2 周）

| 任务 | 预估时间 | 依赖 |
|---|---|---|
| 扩展数据库 schema | 1 天 | Phase 1 |
| 实现记忆 CRUD | 2 天 | Phase 1 |
| 实现使用统计与老化追踪 | 2 天 | Phase 1 |
| 同步文件与数据库 | 2 天 | Phase 1 |
| 记忆漂移防御 Prompt | 1 天 | memory-age.ts |
| **总计** | **~1.5 周** | |

### Phase 3：可选向量索引（按需）

| 任务 | 预估时间 | 依赖 |
|---|---|---|
| 集成 sqlite-vec | 3 天 | Phase 2 |
| 实现 embedding 生成 | 2 天 | DashScope embedding API |
| 实现融合搜索 | 2 天 | sqlite-vec, Phase 1 |
| 性能测试与优化 | 2 天 | Phase 2, Phase 3 |
| **总计** | **~1.5 周** | |

### 实施优先级决策树

```
当前记忆数量？
├── < 50 条
│   └── → 只做 Phase 1，无需向量搜索
├── 50-200 条
│   └── → Phase 1 + Phase 2
└── > 200 条
    └── → Phase 1 + Phase 2 + Phase 3
    
是否多租户？
├── 单用户
│   └── → 无需团队记忆，只做用户级
└── 多用户/团队
    └── → 需要团队记忆 + 用户隔离
```

---

## 附录

### A. 与 Claude Code 的架构对比

| 维度 | Claude Code | 本项目设计 |
|---|---|---|
| 存储载体 | 纯文件系统 | 文件 + SQLite + 可选向量 |
| 记忆类型 | 4 种（user/feedback/project/reference） | 相同 + 可扩展 |
| 召回方式 | Sonnet 侧查询 LLM 筛选 | Phase 1: 关键词匹配 → Phase 3: 语义搜索 |
| 老化提示 | memoryFreshnessNote() | 相同 |
| 团队记忆 | ~1000 行安全校验代码 | 复用安全设计，简化实现 |
| AI 自维护 | FileRead/Grep/Glob + FileEdit | 相同 |

### B. 安全性考虑

1. **路径穿越防护**：验证记忆路径不被恶意操纵
2. **多租户隔离**：用户/团队记忆严格物理隔离
3. **权限控制**：AI 只能写入记忆目录内的文件
4. **敏感数据过滤**：不记录 API Key 等敏感信息

### C. 参考文档

- [Claude Code 项目记忆文档](https://ccb.agent-aura.top/docs/context/project-memory)
- [Claude Code 源码](https://github.com/claude-code-best/claude-code)
- `claude-code-temp/src/memdir/` - 完整源码参考
- `claude-code-temp/src/services/compact/sessionMemoryCompact.ts` - 压缩参考
