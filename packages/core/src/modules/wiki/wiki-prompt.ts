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
    .describe('本次变化的来源阶段。默认 ingest（来源摄取）；Query 过程中形成实质新分析、比较或联系并回写时，必须显式传 query，不能沿用页面原有 origin；lint 后的修订传 maintenance'),
  sources: z
    .array(wikiSourceSchema)
    .optional()
    .describe('支持本次页面变化的可选来源引用（URL、文件、Git 仓库、对话等），便于后续验证和修订，不要求所有页面必须提供。用户明确给出来源的 type、value 或 revision 时按其语义原样登记；例如仓库与 commit 应登记为 git 来源，不能仅因为信息出现在当前对话中就改成 conversation 来源'),
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
// 只保留核心心智：Wiki 是什么、三个操作、维护原则。
// 工具清单靠各工具自身的 description 呈现；sources/origin 等字段语义
// 写在 wikiActionSchema 的 .describe() 中，不在此重复。

export const WIKI_GUIDELINES_PROMPT = `## 知识库（你的长期记忆）

你有一个持久化的知识库（Wiki）：由你增量构建和维护的、相互链接的 Markdown 页面，是持续复利的知识工件。它位于原始来源与当前对话之间：读取来源和完成探索后，将有价值的理解整合进已有页面，而不是让它们消失在聊天记录中。

Wiki 由你负责维护。页面结构、分类和工作流不是固定制度，可以根据领域、已有内容和用户偏好逐步演化。

三个核心操作：**Ingest**（阅读来源，整合进现有页面，工具 ingest_wiki_source/save_wiki）、**Query**（基于 Wiki 回答；查询中产生的有价值分析和新联系也可保存回去）、**Lint**（定期检查矛盾、陈旧和缺失，工具 lint_wiki）。

### 维护原则

- 写入前先查看 index 和相关页面，优先整合、更新和建立 [[wiki-link]] 联系，而不是机械创建重复页面。
- 新来源与旧结论冲突时，记录冲突并修订综合判断，不要静默丢弃任一来源。
- 结论来自具体外部来源时，通过 ingest_wiki_source 或 sources 字段记录来源，便于后续冲突判断和追溯。
- 不要求预先归入固定知识类型，也不必等到知识完全稳定才记录；允许先形成有来源的工作理解，之后持续修正。
- 当前任务仍应得到直接回答或交付；Wiki 更新是探索成果的积累，不是替代。
- 知识库中有相关信息时直接使用，不要说"根据记忆"。`
