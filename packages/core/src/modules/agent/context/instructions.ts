// ============================================================
// Agent Instructions - System prompt building
// ============================================================

import type { Skill } from '../../../modules/skills/types'
import type { PermissionRule } from '../../../modules/permissions/types'
import type { LoadedProjectContext } from '../../../modules/system-prompt/sections/project-context'
import { buildSystemPrompt } from '../../../modules/system-prompt'
import type { MemoryContext } from '../types'

/**
 * 构建 Agent 指令
 *
 * @param memoryContext 记忆上下文（wiki）
 * @param options 构建选项（包含已加载的数据）
 */
export interface BuildInstructionsOptions {
  cwd?: string
  memoryBaseDir?: string
  skills?: Skill[]
  permissions?: PermissionRule[]
  projectContext?: LoadedProjectContext
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
  /** 自定义指令（如 Agent 定义的 instructions），追加到系统提示词末尾 */
  customInstructions?: string
  /** 要跳过的 section 名称列表（如 ['identity'] 用于自定义 Agent） */
  excludeSections?: string[]
}

export async function buildAgentInstructions(
  memoryContext: MemoryContext | null,
  options?: BuildInstructionsOptions,
): Promise<string> {
  const { prompt } = await buildSystemPrompt({
    cwd: options?.cwd,
    skills: options?.skills,
    permissions: options?.permissions,
    projectContext: options?.projectContext,
    includeProjectContext: true,
    conversationMeta: options?.conversationMeta ?? undefined,
    memoryContext: memoryContext ?? undefined,
    memoryBaseDir: options?.memoryBaseDir,
    customInstructions: options?.customInstructions ?? null,
    excludeSections: options?.excludeSections,
  })

  const compactionHint = '\n\nWhen you finish using a tool\'s output, call compact_tool_result to free context space.'

  return prompt + compactionHint
}
