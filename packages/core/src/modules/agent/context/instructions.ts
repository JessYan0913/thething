// ============================================================
// Agent Instructions - System prompt building
// ============================================================

import type { Skill } from '../../../modules/skills/types'
import type { PermissionRule } from '../../../modules/permissions/types'
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
  /** 已连接的 MCP 服务器及工具列表文本 */
  mcpServerTools?: string
  /** 要跳过的 section 名称列表（如 ['identity'] 用于自定义 Agent） */
  excludeSections?: string[]
}

export async function buildAgentInstructions(
  wikiContext: WikiContext | null,
  options?: BuildInstructionsOptions,
): Promise<string> {
  const { prompt } = await buildSystemPrompt({
    cwd: options?.cwd,
    skills: options?.skills,
    permissions: options?.permissions,
    projectContext: options?.projectContext,
    includeProjectContext: true,
    conversationMeta: options?.conversationMeta ?? undefined,
    wikiContext: wikiContext ?? undefined,
    wikiBaseDir: options?.wikiBaseDir,
    customInstructions: options?.customInstructions ?? null,
    mcpServerTools: options?.mcpServerTools,
    excludeSections: options?.excludeSections,
  })

  return prompt
}
