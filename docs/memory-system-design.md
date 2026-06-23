# 记忆系统 v2：基于 LLM Wiki 的完全重建

> 参考：[Karpathy LLM Wiki](./llm-wiki.md)
> 日期：2026-06-23
> 状态：设计阶段

---

## 一、设计原则

> "The wiki is a persistent, compounding artifact."
> Cross-references are already present. Contradictions have been flagged.
> The synthesis reflects everything you've read.
> The wiki grows richer with each source added and each question asked.
> — Karpathy

**核心原则：LLM 做维护，代码只做 IO。知识是累积的（compounding）。**

现有系统的 17 个文件中，大部分复杂性（tiered storage、promotion/dormancy lifecycle、usage tracking、token-based search）是在用代码逻辑解决应该由 LLM prompt 解决的问题。LLM Wiki 证明了：一个写得好的 prompt + 简单的文件 IO，比复杂的代码逻辑更有效。

**新系统的设计约束：**
1. 代码层只做文件读写，不做语义判断
2. 所有「智能」逻辑（编译、矛盾检测、合并）由 LLM prompt 驱动
3. 存储格式极简：扁平目录 + markdown + frontmatter
4. 检索极简：先读索引，再读页面
5. 一个操作日志记录所有变更
6. **知识是累积的**：每次 ingest 和 query 都让 wiki 更丰富

---

## 二、架构：三层 + 三个操作

### 三层

```
┌─────────────────────────────────────────────┐
│  Schema（维护规则）                           │
│  WIKI_MAINTAINER_PROMPT                      │
│  告诉 LLM 如何编译、更新、维护知识库            │
├─────────────────────────────────────────────┤
│  The Wiki（编译后的知识）                      │
│  wiki/                                       │
│  ├── index.md        （索引）                  │
│  ├── log.md          （操作日志）               │
│  ├── aura-出生日期.md                          │
│  ├── 用户-真名.md                             │
│  ├── 编程-偏好.md                             │
│  ├── 沟通-风格.md                             │
│  ├── 当前-项目.md                             │
│  └── ...                                     │
├─────────────────────────────────────────────┤
│  Raw Sources（原始资料，不可变）                 │
│  对话历史（messages）                           │
│  LLM 只读不写                                  │
└─────────────────────────────────────────────┘
```

**关键：wiki 是扁平目录。** 不用子目录分类——Karpathy 原文说 "a directory of LLM-generated markdown files"，分类通过 frontmatter 的 `category` 字段实现，不通过目录结构。这保持了极简，也方便 Obsidian 等工具直接打开。

### 三个操作

| 操作 | 触发时机 | LLM 做什么 | 代码做什么 |
|------|---------|-----------|-----------|
| **Ingest** | 对话结束 | 从对话中编译知识，创建/更新**多个**页面，维护索引 | 写文件 |
| **Query** | 用户提问 | 读索引定位页面，读页面获取知识，**将好的回答回写为新页面** | 读文件，注入系统提示词 |
| **Lint** | 定期（每 N 次对话） | 检查矛盾、孤儿、过时、缺失交叉引用 | 读文件，调 LLM |

---

## 三、存储设计

### 3.1 目录结构（扁平）

```
~/.thething/memory/users/<userId>/wiki/
├── index.md                 # 索引：所有页面的目录
├── log.md                   # 日志：所有操作的时间线
├── aura-出生日期.md          # identity 类
├── 用户-真名.md              # identity 类
├── 编程-偏好.md              # pattern 类
├── 沟通-风格.md              # pattern 类
├── 当前-项目.md              # state 类
└── ...                      # 更多页面
```

**文件命名**：kebab-case，简洁描述性。不加 type 前缀——category 在 frontmatter 中。

### 3.2 记忆文件格式（The Wiki Page）

```markdown
---
name: Aura 出生日期
description: Aura 的出生日期是 2026年6月23日
category: identity
created: 2026-06-23T10:00:00Z
updated: 2026-06-23T10:00:00Z
source: explicit
instruction: 用户要求根据最早聊天时间设定 AI 出生日期
aliases: [出生, 生日, 几岁, 年龄]
triggers: [你几岁, 出生日期, 什么时候出生, 多大了]
---

Aura 的出生日期是 2026年6月23日（首次聊天日期）。

参见 [[用户-真名]]、[[沟通-风格]]。
```

**字段说明：**

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| name | ✅ | string | 页面名称（简短描述性，≤20 字） |
| description | ✅ | string | 一行摘要（≤50 字，用于索引） |
| category | ✅ | enum | `identity` / `pattern` / `state` |
| created | ✅ | ISO string | 创建时间 |
| updated | ✅ | ISO string | 最后更新时间 |
| source | ✅ | enum | `explicit`（用户直说）/ `inferred`（推断） |
| instruction | ❌ | string | 用户的原始指令（间接指令场景） |
| aliases | ❌ | string[] | 主体别名（用于召回匹配） |
| triggers | ❌ | string[] | 用户将来可能的提问（用于召回） |

**去掉的字段（vs 旧系统）：**
- ~~type~~（user/feedback/project/reference）→ 简化为 category
- ~~stability~~ → 由 category 隐含
- ~~confidence~~ → 不需要，LLM 直接判断
- ~~promoted~~ source → 不需要晋升机制
- ~~validUntil~~ / ~~supersededBy~~ → 不需要，过时直接删除或更新
- ~~subject~~ / ~~context~~ → 合并为 aliases 和 triggers

### 3.3 交叉引用（Cross-references）

来自 LLM Wiki：

> "Cross-references are already present."
> "missing cross-references" 是 Lint 检查项之一。

页面之间通过 wiki 风格的 `[[链接]]` 互相引用：

```markdown
---
name: 编程偏好
description: 用户偏好 TypeScript 和简洁代码风格
category: pattern
...

用户偏好 TypeScript 和简洁代码风格。偏好函数式编程范式。

参见 [[当前-项目]]（项目使用的技术栈）。
```

**交叉引用的作用：**
1. **Ingest 时**：LLM 更新一个页面时，检查是否需要更新相关页面的交叉引用
2. **Query 时**：读取一个页面后，可以顺着链接读取关联页面（可选）
3. **Lint 时**：检查是否有页面缺少应有的交叉引用

### 3.4 索引格式（index.md）

```markdown
# index.md

> 此文件是知识库的入口。查询时先读此文件，再读相关页面。

## identity

- [[aura-出生日期]] — Aura 的出生日期是 2026-06-23
  触发器: 你几岁, 出生日期, 什么时候出生
- [[用户-真名]] — 用户真名是严恒
  触发器: 我叫什么, 怎么称呼, 真名

## pattern

- [[编程-偏好]] — 用户偏好 TypeScript 和简洁代码
  触发器: 代码风格, 用什么语言, 编程习惯

## state

- [[当前-项目]] — 用户正在开发 TheThing
  触发器: 在做什么项目, 最近在忙什么
```

**格式说明：**
- 使用 `[[wiki-link]]` 格式（兼容 Obsidian）
- 每个条目：链接 + 一行摘要 + 触发器
- 按 category 分组
- LLM 在每次 ingest 后更新此文件

### 3.5 日志格式（log.md）

来自 LLM Wiki：

> "if each entry starts with a consistent prefix (e.g. `## [2026-04-02] ingest | Article Title`), the log becomes parseable with unix tools"

```markdown
# log.md

## [2026-06-23T10:00:00Z] ingest | 对话 #1
- create: [[aura-出生日期]] — Aura 出生日期
- update: [[编程-偏好]] — 追加 TypeScript 偏好
- cross-ref: 更新 [[当前-项目]] 引用 [[编程-偏好]]

## [2026-06-23T10:05:00Z] lint
- checked: 5 pages, 0 contradictions, 1 orphan flagged

## [2026-06-23T10:10:00Z] query | "你几岁了"
- recalled: [[aura-出生日期]]
- writeback: 无

## [2026-06-23T10:15:00Z] query | "Vue 和 React 哪个适合我"
- recalled: [[编程-偏好]], [[当前-项目]]
- writeback: [[vue-vs-react-对比]] — 新页面
```

**格式说明：**
- `## [ISO时间] operation | description` — 可被 `grep "^## \[" log.md` 解析
- 每次操作列出具体变更
- Query 操作记录召回和回写

---

## 四、Ingest：知识编译

### 4.1 核心理念

来自 LLM Wiki：

> "the LLM reads the source, extracts key information, and **integrates it into the existing wiki** — updating entity pages, revising topic summaries, **noting contradictions with older data, strengthening or challenging the evolving synthesis**."
>
> "A single source might touch **10–15 wiki pages**."

**一次 ingest 不只是创建新页面——更重要的是更新已有页面。** 新信息进来时，LLM 需要：
1. 检查哪些已有页面需要更新
2. 将新事实追加到已有页面中（增强）
3. 检测矛盾并解决
4. 更新交叉引用
5. 更新索引
6. 写入日志

### 4.2 WIKI_MAINTAINER_PROMPT（完整 Prompt）

````
你是一个知识库维护者。你的任务是从对话中提取信息，编译为 AI 未来可用的知识，并维护知识库的一致性。

---

## 核心原则

1. **编译知识，不转述原文**
   content 存储的是 AI 未来需要知道的信息，不是用户说了什么。

2. **增强优先于创建**
   新信息进来时，先检查是否与已有知识相关。相关则增强已有页面，不相关才创建新页面。
   一次对话可能影响多个已有页面。

3. **保持一致性**
   新知识不能与已有知识矛盾。如果矛盾，用更新的信息覆盖旧信息。

4. **维护交叉引用**
   新增或更新页面时，检查是否需要在其他页面中添加/更新 [[wiki-link]]。

---

## 先判断：值得编译吗？

以下情况直接返回 {"actions": []}，不要勉强提取：
- 纯技术问答，没有关于用户/AI的事实
- 信息可以从代码或文件实时获取
- 一次性任务，完成后不再有价值
- 用户只是表达了即时情绪，不是稳定偏好

值得编译的信号：
- 用户说出了关于自己的事实（我是谁、我喜欢什么、我的习惯）
- 用户明确纠正或认可了 AI 的某种做法，且应长期保持
- 用户提到了需要跨会话记住的约束或决策
- 用户给了间接指令，需要 AI 推导结论
- 对话中产生了有价值的综合分析

---

## Content 编译规则

| 用户说的 | Content 应该写 | 示例 |
|---------|--------------|------|
| 直接事实「我喜欢X」 | "用户喜欢X" | 「我喜欢火影忍者」→ "用户喜欢火影忍者" |
| 间接指令「根据X推导Y」 | 推导后的结论 | 「根据最早聊天时间作为出生日期」→ "Aura 的出生日期是 2026-06-23" |
| 行为纠正「不要做X」 | "禁止X" 或 "必须Y" | 「不要 mock 数据库」→ "禁止 mock 数据库，必须使用真实数据" |
| 偏好比较「A比B好」 | "在Y场景下，用户偏好A胜过B" | 「凡人修仙传比火影好看」→ "在动漫类中，用户偏好凡人修仙传胜过火影忍者" |
| 规则设定「以后都用X」 | "所有Y必须使用X" | 「以后写代码都用 TypeScript」→ "所有代码必须使用 TypeScript" |
| 身份设定「你是X」 | "AI 的 X 是 Y" | 「你的出生日期是今天」→ "Aura 的出生日期是 2026-06-23" |

---

## 操作类型

- **create**: 无相关已有知识，创建新页面
- **update**: 新知识与已有页面相关，追加新事实到已有内容中（不替换旧事实）
- **merge**: 多条碎片描述同一主题，合并为一条丰富的知识，删除旧碎片
- **replace**: 新知识完全替代旧知识（如目的地从 A 改为 B）
- **invalidate**: 旧知识已被推翻，标记为过期

### 更新规则（重要）

1. **只追加新事实**：将新事实追加到已有内容中，不要替换
2. **保留所有已知事实**：更新后的 content 必须包含旧知识中的所有事实 + 新事实
3. **禁止推断性语言**：content 中不得使用"可能"、"暗示"、"表明"、"推测"

示例：
- 旧知识：用户喜欢凡人修仙传和灵笼
- 新对话：凡人修仙传和火影忍者哪个对我更重要
- 正确 update：用户喜欢凡人修仙传和灵笼。用户表示凡人修仙传比火影忍者对他更重要。
- 错误 update：用户可能最喜欢凡人修仙传（❌ 推断 + 丢失灵笼信息）

---

## 矛盾检测

如果新知识与已有知识矛盾：
- 使用 replace 操作更新旧页面
- 在日志中记录矛盾和解决方案

示例：
- 旧知识：用户喜欢住在北京市朝阳区
- 新对话：我搬到上海了
- 操作：replace → "用户当前居住在上海市"

---

## 交叉引用维护

新增或更新页面时，检查：
1. 新页面是否应该引用已有页面？→ 添加 [[wiki-link]]
2. 已有页面是否应该引用新页面？→ 更新已有页面的交叉引用
3. 更新已有页面时，相关页面的交叉引用是否需要更新？

示例：
- 创建 [[编程-偏好]]（TypeScript）→ 检查 [[当前-项目]] 是否需要引用
- 更新 [[当前-项目]]（换了技术栈）→ 检查 [[编程-偏好]] 是否需要更新引用

---

## 输出格式

输出 JSON，包含 actions 数组。每个 action 包含：

```json
{
  "actions": [
    {
      "action": "create",
      "category": "identity",
      "name": "Aura 出生日期",
      "description": "Aura 的出生日期是 2026年6月23日",
      "content": "Aura 的出生日期是 2026年6月23日（首次聊天日期）。\n\n参见 [[用户-真名]]。",
      "instruction": "用户要求根据最早聊天时间设定 AI 出生日期",
      "aliases": ["出生", "生日", "几岁"],
      "triggers": ["你几岁", "出生日期", "什么时候出生"]
    }
  ]
}
```

字段说明：
- action: create / update / merge / replace / invalidate
- category: identity / pattern / state
- name: 页面名称（≤20 字）
- description: 一行摘要（≤50 字）
- content: 编译后的知识（正文，直接用于 AI 上下文，可包含 [[wiki-link]]）
- instruction: 用户原始指令（仅间接指令场景，可选）
- aliases: 主体别名（可选）
- triggers: 召回触发器（可选，写用户将来真实会问的句子）
- target: 目标文件名（update/merge/replace/invalidate 时必填）
- mergeTargets: 合并目标文件名列表（merge 时必填）

没有值得编译的内容时：{"actions": []}
````

### 4.3 Zod 输出 Schema

```ts
const wikiActionSchema = z.object({
  action: z.enum(["create", "update", "merge", "replace", "invalidate"])
    .describe("操作类型"),
  category: z.enum(["identity", "pattern", "state"])
    .describe("知识分类: identity=极少变化, pattern=跨场景规律, state=当前状态"),
  name: z.string().max(20)
    .describe("页面名称（简短描述性）"),
  description: z.string().max(50)
    .describe("一行摘要（用于索引）"),
  content: z.string()
    .describe("编译后的知识（AI 未来需要知道的信息，可包含 [[wiki-link]]）"),
  instruction: z.string().optional()
    .describe("用户原始指令（仅间接指令场景）"),
  aliases: z.array(z.string()).optional()
    .describe("主体别名（用于召回匹配）"),
  triggers: z.array(z.string()).min(1).max(5).optional()
    .describe("用户将来真实会问的句子（用于召回）"),
  target: z.string().optional()
    .describe("目标文件名（update/merge/replace/invalidate 时必填）"),
  mergeTargets: z.array(z.string()).optional()
    .describe("合并目标文件名列表（merge 时必填）"),
})

const wikiIngestSchema = z.object({
  actions: z.array(wikiActionSchema).max(5)
    .describe("要执行的操作列表，最多 5 条"),
})
```

### 4.4 Ingest 流程

```
对话结束
    │
    ▼
读取最近 20 条消息
    │
    ▼
读取 index.md 索引（了解已有知识）
    │
    ▼
读取索引中相关页面的完整 content（冲突检测 + 交叉引用用）
    │
    ▼
调用 LLM：
    system = WIKI_MAINTAINER_PROMPT
    prompt = "## 现有知识库索引\n{index}\n\n## 相关已有知识\n{related_pages}\n\n## 当前对话\n{conversation}"
    output = wikiIngestSchema
    │
    ▼
LLM 返回 { actions: [...] }
    │
    ▼
代码执行每个 action：
    │
    ├─ create:
    │   写入 {name}.md（含 frontmatter + content）
    │
    ├─ update:
    │   读取 target 文件
    │   将新 content 追加到旧 content（保留所有旧事实）
    │   更新 updated 时间
    │   写回文件
    │
    ├─ merge:
    │   读取 mergeTargets 中的所有文件
    │   合并 content 为一条
    │   写入新文件
    │   删除所有旧文件
    │
    ├─ replace:
    │   写入新 content 覆盖 target 文件
    │   更新 updated 时间
    │
    ├─ invalidate:
    │   读取 target 文件
    │   在 frontmatter 中添加 status: invalidated
    │   在 content 末尾追加过期原因
    │
    ▼
重建 index.md 索引
    │
    ▼
追加 log.md 日志
```

### 4.5 代码实现

```ts
// wiki-ingest.ts

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { UIMessage } from 'ai';

export interface WikiIngestResult {
  actions: number;
  created: string[];
  updated: string[];
  merged: string[];
  replaced: string[];
  invalidated: string[];
}

/**
 * 从对话中编译知识并写入 wiki
 * 这是 Ingest 操作的核心函数
 */
export async function ingestWikiFromConversation(
  messages: UIMessage[],
  userId: string,
  model: LanguageModelV3,
  wikiBaseDir?: string,
): Promise<WikiIngestResult>

/**
 * 执行单个 wiki action
 */
export async function executeWikiAction(
  wikiDir: string,
  action: WikiAction,
): Promise<void>

/**
 * 格式化对话为 prompt 文本
 */
function formatConversationForPrompt(messages: UIMessage[]): string

/**
 * 格式化索引和相关页面为 prompt 上下文
 */
function formatWikiContext(
  indexContent: string,
  relatedPages: Array<{ name: string; content: string }>,
): string
```

---

## 五、Query：Index-First 检索 + 结果回写

### 5.1 核心理念

来自 LLM Wiki：

> "When answering a query, the LLM reads the index first to find relevant pages, then drills in."
>
> **"Good answers can be filed back into the wiki as new pages."** A comparison you asked for, an analysis, a discovered connection — these are valuable and shouldn't vanish into chat history. **This way explorations compound in the knowledge base just like ingested sources.**

Query 不只是检索——好的回答应该回写为新页面，让知识库持续累积。

### 5.2 检索流程

```
用户提问
    │
    ▼
读取 index.md 索引
    │
    ▼
在索引中匹配（name + description + triggers）
    │
    ├─ 命中 → 读取对应页面的完整 content
    └─ 未命中 → 返回空
    │
    ▼
格式化为系统提示词，注入 Agent 上下文
    │
    ▼
Agent 直接使用编译后的知识（无需重新推导）
    │
    ▼
（可选）如果回答产生了新的综合分析 → 回写为新页面
```

### 5.3 匹配算法

```ts
// wiki-query.ts

interface WikiIndexEntry {
  name: string;
  description: string;
  category: string;
  filename: string;
  triggers: string[];
}

interface MatchResult {
  entry: WikiIndexEntry;
  score: number;
  matchedBy: 'name' | 'description' | 'triggers';
}

/**
 * 从 index.md 解析索引条目
 */
function parseIndex(indexContent: string): WikiIndexEntry[]

/**
 * 将用户提问分词（中文逐字 + 英文按词）
 */
function tokenize(query: string): string[]

/**
 * 在索引中匹配相关条目
 *
 * 匹配权重：
 * - triggers 匹配: 3 分（最高，因为 triggers 是为召回设计的）
 * - description 匹配: 2 分（信息密度大）
 * - name 匹配: 1 分
 *
 * 返回 top 5
 */
export function matchIndex(
  query: string,
  entries: WikiIndexEntry[],
): MatchResult[]

/**
 * 读取索引并匹配相关页面
 * 两步检索：先索引匹配，再读取完整 content
 */
export async function loadWikiContext(
  query: string,
  wikiDir: string,
  options?: { maxResults?: number },
): Promise<{
  matched: MatchResult[];
  pages: Array<{ name: string; content: string }>;
}>

/**
 * 格式化为系统提示词
 */
export function formatWikiContextForPrompt(
  pages: Array<{ name: string; content: string }>,
): string
```

### 5.4 匹配示例

用户提问：「你几岁了？」

分词：`["你", "几", "岁", "了"]`

索引条目：
```
- [[aura-出生日期]] — Aura 的出生日期是 2026-06-23
  触发器: 你几岁, 出生日期, 什么时候出生
```

匹配：
- triggers "你几岁" → 分词 ["你", "几", "岁"] → 命中 3/3 → score = 3 × 3 = 9
- description "Aura 的出生日期是 2026-06-23" → 命中 "出", "生" → score = 2 × 2 = 4
- name "Aura 出生日期" → 命中 "出", "生" → score = 1 × 2 = 2
- 总分 = 15 → 命中

读取页面 content → 注入系统提示词 → Agent 直接回答。

### 5.5 Query 结果回写（Writeback）

来自 LLM Wiki：

> "good answers can be filed back into the wiki as new pages."

当 Agent 在对话中产生了有价值的综合分析，应该回写为新页面：

```
用户问: "Vue 和 React 哪个适合我的项目？"
    │
    ▼
召回: [[编程-偏好]]（TypeScript）, [[当前-项目]]（TheThing）
    │
    ▼
Agent 分析后回答: "基于你的偏好（TypeScript、简洁代码、个人项目），Vue 更适合..."
    │
    ▼
判断：这个分析是否值得保存？
    ├─ 是 → 调用 save_memory 创建 [[vue-vs-react-对比]] 页面
    └─ 否 → 不保存
```

**回写触发条件：**
- 对比分析（A vs B）
- 综合结论（基于多条记忆的推理）
- 用户明确说「记住这个」
- Agent 自己判断这个结论未来有用

### 5.6 系统提示词注入格式

```
## 已记住的知识

### 身份信息
- Aura 的出生日期是 2026年6月23日（首次聊天日期）。

### 行为规律
- 用户偏好 TypeScript 和简洁代码风格。

### 当前状态
- 用户正在开发 TheThing 个人助手项目。
```

Agent 看到的是**编译后的知识**，直接使用，不需要自己推导。

---

## 六、Lint：知识库健康检查

### 6.1 核心理念

来自 LLM Wiki：

> "Periodically, ask the LLM to health-check the wiki. Look for: contradictions between pages, stale claims superseded by newer sources, orphan pages without inbound links, important concepts lacking their own page, **missing cross-references**, data gaps fillable with web search."

### 6.2 检查项

| 检查项 | 实现方式 | 需要 LLM | 触发频率 |
|--------|---------|----------|---------|
| **索引同步** | 遍历目录，对比 index.md 与实际文件 | ❌ | 每次 ingest 后 |
| **一致性检测** | 检查 name/description/content 是否一致 | ❌ | 每次 ingest 后 |
| **过期检测** | 检查 updated 超过 90 天的页面 | ❌ | 每 N 次对话 |
| **矛盾检测** | LLM 对比两个页面的 content | ✅ | 每次 ingest 后（限定范围） |
| **孤儿检测** | 检查从未被其他页面 [[link]] 引用的页面 | ❌ | 每 N 次对话 |
| **交叉引用缺失** | 检查页面是否缺少应有的 [[wiki-link]] | ✅ | 每 N 次对话 |
| **缺失检测** | LLM 检查是否有重要主题缺失 | ✅ | 每 N 次对话 |

### 6.3 LINT_PROMPT（LLM 部分）

````
你是一个知识库健康检查员。检查以下知识库页面是否有问题。

## 检查项

1. **矛盾检测**：两个页面的 content 是否矛盾？
   - 如果矛盾，输出矛盾的页面和具体冲突点
   - 建议解决方案（哪个信息更新，应该 replace 哪个页面）

2. **交叉引用缺失**：页面之间是否缺少应有的 [[wiki-link]]？
   - 例如：[[编程-偏好]] 提到 TypeScript，[[当前-项目]] 也用 TypeScript，但没有互相引用

3. **缺失检测**：根据已有知识，是否有重要主题缺失？
   - 用户多次提到但没有对应页面的主题
   - 已有知识之间的空白区域

## 输出格式

```json
{
  "issues": [
    {
      "type": "contradiction",
      "severity": "high",
      "pages": ["居住地.md", "当前-位置.md"],
      "description": "一个说用户住在北京，一个说住在上海",
      "suggestion": "replace 居住地.md，使用更新的信息"
    },
    {
      "type": "missing-crossref",
      "severity": "low",
      "pages": ["编程-偏好.md", "当前-项目.md"],
      "description": "两个页面都提到 TypeScript，但没有互相引用",
      "suggestion": "在两个页面中添加 [[双向链接]]"
    }
  ]
}
```

没有问题时：{"issues": []}
````

### 6.4 Lint 流程

```
触发 Lint（每 N 次对话，或手动触发）
    │
    ▼
确定性检查（零 LLM 开销）：
    │
    ├─ 索引同步：
    │   遍历 wiki/ 中的所有 .md 文件
    │   对比 index.md 中的条目
    │   缺失 → 自动补到 index.md
    │   多余 → 自动从 index.md 移除
    │
    ├─ 过期检测：
    │   遍历所有页面，检查 updated 时间
    │   超过 90 天 → 标记为 stale
    │
    ├─ 孤儿检测：
    │   收集所有页面中的 [[wiki-link]]
    │   检查哪些页面从未被引用
    │
    └─ 一致性检测：
        检查每条索引的 description 与页面 content 第一句是否一致
        不一致 → 自动更新 description
    │
    ▼
语义检查（需要 LLM，限定范围）：
    │
    ├─ 矛盾检测：
    │   取最近 ingest 触及的页面 + 其他页面
    │   两两对比 content
    │   有矛盾 → 输出 issue
    │
    ├─ 交叉引用缺失：
    │   检查语义相关的页面是否缺少 [[wiki-link]]
    │
    └─ 缺失检测：
        基于已有知识推断可能缺失的主题
        输出建议
    │
    ▼
执行修复：
    │
    ├─ 索引不一致 → 自动修复
    ├─ 交叉引用缺失 → 自动添加 [[wiki-link]]
    ├─ 矛盾 → 根据 suggestion 执行 replace
    └─ 缺失 → 输出建议（不自动创建，需要用户确认）
    │
    ▼
输出健康报告 → 追加到 log.md
```

### 6.5 代码实现

```ts
// wiki-lint.ts

export interface LintIssue {
  type: 'contradiction' | 'orphan' | 'stale' | 'inconsistent' | 'missing-crossref' | 'missing-page';
  severity: 'low' | 'medium' | 'high';
  pages: string[];
  description: string;
  suggestion?: string;
}

export interface LintReport {
  checked: number;
  issues: LintIssue[];
  fixed: number;
  timestamp: string;
}

/**
 * 执行确定性检查（零 LLM 开销）
 */
export async function lintDeterministic(
  wikiDir: string,
): Promise<LintIssue[]>

/**
 * 执行语义检查（需要 LLM）
 */
export async function lintSemantic(
  wikiDir: string,
  model: LanguageModelV3,
  scope?: string[],  // 限定检查范围（页面文件名列表）
): Promise<LintIssue[]>

/**
 * 执行完整 Lint
 */
export async function lintWiki(
  wikiDir: string,
  model?: LanguageModelV3,
): Promise<LintReport>

/**
 * 自动修复可修复的问题（索引同步、一致性、交叉引用）
 */
export async function autoFix(
  wikiDir: string,
  issues: LintIssue[],
): Promise<number>
```

---

## 七、Agent 工具：save_memory

Agent 在对话中可以主动保存知识（对应 LLM Wiki 的 ingest + query writeback）：

```ts
// tools/save-wiki-memory.ts

const wikiActionSchema = z.object({
  action: z.enum(["create", "update", "merge", "replace"]),
  category: z.enum(["identity", "pattern", "state"]),
  name: z.string().max(20),
  description: z.string().max(50),
  content: z.string(),
  instruction: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  triggers: z.array(z.string()).min(1).max(5).optional(),
  target: z.string().optional(),
  mergeTargets: z.array(z.string()).optional(),
})

export function createSaveWikiMemoryTool(config: {
  userId: string;
  wikiBaseDir: string;
}) {
  return tool({
    description: `将对话中的知识编译并保存到知识库。

【何时调用】
- 用户说出了关于自己的事实（偏好、身份、习惯）
- 用户纠正了你的行为，且应长期保持
- 你在对话中产生了有价值的综合分析或对比结论
- 用户提到需要跨会话记住的约束或决策
- 用户给了间接指令，需要你推导结论

【何时不调用】
- 可以从代码、文件、git 历史推导的信息
- 临时性任务信息
- 用户只是表达了即时情绪

【Content 编译规则】
- 直接事实 → content = 事实本身
- 间接指令 → content = 推导结论，instruction = 用户指令
- 行为纠正 → content = 编译后的规则
- 综合分析 → content = 结论

【规则】
- content 存储的是 AI 未来需要知道的信息，不是用户说了什么
- 增强优先于创建：新信息与已有知识相关时，使用 update
- 如果更新已有记忆，使用 target 指定目标文件名
- content 中可以使用 [[wiki-link]] 建立交叉引用`,
    inputSchema: z.object({
      actions: z.array(wikiActionSchema).max(5)
        .describe("要执行的操作列表，每次最多 5 条"),
    }),
    execute: async (input) => {
      // 执行每个 action，返回结果
    },
  })
}
```

### Tool Description（注入 Agent 系统提示词）

```
## 知识库管理

### 主动知识保存（重要）

**当用户说出关于自己的信息时，你必须立即调用 save_memory 工具保存。**

不要等到对话结束，发现即保存。这是你的核心能力之一。

**必须保存的情况：**
- 用户说"我喜欢..."、"我讨厌..."、"我习惯..." → create, category: state
- 用户说"我是...人"、"我的工作是..." → create, category: identity
- 用户纠正你的行为 → create/update, category: pattern
- 用户提到项目约束 → create, category: state
- 用户给了间接指令 → create, content 写推导结论

**Content 编译规则：**
- 用户说的话本身就是事实 → content = 事实
- 用户给了规则/指令 → content = 推导后的结论，instruction = 用户指令
- 用户纠正了行为 → content = 编译后的规则

### 什么不要保存
- 代码模式（可以从代码推导）
- 文件结构（可以实时查看）
- Git 历史（可以 git log 查看）
- 临时性任务信息
```

---

## 八、配置

```ts
// wiki-config.ts

export interface WikiConfig {
  /** 索引文件名 */
  indexFile: string;          // 默认: "index.md"
  /** 日志文件名 */
  logFile: string;            // 默认: "log.md"
  /** 知识分类 */
  categories: string[];       // 默认: ["identity", "pattern", "state"]
  /** Lint 触发间隔（对话次数） */
  lintInterval: number;       // 默认: 10
  /** 过期阈值（天） */
  staleThresholdDays: number; // 默认: 90
  /** 最大页面数 */
  maxPages: number;           // 默认: 200
  /** 每次 ingest 最大操作数 */
  maxActionsPerIngest: number; // 默认: 5
  /** Query 最大召回数 */
  maxRecallResults: number;   // 默认: 5
}

export const DEFAULT_WIKI_CONFIG: WikiConfig = {
  indexFile: 'index.md',
  logFile: 'log.md',
  categories: ['identity', 'pattern', 'state'],
  lintInterval: 10,
  staleThresholdDays: 90,
  maxPages: 200,
  maxActionsPerIngest: 5,
  maxRecallResults: 5,
}
```

---

## 九、集成点

### 9.1 Agent 创建时加载知识

```ts
// modules/agent/context/wiki-context.ts

export async function loadWikiContext(
  query: string,
  userId: string,
  wikiBaseDir: string,
): Promise<string> {
  // 1. 读取 index.md 索引
  // 2. 匹配相关页面
  // 3. 读取完整 content
  // 4. 格式化为系统提示词
  // 5. 追加到 Agent 上下文
}
```

### 9.2 System Prompt 构建

```ts
// modules/system-prompt/sections/wiki.ts

export function createWikiSection(
  wikiContext: string,
): string {
  if (!wikiContext) return ''
  return `## 已记住的知识\n\n${wikiContext}`
}
```

### 9.3 对话结束时触发 Ingest

```ts
// 在 turn-executor 或类似位置

// 对话结束后
await ingestWikiFromConversation(
  messages,
  userId,
  model,
  wikiBaseDir,
)
```

### 9.4 定期触发 Lint

```ts
// 每 N 次对话后
if (conversationCount % wikiConfig.lintInterval === 0) {
  await lintWiki(wikiDir, model)
}
```

---

## 十、迁移策略

### 10.1 旧数据迁移

旧系统的记忆文件（`~/.thething/memory/users/<userId>/memory/`）需要迁移到新格式：

```
旧格式（扁平或 tiered）→ 新格式（扁平 + 新 frontmatter）
```

迁移规则：
1. 读取旧文件的 frontmatter
2. 映射字段：
   - `type: user` + `stability: identity` → `category: identity`
   - `type: user` + `stability: pattern` → `category: pattern`
   - `type: feedback` → `category: pattern`
   - `type: project` → `category: state`
   - `type: reference` → `category: state`
   - `stability: state` → `category: state`
3. 添加新字段（created, updated, triggers, aliases）
4. 重写 content（如果旧 content 是原文转述，需要 LLM 重新编译）
5. 写入新目录结构
6. 重建 index.md 索引
7. 旧目录备份为 `_legacy`

### 10.2 并行运行期

迁移期间新旧系统并行运行：
1. 新对话使用新系统（ingest + query）
2. 旧记忆文件保留，通过旧系统召回
3. 随着新知识积累，旧记忆逐渐被新编译的知识替代
4. 确认稳定后删除旧系统代码

### 10.3 不迁移的场景

如果旧记忆质量太差（大量原文转述），可以：
1. 不迁移旧数据
2. 从空知识库开始
3. 让新系统在后续对话中重新编译

---

## 十一、文件清单

### 新系统（9 个文件）

```
packages/core/src/modules/wiki/
├── index.ts              # barrel export
├── wiki-paths.ts         # 路径工具
├── wiki-io.ts            # 文件 IO（读写 + 索引 + 日志）
├── wiki-prompt.ts        # LLM prompt + Zod schema
├── wiki-ingest.ts        # Ingest 流程
├── wiki-query.ts         # Query 流程
├── wiki-lint.ts          # Lint 检查
└── wiki-config.ts        # 配置

packages/core/src/modules/tools/
└── save-wiki-memory.ts   # Agent 工具
```

### 可删除的旧文件（14 个）

```
packages/core/src/modules/memory/
├── types.ts              → wiki-prompt.ts
├── paths.ts              → wiki-paths.ts
├── frontmatter.ts        → wiki-io.ts
├── memory-store.ts       → wiki-io.ts
├── memory-scan.ts        → 删除（用索引代替）
├── memory-capture.ts     → wiki-ingest.ts
├── memory-recall.ts      → 删除（不需要召回追踪）
├── memory-age.ts         → 删除（Lint 检查代替）
├── find-relevant.ts      → wiki-query.ts
├── memdir.ts             → wiki-io.ts
├── usage-tracker.ts      → 删除（不需要使用追踪）
├── promotion.ts          → 删除（不需要晋升机制）
├── tiered-storage.ts     → 删除（不需要分层存储）
└── tiered-recall.ts      → 删除（不需要 token 预算）
```

### 需要修改的文件

```
packages/core/src/modules/agent/context/memory-context.ts
  → 改为调用 wiki-query.ts

packages/core/src/modules/system-prompt/sections/memory.ts
  → 改为调用 wiki 格式化

packages/core/src/modules/tools/index.ts
  → 替换 save-memory 为 save-wiki-memory

packages/app/components/MemorySettings.tsx
  → 适配新 frontmatter 格式

packages/app/app/api/memory/route.ts
  → 适配新目录结构
```

---

## 十二、关键差异总结

| 维度 | 旧系统 | 新系统 | LLM Wiki 对应 |
|------|--------|--------|-------------|
| 设计理念 | 代码做智能判断 | LLM 做判断，代码只做 IO | "LLM writes and maintains all of it" |
| 文件数量 | 17 个 | 9 个 | 极简 |
| 存储结构 | tiered + flat 兼容 | 扁平目录 | "a directory of markdown files" |
| Content 语义 | 用户说了什么 | AI 需要知道什么 | "compiled once and kept current" |
| 检索方式 | 全量 token 扫描 | Index-first + triggers | "reads the index first, then drills in" |
| 交叉引用 | 无 | [[wiki-link]] | "Cross-references are already present" |
| 维护操作 | 无 | Lint | "health-check the wiki" |
| 操作日志 | 无 | log.md | "append-only record" |
| 知识回写 | 无 | Query writeback | "good answers can be filed back" |
| 信任层 | confidence + promotion | 不需要 | LLM 直接判断 |
| 使用追踪 | usage.json | 不需要 | Lint 直接检查 |
| 过期机制 | dormantAfterDays | 不需要 | Lint 检查 updated 时间 |
| Compounding | 不明确 | 每次 ingest/query 都累积 | "grows richer with each source and question" |
