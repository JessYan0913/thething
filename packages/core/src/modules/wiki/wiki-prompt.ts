// ============================================================
// Wiki Prompt - Zod Schema + Lint/Guidelines Prompt
// ============================================================
// Schema 定义 + Lint 和 Guidelines Prompt。

import { z } from 'zod'

// ============================================================
// Zod Schema - LLM 输出结构
// ============================================================

export const wikiSourceSchema = z.object({
  type: z
    .enum(['url', 'file', 'git', 'conversation', 'other'])
    .describe('来源类型'),
  value: z
    .string()
    .min(1)
    .describe('来源标识，例如 URL、文件路径、仓库地址或对话 ID'),
  revision: z
    .string()
    .optional()
    .describe('可选版本，例如 Git commit、文档版本或内容哈希'),
  capturedAt: z
    .string()
    .optional()
    .describe('可选采集时间，推荐 ISO 8601'),
  title: z
    .string()
    .optional()
    .describe('可选来源标题'),
})

export const wikiActionSchema = z.object({
  action: z
    .enum(['create', 'update', 'merge', 'replace', 'invalidate'])
    .describe('操作类型'),
  origin: z
    .enum(['ingest', 'query', 'maintenance'])
    .optional()
    .describe('本次变化的来源阶段；默认 ingest，Query 产生的新综合可标记为 query'),
  sources: z
    .array(wikiSourceSchema)
    .optional()
    .describe('支持本次页面变化的可选来源引用，不要求所有页面必须提供'),
  mode: z
    .enum(['replace', 'append'])
    .optional()
    .describe('update 操作的模式: replace=替换旧内容(默认), append=追加到旧内容'),
  category: z
    .string()
    .max(30)
    .optional()
    .describe('可选分类，用于索引分组。分类由实践演化，不是固定制度；常见分类如 user(用户)、agent(Agent规则)、project(项目)、domain(领域)、entity(实体)，也可以按内容使用更贴切的分类。省略时归入 misc'),
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

export type WikiSource = z.infer<typeof wikiSourceSchema>
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
   - 注意链接方向：具体的页面应引用泛化的页面（如"GPT-4"引用"Transformer架构"），不要反过来让泛化页面引用每一个具体页面

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
      "suggestion": "在具体页面中添加对泛化页面的引用"
    }
  ]
}
\`\`\`

没有问题时：{"issues": []}`

// ============================================================
// 记忆管理 Prompt（注入 Agent 系统提示词）
// ============================================================

export const WIKI_GUIDELINES_PROMPT = `## 知识库（你的长期记忆）

你有一个持久化的知识库（Wiki）。这是一个由你增量构建和维护的、结构化且相互链接的 Markdown 知识库。它位于原始来源与当前对话之间：读取来源和完成探索后，将有价值的理解整合进已有页面，而不是让它们消失在聊天记录中。

Wiki 由你负责维护。具体页面结构、分类和工作流不是固定制度，可以根据领域、已有内容和用户偏好逐步演化。

### 三个核心操作

1. **Ingest**：阅读来源，提取关键信息，并整合到现有 Wiki。一次来源可以创建摘要，也可以更新多个相关页面、交叉引用和综合判断。
2. **Query**：基于 Wiki 回答问题。查询中产生的有价值分析、比较或新联系，也可以保存回 Wiki，使探索持续积累。
3. **Lint**：定期检查矛盾、陈旧信息、孤立页面、缺失引用和知识空白，并持续整理。

### 维护方式

- 写入前先查看 index 和相关页面，优先整合、更新和建立联系，而不是机械创建重复页面。
- 新来源与旧结论冲突时，记录冲突并修订综合判断，不要静默丢弃任一来源。
- 内容可以包含摘要、实体、概念、事件、步骤、比较、项目知识和不断演化的综合分析；页面形式服务于知识积累，不要求预先归入固定知识类型。
- 不必等到知识完全稳定或结构完美才记录。允许先形成有来源、有上下文的工作理解，之后通过新的来源、查询和 lint 持续修正。
- 当前任务仍应得到直接回答或交付；Wiki 更新是对探索成果的积累，而不是替代用户要求。

**注意：** index.md 和 log.md 会自动维护，你只需创建、更新、合并或修订普通页面。

### 交叉引用

如果新页面与已有知识相关，用 [[页面名称]] 建立联系。随着理解变化，维护这些链接和摘要，使 Wiki 成为持续复利的知识工件。

### 来源追踪

保存页面时可以通过 sources 字段记录支持该页面的来源（URL、文件、Git 仓库、对话等），便于后续验证和修订。来源是可选的——不要求所有页面必须提供，但当页面结论来自具体外部来源时，记录来源有助于冲突判断和知识追溯。用户明确给出来源的 type、value 或 revision 时，按其语义原样登记；例如仓库与 commit 应登记为 git 来源，不能仅因为信息出现在当前对话中就改成 conversation 来源。

通过 origin 字段标记本次变化发生的阶段：ingest（来源摄取）、query（查询中产生的新综合）或 maintenance（lint 后的修订）。普通来源摄取可省略并默认为 ingest；如果 Query 过程中形成实质新分析、比较或联系并决定回写，必须显式传 origin: query，不能沿用页面原有 origin。

### 工具

- **ingest_wiki_source**：登记一个原始来源，可选保存不可变文本快照，并把该来源附加到本次所有页面变化；没有页面变化时 actions 传空数组，只登记或去重来源。
- **save_wiki**：创建、更新、合并、替换或失效页面，可附带来源和来源阶段。
- **read_wiki_page**：按需读取指定页面内容。
- **lint_wiki**：主动检查知识库健康状况。确定性问题（如索引不同步）会自动修复；语义问题（矛盾、缺失引用、知识缺口）只返回建议，由你结合来源决定是否修订。
- **inspect_wiki_history**：只读查看页面修订、比较 diff，或查询一个来源影响了哪些页面。
- **restore_wiki_revision**：显式恢复指定历史修订。恢复会形成新的修订并保留后续历史；不要根据 Lint 建议自动恢复。

### 使用知识

当知识库中有相关信息时，直接使用，不要说"根据记忆"。`
