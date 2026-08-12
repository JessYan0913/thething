// ============================================================
// Agent Instructions - System prompt building
// ============================================================

import type { Skill } from '../../../modules/skills/types'
import type { PermissionRule } from '../../../modules/permissions/types'
import type { TodoStore } from '../../../modules/todos/types'
import type { LoadedProjectContext } from '../../../modules/system-prompt/sections/project-context'
import { buildSystemPrompt } from '../../../modules/system-prompt'
import type { WikiContext } from '../types'

/**
 * 构建 Agent 指令
 *
 * @param wikiContext 知识库上下文
 * @param options 构建选项（包含已加载的数据）
 */
export interface BuildInstructionsOptions {
  cwd?: string
  wikiBaseDir?: string
  skills?: Skill[]
  /** 预格式化的技能清单（常驻集三段式 A+B 段），提供时优先于 skills 的预算格式化 */
  skillListing?: string | null
  permissions?: PermissionRule[]
  projectContext?: LoadedProjectContext
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
    sessionSource?: string
    sessionSourceId?: string
  }
  /** 自定义指令（如 Agent 定义的 instructions），追加到系统提示词末尾 */
  customInstructions?: string
  /** 自定义 Agent 的身份指令，作为提示词开头的身份 section（替代 identity/capabilities） */
  agentIdentity?: string
  /** 已连接的 MCP 服务器及工具列表文本 */
  mcpServerTools?: string
  /** 要跳过的 section 名称列表（如 ['identity'] 用于自定义 Agent） */
  excludeSections?: string[]

  /** 用户记忆基础目录 */
  memoryBaseDir?: string

  /** 当前用户消息（用于记忆 relevance 打分） */
  memoryQuery?: string

  /** 任务存储（用于自动注入当前会话的任务清单） */
  todoStore?: TodoStore

  /** 当前会话 ID（用于筛选任务清单） */
  conversationId?: string
}

export async function buildAgentInstructions(
  wikiContext: WikiContext | null,
  options?: BuildInstructionsOptions,
): Promise<string> {
  const { prompt } = await buildSystemPrompt({
    cwd: options?.cwd,
    skills: options?.skills,
    skillListing: options?.skillListing,
    permissions: options?.permissions,
    projectContext: options?.projectContext,
    includeProjectContext: true,
    conversationMeta: options?.conversationMeta ?? undefined,
    wikiContext: wikiContext ?? undefined,
    wikiBaseDir: options?.wikiBaseDir,
    memoryBaseDir: options?.memoryBaseDir,
    memoryQuery: options?.memoryQuery,
    customInstructions: options?.customInstructions ?? null,
    agentIdentity: options?.agentIdentity ?? null,
    mcpServerTools: options?.mcpServerTools,
    excludeSections: options?.excludeSections,
    todoStore: options?.todoStore,
    conversationId: options?.conversationId,
  })

  return prompt
}
