// ============================================================
// Wiki Prompt - Zod Schema + Lint/Guidelines Prompt
// ============================================================
// Schema 定义 + Lint 和 Guidelines Prompt。

import { z } from 'zod'

// ============================================================
// Zod Schema - LLM 输出结构
// ============================================================

export const wikiActionSchema = z.object({
  action: z
    .enum(['create', 'update', 'merge', 'replace', 'invalidate'])
    .describe('操作类型'),
  mode: z
    .enum(['replace', 'append'])
    .optional()
    .describe('update 操作的模式: replace=替换旧内容(默认), append=追加到旧内容'),
  category: z
    .enum(['user', 'agent', 'project', 'domain', 'entity'])
    .describe('知识分类: user=用户相关, agent=Agent规则, project=项目知识, domain=领域知识, entity=实体知识'),
  name: z
    .string()
    .max(40)
    .describe('页面名称（简短描述性）'),
  description: z
    .string()
    .max(50)
    .describe('一行摘要（用于索引，不是 content 复述）'),
  content: z
    .string()
    .describe('编译后的知识（AI 未来需要知道的信息，可包含 [[wiki-link]]）'),
  target: z
    .string()
    .optional()
    .describe('目标文件名（update/merge/replace/invalidate 时必填）'),
  mergeTargets: z
    .array(z.string())
    .optional()
    .describe('合并目标文件名列表（merge 时必填）'),
})

export type WikiAction = z.infer<typeof wikiActionSchema>

// ============================================================
// Lint Schema
// ============================================================

export const lintIssueSchema = z.object({
  type: z
    .enum(['contradiction', 'orphan', 'stale', 'inconsistent', 'missing-crossref', 'missing-page'])
    .describe('问题类型'),
  severity: z
    .enum(['low', 'medium', 'high'])
    .describe('严重程度'),
  pages: z
    .array(z.string())
    .describe('涉及的页面文件名'),
  description: z
    .string()
    .describe('问题描述'),
  suggestion: z
    .string()
    .optional()
    .describe('修复建议'),
})

export const lintOutputSchema = z.object({
  issues: z.array(lintIssueSchema).describe('发现的问题列表'),
})

export type LintIssue = z.infer<typeof lintIssueSchema>
export type LintOutput = z.infer<typeof lintOutputSchema>

// ============================================================
// LINT_PROMPT - 知识库健康检查 Prompt
// ============================================================

export const LINT_PROMPT = `你是一个知识库健康检查员。检查以下知识库页面是否有问题。

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

\`\`\`json
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
\`\`\`

没有问题时：{"issues": []}`

// ============================================================
// 记忆管理 Prompt（注入 Agent 系统提示词）
// ============================================================

export const WIKI_GUIDELINES_PROMPT = `## 知识库（你的长期记忆）

你有一个持久化的知识库（Wiki）。这是一个持久的、持续增长的知识工件——你跨会话记忆的唯一机制。不保存的知识会永远丢失。

**核心理念（来自 Karpathy）：**
Wiki 是持久的、复合的知识工件。你增量地构建和维护它——结构化的、相互链接的 markdown 文件。当添加新来源时，你将其整合到现有 wiki 中，更新实体页、修订摘要、标注矛盾。

"知识库的繁琐部分不是阅读或思考——而是簿记。" LLM 处理交叉引用、一致性和多文件更新的成本几乎为零。

### 三个核心操作

1. **Ingest**：放入来源 → 你读取它，讨论要点，写摘要页，更新 index，更新实体/概念页，追加到日志。一个来源可能触及 10-15 个页面。
2. **Query**：基于 wiki 提问。你搜索相关页面，综合回答并引用。好的回答可以作为新 wiki 页面存入，让探索像摄入来源一样复合增长。
3. **Lint**：定期健康检查，检查矛盾、过时声明、孤立页面、缺失交叉引用和数据缺口。

### 何时保存

**Ingest操作（用户发送URL并说"学习"、"阅读"、"看一下"等）：**
1. 先获取URL内容
2. 整理要点后回答用户
3. 调用save_wiki保存：
   - 创建摘要页面（**只创建页面，index.md和log.md会自动更新**）
   - 如果需要，更新相关的已有页面（用update操作）

**Query操作的回答保存：**
- 当你的回答包含有价值的综合分析时，可以作为新页面存入wiki

**其他保存场景：**
- 用户明确的信息：偏好、习惯、身份
- 行为纠正：用户指出的规则或偏好
- 技术对比：你做的对比分析、架构决策
- 研究发现：论文洞察、最佳实践
- 综合判断：跨多个来源的分析

**重要：save_wiki会自动处理以下操作：**
- **自动重建index.md**：每次保存后，会扫描所有页面并重建索引
- **自动追加log.md**：每次保存后，会记录操作到日志
- **你只需要创建/更新页面，不需要手动管理索引和日志**

### 交叉引用（Ingest的核心）

每次 Ingest 不只是创建一个页面——一个来源通常会触及多个页面。按以下步骤操作：

1. **读 index**：检查现有页面列表（index.md会自动重建，但你需要先读取它了解现有内容）
2. **创建新页面**：在 content 正文中用 [[页面名称]] 引用相关已有页面
3. **更新被引用的页面**：对每个被引用的已有页面，用 update 操作（mode: append）追加反向链接和新信息
4. **标注矛盾**：如果新信息与已有页面冲突，在两个页面中都标注矛盾

**交叉引用的正确方式：**
- ✅ 在页面正文中用 [[页面名称]] 引用（如："这与[[大型语言模型-概述]]中的转换器架构相关"）
- ❌ 不要创建"相关页面"部分（已经在正文体现了）
- ❌ 不要为了"完整性"创建额外页面

交叉引用是预构建的，不是事后添加的。一次 ingest 可能同时更新 5-10 个页面。

### index.md 和 log.md

- **index.md**：内容导向的目录，包含链接、一行摘要和元数据，按类别组织。每次 ingest 都更新。
- **log.md**：时间顺序的追加记录，记录所有活动。使用一致的前缀（如 ## [2026-06-24] ingest | 标题）使其可解析。

### Content 编译规则

- content 写的是"AI 未来需要知道什么"，不是"用户说了什么"
- 直接事实 → 事实本身
- 行为纠正 → 编译后的规则
- 技术对比 → 结论 + 原因
- 架构决策 → 决策 + 理由

### 使用知识

当知识库中有相关信息时，直接使用，不要犹豫。不要说"根据记忆"——直接陈述事实。
- ✅ "Karpathy 提出 LLM Wiki 模式"  ❌ "关于 Karpathy"`
