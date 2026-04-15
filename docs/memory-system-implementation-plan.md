# 文件级记忆系统 — 架构与实施计划

> 基于 Claude Code 记忆哲学 + AI SDK v6 原生能力的文件级跨对话记忆架构设计

## 目录

- [1. 设计哲学](#1-设计哲学)
- [2. 三层记忆架构](#2-三层记忆架构)
- [3. 模块拆分与文件结构](#3-模块拆分与文件结构)
- [4. 记忆生命周期：写入链路](#4-记忆生命周期写入链路)
- [5. 记忆生命周期：召回链路](#5-记忆生命周期召回链路)
- [6. route.ts 变更方案](#6-routets-变更方案)
- [7. 数据库 Schema 变更](#7-数据库-schema-变更)
- [8. 分阶段实施路线图](#8-分阶段实施路线图)

---

## 1. 设计哲学

### 1.1 Claude Code 记忆核心原则

| 原则           | 说明                                                                      | 源码对应                               |
| -------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| **文件即记忆** | 纯文件存储：无数据库、无向量、只有 `.md` 文件和目录                         | `src/memdir/paths.ts`                  |
| **索引即入口** | `MEMORY.md` 是每次对话的入口，200 行 / 25KB 双上限，纯链接列表             | `src/memdir/memdir.ts`                 |
| **四类型约束** | 封闭分类：user / feedback / project / reference，明确 `<when_to_save>`    | `src/memdir/memoryTypes.ts`            |
| **推导优先**   | **只存储无法从当前项目状态推导的信息**。代码架构、文件路径、git 历史不需要记忆 | `memoryTypes.ts:WHAT_NOT_TO_SAVE`      |
| **智能召回**   | Sonnet 侧查询从 ≤200 条记忆中筛选 ≤5 条相关记忆                            | `src/memdir/findRelevantMemories.ts`   |
| **漂移防御**   | 推荐记忆前先验证文件存在、函数存在（grep）                                | `memoryTypes.ts:TRUSTING_RECALL_SECTION` |

### 1.2 Sime-Agent 与 Claude Code 记忆能力对照

| Claude Code 记忆特性              | Sime-Agent 现状 | 实现路径                                    |
| -------------------------------- | --------------- | ------------------------------------------- |
| `MEMORY.md` 入口索引             | ❌ 缺失         | `memory/memdir.ts`                          |
| 四类型分类法 + Prompt 模板       | ❌ 缺失         | `memory/memory-types.ts`                    |
| 记忆目录扫描 + frontmatter 解析  | ❌ 缺失         | `memory/memory-scan.ts`                     |
| 关键词匹配召回                   | ❌ 缺失         | `memory/find-relevant.ts`                   |
| 记忆老化 / 新鲜度提示            | ❌ 缺失         | `memory/memory-age.ts`                      |
| 记忆漂移防御 Prompt              | ❌ 缺失         | `memory/memory-types.ts` + `system-prompt/` |
| 路径安全校验                     | ❌ 缺失         | `memory/paths.ts`                           |
| AI 自主写入记忆                  | ❌ 缺失         | `memory/paths.ts` + 工具权限控制            |
| 背景提取代理                     | ❌ 缺失         | `memory/extractor.ts`                       |
| SQLite 元数据索引                | ❌ 缺失         | `db.ts` schema 扩展 + `memory/store.ts`     |
| 语义向量召回（可选）             | ❌ 缺失         | Phase 3: `sqlite-vec` 集成                  |
| 团队记忆 / 多租户隔离            | ❌ 缺失         | Phase 2: 路径隔离 + SQLite `owner_type`     |

### 1.3 为什么选择文件存储 + SQLite 元数据

| AI SDK 原生机制                  | 在记忆系统中如何应用                              |
| ------------------------------- | ------------------------------------------------ |
| `prepareStep`                   | 每步前注入相关记忆到 system prompt                |
| `generateText` + `Output.object` | 对话结束后提取记忆（结构化输出）                  |
| `embed` / `embedMany`           | Phase 3: 生成记忆向量用于语义召回                 |
| `rerank`                        | Phase 3: 重排序召回结果                           |
| `wrapLanguageModel` (Middleware) | RAG 中间件注入外部知识（与文件记忆互补）         |
| `tool()` + `execute`            | AI 自主读写记忆文件（`read_file` / `write_file`） |

---

## 2. 三层记忆架构

```
 用户消息
   ↓
┌──────────────────────────────────────────────────────────┐
│  层 0：记忆召回（每次对话开始时）                          │
│                                                          │
│  职责：根据用户消息查询最相关的记忆                        │
│  • scanMemoryFiles()     — 扫描记忆目录 frontmatter       │
│  • findRelevantMemories() — 关键词 / 向量匹配              │
│  • memoryFreshnessNote() — 老化提示                       │
│  • buildMemorySection()  — 组装到 System Prompt           │
│                                                         │
│  输出：memory Section → append 到 system prompt sections  │
└──────────────────────────────────┬────────────────────────┘
   ↓                                ↓
┌──────────────────────────────────────────────────────────┐
│  层 1：文件记忆（核心载体 — 跨对话持久化）                  │
│                                                          │
│  目录结构:                                                │
│  <memoryBase>/                                            │
│  ├── users/<user-id>/memory/                               │
│  │   ├── MEMORY.md          ← 入口索引（200 行 / 25KB）    │
│  │   ├── user_preferences.md                               │
│  │   ├── user_feedback.md                                  │
│  │   └── logs/YYYY/MM/YYYY-MM-DD.md                        │
│  └── teams/<team-id>/memory/                               │
│      ├── MEMORY.md                                         │
│      └── team_project.md                                   │
│                                                          │
│  文件存储格式:                                             │
│  ---                                                       │
│  name: 记忆名称                                             │
│  description: 一行描述                                      │
│  type: user | feedback | project | reference               │
│  ---                                                       │
│  {{记忆内容}}                                               │
└──────────────────────────────────┬───────────────────────┘
   ↓                                ↓
┌──────────────────────────────────────────────────────────┐
│  层 2：SQLite 元数据（结构化管理 + 查询加速）              │
│                                                          │
│  扩展现有 .data/chat.db:                                 │
│  • memories 表    — 记忆元数据索引（快速查询 / 排序）     │
│  • memory_usage 表 — 使用统计（召回历史、频次）            │
│                                                          │
│  功能:                                                   │
│  • 按 owner 查询记忆                                      │
│  • 使用频率排名                                           │
│  • 老化计算（age = now - updated_at）                     │
│  • 文件 ↔ DB 双向同步                                     │
└──────────────────────────────────────────────────────────┘

  对话结束
   ↓
┌──────────────────────────────────────────────────────────┐
│  层 3：记忆提取（后台执行）                                │
│                                                          │
│  职责：从刚完成的对话中提炼新记忆                          │
│  • generateText() + Output.object — 结构化提取             │
│  • writeMemoryFiles()      — 写入 .md 文件               │
│  • updateMemoryIndex()      — 更新 MEMORY.md             │
│  • syncToSQLite()           — 同步元数据到 DB             │
└──────────────────────────────────────────────────────────┘
```

### 2.1 与 Claude Code 架构的对应关系

```
Claude Code                       Sime-Agent
─────────────                       ──────────
getAutoMemPath()              →   memory/paths.ts
  + CLAUDE_CODE_... env           + MEMORY_BASE_DIR env

MEMORY.md 入口加载              →   memory/memdir.ts
  + truncateEntrypointContent()    + truncateEntrypointContent()

scanMemoryFiles()              →   memory/memory-scan.ts
  + frontmatter parsing            + gray-matter 已安装

findRelevantMemories()         →   memory/find-relevant.ts
  + Sonnet side-query              + Phase 1: 关键词匹配
                                    Phase 2: LLM 侧查询
                                    Phase 3: 向量语义

memoryFreshnessNote()          →   memory/memory-age.ts
  + TRUSTING_RECALL_SECTION        + 漂移防御 Prompt

teamMemPaths.ts                →   memory/paths.ts (Phase 2)
  + symlink-safe validation        + owner_type 隔离

background extraction          →   memory/extractor.ts
  + extractMemories()              + generateText() + Output.object
```

---

## 3. 模块拆分与文件结构

```
src/lib/
├── memory/                         ← 记忆系统核心模块
│   ├── index.ts                    # 统一导出
│   ├── paths.ts                    # 路径解析与安全校验
│   ├── memdir.ts                   # MEMORY.md 管理 + Prompt 组装
│   ├── memory-types.ts             # 四类型分类法 + Prompt 模板
│   ├── memory-scan.ts              # 目录扫描 + frontmatter 解析
│   ├── memory-age.ts               # 记忆老化计算
│   ├── find-relevant.ts            # 查询时记忆召回（关键词 / 向量）
│   ├── store.ts                    # SQLite CRUD + 双向同步
│   └── extractor.ts                # 后台记忆提取代理
│
├── system-prompt/                  ← 已有，新增 memory section
│   └── sections/
│       ├── memory.ts               ← 新增：记忆 Section
│       └── ...
│
└── middleware/                     ← 已有，新增 RAG 中间件
    ├── rag.ts                      ← 新增：RAG 知识库搜索（互补）
    └── ...
```

---

## 4. 记忆生命周期：写入链路

### 4.1 手动写入（AI 自主维护）

当对话过程中用户表达偏好、提供反馈或提到项目约束时，AI 被 Prompt 指令自动创建/更新记忆文件：

```typescript
// AI 通过现有 write_file 工具操作：

// 1. 写入记忆文件
write_file({
  filePath: "~/.aura/users/user-abc/memory/user_preferences.md",
  content: `---
name: 用户技术背景
description: 10 年 Go 开发者，偏好 Rust
type: user
---

用户写了 10 年 Go，偏好静态类型语言。
对动态语言不熟悉。技术解释时应使用 Go 类比。`
})

// 2. 更新 MEMORY.md 索引
write_file({
  filePath: "~/.aura/users/user-abc/memory/MEMORY.md",
  content: 原有索引 + "- [用户技术背景](user_preferences.md) — 10 年 Go，偏好 Rust\n"
})
```

### 4.2 自动写入（后台提取）

对话结束后，后台运行记忆提取代理：

```typescript
// src/lib/memory/extractor.ts

export async function extractMemoriesFromConversation(
  messages: ModelMessage[],
  userId: string
): Promise<MemoryExtractionResult> {
  const result = await generateText({
    model: dashscope('qwen-plus'),       // 用便宜模型
    system: MEMORY_EXTRACTION_PROMPT,     // 提取指令（定义在 memory-types.ts）
    messages,
    output: Output.object({
      schema: memoryExtractionSchema      // 结构化输出
    })
  })

  const extraction = result.output

  // 写入文件
  for (const memory of extraction.memories) {
    const filePath = path.join(getUserMemoryDir(userId), `${memory.type}_${memory.name}.md`)
    await fs.writeFile(filePath, formatMemoryFrontmatter(memory) + '\n\n' + memory.content)
    await appendToEntrypoint(getUserMemoryDir(userId), memory)
  }

  // 同步到 SQLite
  await syncMemoriesToDb(userId, extraction.memories)

  return extraction
}
```

### 4.3 四类型写入触发条件（Prompt 指令）

`memory-types.ts` 中定义每种类型的 `<when_to_save>` 和 `<how_to_use>`：

```markdown
## 记忆类型指南

请在以下时机保存记忆：

### user（用户记忆）
- **When to save**: 用户表达了个人偏好、技术背景、角色信息时
- **Examples**:
  - "我是前端开发，不熟悉后端"
  - "我喜欢简洁的代码风格"
  - "我们团队用 TypeScript"

### feedback（反馈记忆）
- **When to save**: 用户纠正了 AI 的行为，或认可了 AI 的做法时
- **注意**：不仅记录"不要这样做"，也记录"对，就是这样"
- **Examples**:
  - "不要 mock 数据库，用真实数据"
  - "单 PR 更好，不要拆分"
  - "这种方式很好，以后都用"

### project（项目记忆）
- **When to save**: 用户提到非代码可推导的项目约束、决策或流程时
- **Examples**:
  - "合并冻结从周四开始"
  - "auth 模块重写是合规要求"
  - "部署需要经过三轮审批"

### reference（参考记忆）
- **When to save**: 用户提到外部工具、服务、流程时
- **Examples**:
  - "CI/CD pipeline bugs 在 Linear INGEST 项目"
  - "测试数据在 staging-db 上"
  - "监控面板在 Grafana prod-dashboard"

### 什么 NOT 要保存
- 代码模式（可以从代码推导）
- 文件结构（可以实时查看）
- Git 历史（可以 git log 查看）
- 已经在 CLAUDE.md 中描述的内容
- 临时性任务信息
```

---

## 5. 记忆生命周期：召回链路

### 5.1 对话启动时的记忆召回

```typescript
// 在 prepareStep 中注入记忆
prepareStep: async ({ stepNumber, messages }) => {
  if (stepNumber > 0) return {}  // 只在第一步召回

  const userId = sessionState.userId
  const lastUserMsg = getLastUserMessageText(messages)

  if (!lastUserMsg) return {}

  // 召回相关记忆
  const relevantMemories = await findRelevantMemories(
    lastUserMsg,
    getUserMemoryDir(userId),
    { maxResults: 5 }
  )

  if (relevantMemories.length === 0) return {}

  // 组装记忆 Section
  const memorySection = await buildMemorySection(relevantMemories, userId)

  // 插入到 system messages 中
  const newMessages = [
    messages[0],  // 保留原 system prompt
    { role: 'system', content: memorySection },
    ...messages.slice(1)
  ]

  return { messages: newMessages }
}
```

### 5.2 记忆召回详细流程

```
用户消息: "我们之前的 CI 流程是什么样的？"
  ↓
findRelevantMemories(query, memoryDir)
  ↓
┌─────────────────────────────────────────┐
│ ① scanMemoryFiles(memoryDir)            │
│   → 读取所有 .md 文件的 frontmatter      │
│   → 返回 [{filename, description, type}] │
│   → 按 mtime 降序排序，上限 200           │
└──────────────┬──────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ ② scoreMemories(query, memories)        │
│   → 关键词匹配 (description, filename)   │
│   → Phase 1: 简单关键词评分              │
│   → Phase 2: LLM 侧查询打分              │
│   → Phase 3: 向量语义搜索                │
└──────────────┬──────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ ③ loadMemoryContents(top 5)             │
│   → 读取选中记忆完整内容                  │
│   → 注入老化提示                          │
│   → 格式化为 System Prompt Section       │
└─────────────────────────────────────────┘
  ↓
  返回: "--- memory: ci_flow.md\ntype: project\n..."
```

### 5.3 findRelevant.ts — Phase 1: 关键词召回

```typescript
// src/lib/memory/find-relevant.ts

export interface FindRelevantOptions {
  maxResults: number
  recentTools?: string[]      // Phase 2: 去噪
  alreadySurfaced?: Set<string> // Phase 2: 去重
}

export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  options: FindRelevantOptions = {}
): Promise<RelevantMemory[]> {
  const { maxResults = 5, recentTools = [], alreadySurfaced = new Set() } = options

  // ① 扫描记忆
  const memories = await scanMemoryFiles(memoryDir)

  // ② 过滤已展示过的
  const candidateMemories = memories.filter(m =>
    !alreadySurfaced.has(m.filename)
  )

  // ③ 关键词评分
  const queryTokens = tokenizeQuery(query)

  const scored = candidateMemories.map(memory => {
    let score = 0

    // description 匹配（权重 2）
    if (memory.description) {
      const descLower = memory.description.toLowerCase()
      for (const token of queryTokens) {
        if (descLower.includes(token)) score += 2
      }
    }

    // 文件名匹配（权重 1）
    const nameLower = memory.filename.toLowerCase()
    for (const token of queryTokens) {
      if (nameLower.includes(token)) score += 1
    }

    // type 匹配（权重 3）— 如果 query 包含类型关键词
    if (query.includes('偏好') && memory.type === 'user') score += 3
    if (query.includes('不要') && memory.type === 'feedback') score += 3
    if (query.includes('流程') && memory.type === 'project') score += 3

    return { memory, score }
  })

  // ④ 排序 + 截断
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => ({
      path: s.memory.filePath,
      mtimeMs: s.memory.mtimeMs,
      score: s.score,
    }))
}
```

### 5.4 memdir.ts — Prompt 组装

```typescript
// src/lib/memory/memdir.ts

export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

// 加载 MEMORY.md 入口索引
export async function loadEntrypoint(memoryDir: string): Promise<string> {
  const entrypointPath = path.join(memoryDir, ENTRYPOINT_NAME)
  try {
    const content = await fs.readFile(entrypointPath, 'utf-8')
    return truncateEntrypointContent(content)
  } catch {
    return '' // 首次对话，无 MEMORY.md
  }
}

// 组装记忆 System Prompt
export async function buildMemoryPrompt(
  memoryDir: string,
  extraGuidelines?: string[]
): Promise<string> {
  const lines: string[] = []

  // ① 记忆类型指南
  lines.push(MEMORY_TYPES_PROMPT)

  // ② 不保存什么
  lines.push(WHAT_NOT_TO_SAVE_SECTION)

  // ③ 何时访问记忆
  lines.push(WHEN_TO_ACCESS_SECTION)

  // ④ 漂移防御
  lines.push(TRUSTING_RECALL_SECTION)

  // ⑤ 额外指南
  if (extraGuidelines) {
    lines.push(...extraGuidelines)
  }

  return lines.join('\n\n')
}

// 构建已召回记忆的 Section
export async function buildMemorySection(
  memories: RelevantMemory[],
  memoryDir: string
): Promise<string> {
  const parts: string[] = []

  for (const memory of memories) {
    const content = await fs.readFile(memory.path, 'utf-8')
    const ageNote = memoryFreshnessNote(memory.mtimeMs)

    parts.push(`--- memory: ${path.basename(memory.path)}`)
    if (ageNote) parts.push(ageNote)
    parts.push(content)
    parts.push(`--- end: ${path.basename(memory.path)}`)
    parts.push('')
  }

  return parts.join('\n')
}
```

### 5.5 与 System Prompt 的集成

```typescript
// src/lib/system-prompt/sections/memory.ts

import { buildMemoryPrompt } from '../../memory/memdir'
import type { SystemPromptSection } from '../types'

export async function buildMemorySectionConfig(
  userId: string,
  teamId?: string
): Promise<SystemPromptSection | null> {
  const userDir = getUserMemoryDir(userId)

  // 检查记忆目录是否存在
  if (!await fs.access(userDir).catch(() => false)) {
    return null
  }

  const content = await buildMemoryPrompt(userDir)
  if (!content) return null

  return {
    id: 'memory',
    priority: 45,  // 在 project-context(60) 之前，skills(50) 之前
    content,
    cacheStrategy: 'session',  // 会话缓存，每次对话更新
  }
}
```

### 5.6 RAG Middleware（互补层）

```typescript
// src/lib/middleware/rag.ts
// RAG 中间件注入外部知识库（与文件记忆互补）

import type { LanguageModelV3Middleware } from '@ai-sdk/provider'
import { embed } from 'ai'

export function ragMiddleware(config: RagConfig): LanguageModelV3Middleware {
  return {
    transformParams: async ({ params }) => {
      const lastUserMessage = getLastUserMessageText(params)
      if (!lastUserMessage) return params

      // 嵌入查询
      const { embedding } = await embed({
        model: dashscope.embedding('text-embedding-v3'),
        value: lastUserMessage,
      })

      // 向量搜索
      const sources = await vectorSearch(embedding, { topK: 5 })
      if (sources.length === 0) return params

      // 注入上下文
      const context = sources.map(s => s.content).join('\n\n')
      return addToLastUserMessage({
        params,
        text: `## 参考资料\n${context}\n\n请基于以上资料回答问题。`,
      })
    },
  }
}
```

---

## 6. route.ts 变更方案

### 当前代码

```typescript
export async function POST(req: Request) {
  // ... 加载会话和消息
  const { agent, sessionState } = await createChatAgent(
    conversationId,
    { messageCount, isNewConversation, conversationStartTime },
    writerRef,
    compactedMessages,
  )
  // ... ToolLoopAgent 流式响应
}
```

### 变更后的代码

```typescript
// src/app/api/chat/route.ts

export async function POST(req: Request) {
  const { message, conversationId } = await req.json()

  // ... (消息加载和压缩逻辑不变)

  // ========== 1. 确定用户身份（从 session / auth 获取）==========
  const userId = getCurrentUserId(req)          // TODO: 从 auth 中间件获取
  const teamId = getCurrentTeamId(req)          // TODO: 可选

  // ========== 2. 初始化记忆目录（不存在则创建）==========
  const userMemDir = getUserMemoryDir(userId)
  await ensureMemoryDirExists(userMemDir)

  if (teamId) {
    const teamMemDir = getTeamMemoryDir(teamId)
    await ensureMemoryDirExists(teamMemDir)
  }

  // ========== 3. 创建 Agent（传入 userId / teamId）==========
  const { agent, sessionState } = await createChatAgent(
    conversationId,
    { messageCount, isNewConversation, conversationStartTime },
    writerRef,
    compactedMessages,
    { userId, teamId },                          // ← 新增参数
  )

  // ========== 4. 流式响应（不变）==========
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // ... (ToolLoopAgent 流式响应，不变)
    },
    onError: (err) => String(err),
  })

  return createUIMessageStreamResponse({ stream })
}

// ========== createChatAgent 变更 ==========

async function createChatAgent(
  conversationId: string,
  meta: ChatMeta,
  writerRef: WriterRef,
  messages: UIMessage[],
  memoryContext?: { userId: string; teamId?: string },   // ← 新增
) {
  const sessionState = createSessionState(conversationId, { ... })

  // ========== A. 召回记忆（对话启动时）==========
  const memorySections: string[] = []

  if (memoryContext?.userId) {
    const relevantMemories = await findRelevantMemories(
      getLastUserMessageText(messages),
      getUserMemoryDir(memoryContext.userId),
      { maxResults: 5 }
    )

    if (relevantMemories.length > 0) {
      const section = await buildMemorySection(relevantMemories)
      memorySections.push(section)
    }

    // 加载用户记忆 Prompt（行为指令）
    const memoryPrompt = await buildMemoryPrompt(getUserMemoryDir(memoryContext.userId))
    if (memoryPrompt) memorySections.push(memoryPrompt)
  }

  if (memoryContext?.teamId) {
    // 团队记忆同理
    const relevantTeamMemories = await findRelevantMemories(
      getLastUserMessageText(messages),
      getTeamMemoryDir(memoryContext.teamId),
      { maxResults: 3 }
    )
    if (relevantTeamMemories.length > 0) {
      memorySections.push(await buildMemorySection(relevantTeamMemories))
    }
  }

  // ========== B. 构建 System Prompt（含记忆 Section）==========
  const { prompt } = await buildSystemPrompt({
    includeProjectContext: true,
    conversationMeta: meta,
    memorySections: memorySections,                     // ← 新增
  })

  // ========== C. 其余逻辑不变 ==========
  const wrappedModel = wrapLanguageModel({
    model: dashscope(sessionState.model),
    middleware: [telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
  })

  // ... tools, prepareStep, stopWhen, ToolLoopAgent (不变)

  return { agent, sessionState }
}

// ========== onFinish 变更：对话结束后触发记忆提取 ==========

onFinish: async ({ messages: completedMessages }) => {
  // ... 保存消息和成本（不变）
  await saveMessages(conversationId, messagesToSave)
  await sessionState.costTracker.persistToDB()

  // ========== D. 后台记忆提取 ==========
  if (memoryContext?.userId) {
    extractMemoriesInBackground(
      completedMessages,
      memoryContext.userId,
      conversationId,
    ).catch(err => console.error('[Memory Extraction] Error:', err))
  }

  // 后台压缩（不变）
  runCompactInBackground(messagesToSave, conversationId)
}
```

---

## 7. 数据库 Schema 变更

### 7.1 扩展现有 .data/chat.db

```sql
-- ============================================================
-- 记忆元数据索引表
-- 与文件系统中的 .md 文件保持双向同步
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
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

-- ============================================================
-- 记忆使用统计表
-- 记录每次召回，用于使用频率排名和老化计算
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_usage (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  conversation_id TEXT,
  recalled_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_memories_owner
  ON memories(owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_memories_type
  ON memories(memory_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_usage_memory
  ON memory_usage(memory_id, recalled_at DESC);
```

### 7.2 记忆 CRUD 操作

```typescript
// src/lib/memory/store.ts

import { getDb } from '../db'
import type { MemoryType } from './memory-types'

// 创建记忆记录
export function createMemoryRecord(params: {
  ownerType: 'user' | 'team' | 'project'
  ownerId: string
  memoryType: MemoryType
  name: string
  description: string | null
  filePath: string
}): string {
  const db = getDb()
  const id = nanoid()

  db.prepare(`
    INSERT INTO memories (id, owner_type, owner_id, memory_type, name, description, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.ownerType, params.ownerId, params.memoryType, params.name, params.description, params.filePath)

  return id
}

// 按 owner 查询记忆
export function getMemoriesByOwner(ownerType: string, ownerId: string): MemoryRecord[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT *, (SELECT COUNT(*) FROM memory_usage WHERE memory_id = memories.id) as usage_count
    FROM memories
    WHERE owner_type = ? AND owner_id = ?
    ORDER BY updated_at DESC
  `).all(ownerType, ownerId) as MemoryRow[]

  return rows.map(mapMemoryRow)
}

// 记录召回
export function recordMemoryRecall(memoryId: string, conversationId?: string): void {
  const db = getDb()
  const id = nanoid()

  db.transaction(() => {
    db.prepare(`
      INSERT INTO memory_usage (id, memory_id, conversation_id)
      VALUES (?, ?, ?)
    `).run(id, memoryId, conversationId || null)

    db.prepare(`
      UPDATE memories
      SET recall_count = recall_count + 1, last_recalled_at = datetime('now')
      WHERE id = ?
    `).run(memoryId)
  })()
}

// 文件 → DB 同步（启动时或定时执行）
export function syncMemoriesFromFiles(memoryDir: string, ownerType: string, ownerId: string): void {
  const memories = await scanMemoryFiles(memoryDir)

  const db = getDb()
  const transaction = db.transaction(() => {
    // 清除该 owner 的旧记录
    db.prepare(`DELETE FROM memories WHERE owner_type = ? AND owner_id = ?`).run(ownerType, ownerId)

    // 重新插入
    for (const memory of memories) {
      createMemoryRecord({
        ownerType,
        ownerId,
        memoryType: memory.type,
        name: memory.filename.replace('.md', ''),
        description: memory.description,
        filePath: memory.filePath,
      })
    }
  })

  transaction()
}
```

---

## 8. 分阶段实施路线图

### Phase 1：文件记忆核心（2-3 天）

```
→ memory/paths.ts                    # 路径解析 + 安全校验
→ memory/memory-types.ts             # 四类型分类法 + Prompt 模板
→ memory/memory-scan.ts              # 目录扫描 + frontmatter 解析
→ memory/memory-age.ts               # 记忆老化计算
→ memory/find-relevant.ts            # 关键词召回
→ memory/memdir.ts                   # MEMORY.md 管理 + Prompt 组装
→ system-prompt/sections/memory.ts   # 新增 Section
→ route.ts 变更                      # 注入 userId + 召回记忆
```

**验证**：新建对话时相关记忆被正确召回并注入 System Prompt。手动创建记忆文件后，下一轮对话能读取到。

### Phase 2：记忆写入 + SQLite 元数据（2-3 天）

```
→ memory/store.ts                    # SQLite CRUD + 双向同步
→ memory/extractor.ts                # 后台记忆提取代理
→ memory/memory-types.ts 变更         # MEMORY_EXTRACTION_PROMPT + schema
→ db.ts 变更                         # 新增 memories + memory_usage 表
→ route.ts 变更                      # onFinish 触发后台提取
→ prompts/ 新增                       # 记忆写入 Prompt 指令
```

**验证**：对话结束后自动提取 1-3 条记忆，写入 `.md` 文件，更新 `MEMORY.md`，同步到 SQLite。

### Phase 3：漂移防御 + 记忆去噪（1 天）

```
→ memory/memdir.ts 变更               # 注入 TRUSTING_RECALL_SECTION
→ memory/find-relevant.ts 变更        # recentTools 去噪 + alreadySurfaced 去重
→ prompts/ 变更                       # 更新记忆行为指南
```

**验证**：记忆推荐中包含老化提示；旧记忆不会重复召回。

### Phase 4：团队记忆 + 多租户隔离（1-2 天）

```
→ memory/paths.ts 变更                # 团队路径 + owner 验证
→ memory/memdir.ts 变更               # 双目录加载 (user + team)
→ route.ts 变更                       # 注入 teamId
→ memory/store.ts 变更                # owner_type/team 支持
```

**验证**：用户看得到自己的记忆 + 团队记忆，团队间记忆隔离正确。

### Phase 5：RAG 中间件 + 向量语义召回（按需）

```
→ middleware/rag.ts                  # RAG 知识库搜索中间件
→ memory/find-relevant.ts 变更       # Phase 3: 向量语义
→ db.ts 变更                         # 可选: sqlite-vec 扩展
```

**验证**：当记忆 > 200 条时自动切换到语义搜索。RAG 中间件与文件记忆互补工作。

### 关键依赖关系

```
Phase 1 ──→ Phase 2 ──→ Phase 3
              ↓            ↓
Phase 4: 团队记忆依赖 Phase 1, 2

Phase 5: RAG/向量独立于 1-4，但共用 memory 查询接口

Phase 1 与现有系统无冲突，可安全并入。
```
