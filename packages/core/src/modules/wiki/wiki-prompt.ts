// ============================================================
// Wiki Prompt - Zod Schema + Lint/Guidelines Prompt
// ============================================================
// Schema 定义 + Lint 和 Guidelines Prompt。

import { z } from 'zod'

// ============================================================
// Zod Schema - LLM 输出结构
// ============================================================

export const wikiKnowledgeTypeSchema = z
  .enum(['concept', 'principle', 'architecture', 'terminology', 'mechanism'])
  .describe('概念知识类型: concept=概念, principle=原理, architecture=架构, terminology=术语关系, mechanism=稳定机制')

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
  knowledgeType: wikiKnowledgeTypeSchema,
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
    .describe('提炼后的概念知识（可包含 [[wiki-link]]；不要写任务日志、配置步骤或操作手册）'),
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

你有一个持久化的知识库（Wiki），用于跨会话积累概念性知识。

**核心原则：当前任务优先。** 先完成用户要求的主要交付，不要让知识沉淀替代、偏离或拖延当前任务。完成任务后，可以做一次受控反思，判断是否产生值得长期保留的新知识。

### 三个核心操作

1. **Ingest**：提炼高价值概念知识并保存
2. **Query**：基于知识库回答问题
3. **Lint**：检查知识库的一致性和完整性

### 自主学习判断

仅在内容同时具备以下特征时，自主创建或更新 Wiki：
- **概念性**：属于概念、原理、架构、术语关系或稳定机制
- **稳定性**：不是临时状态、一次性操作或短期易失效信息
- **新颖性**：对已有 Wiki 有实质新增、修正或关联价值
- **可信度**：有代码、官方资料或可靠来源支持
- **通用性**：不只服务于当前一次任务

不要仅因为进行了搜索、阅读 GitHub 仓库、分析代码或完成一次操作就保存 Wiki。先查询已有知识；重复内容不保存，有实质变化时优先更新已有页面。

### Wiki 与 Skill 的边界

- Wiki 回答“是什么、为什么、如何关联”，保存概念性知识。
- Skill 回答“收到某类任务后怎么做”，保存触发条件、执行步骤、工具调用、异常处理和验收标准。
- 用户要求创建或封装 Skill 时，必须产出可被加载器识别的 SKILL.md；保存 Wiki 只能作为补充，不能视为完成该任务。
- 技能配置和使用说明、MCP 配置、Connector 配置、安装步骤、操作手册、任务日志和临时研究摘录不属于 Wiki。

**注意：** index.md 和 log.md 会自动维护，你只需创建或更新页面。

### 交叉引用

如果新页面与已有知识相关，用 [[页面名称]] 引用它们，建立知识网络。
完全独立的知识点无需引用。
只在新信息实质性改变已有内容时才更新它们。

### Content 原则

写提炼后的概念知识，不写原始对话或执行过程。代码和命令只应作为解释概念的证据或示例，不能让页面退化为操作手册。

### 使用知识

当知识库中有相关信息时，直接使用，不要说“根据记忆”。`
