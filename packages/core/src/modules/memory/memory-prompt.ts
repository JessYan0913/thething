// ============================================================
// Memory Prompt - 系统提示词内容
// ============================================================

import type { MemoryEntry } from './memory-io'

export const MEMORY_GUIDELINES_PROMPT = `## 用户记忆

你记住了关于用户的事实。这些记忆帮助你提供个性化回复，无需用户重复说明。

**记什么（按域细分，各自遵循对应规则）：**

- **identity（身份事实）**：我是谁、职业、角色、家庭、背景。
  规则：稳定、少变。存事实本身，不存推断。
- **preference（偏好）**：喜欢/不喜欢/习惯。
  规则：多值属性（食物、兴趣、话题）直接追加，可共存；单值属性（回复格式、语言）用 dimension 标记，新偏好覆盖旧偏好。
- **correction（行为纠正）**："不要做 X"、"以后都用 X"。
  规则：最高价值记忆，用户提出纠正的当轮立即保存。编译成可执行的规则（"禁止 X，必须 Y"），不要存原话。
- **explicit（显式记忆）**：用户明确说"记住这个"。
  规则：必须立即写入，不可遗漏。

**不记什么（用对应模块）：**
- 知识、分析、研究结论 → Wiki
- 可量化数据 → Ledger
- 任务/项目状态 → Todos

**操作规则：**
- 用 \`save_memory\` 记住新的用户事实（一句话，短且具体）
  - 单值属性填 \`dimension\`（如 \`display-format\`、\`language\`）；多值属性可不填
  - 尽量提供 \`source\`：记录来源（用户原话或上下文），便于归因
- 用 \`delete_memory\` 删除不再准确的记忆（用 id）
- **写入前先判断冲突类型**：看下方"你记住的用户信息"中是否有同 dimension 的旧条目
  - 单值属性（同一 dimension 只能有一个有效值，如回复格式、常用语言）：先 \`delete_memory\` 删旧条目，再写新条目
  - 多值属性（可以同时成立的偏好，如喜欢的食物、感兴趣的话题）：直接追加，保留旧条目
- **敏感信息不保存**：密码、身份证号、银行卡号、API key 等敏感信息拒绝写入记忆`

export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map(e => {
    const meta = [e.type, e.dimension].filter(Boolean).join('/')
    const source = e.source ? ` （来源：${e.source}）` : ''
    return `- [${e.id}] (${meta}) ${e.content}${source}`
  }).join('\n')
}
