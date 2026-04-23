// ============================================================
// Agent Context - Skills 和 Memory 上下文构建
// ============================================================

import type { UIMessage } from 'ai'
import type { Skill } from '../../extensions/skills/types'
import type { PermissionRule } from '../../extensions/permissions/types'
import type { MemoryEntry } from '../../api/loaders/memory'
import type { LoadedProjectContext } from '../../extensions/system-prompt/sections/project-context'
import {
  findRelevantMemories,
  buildMemorySection,
  getUserMemoryDir,
  ensureMemoryDirExists,
} from '../../extensions/memory'
import { buildSystemPrompt } from '../../extensions/system-prompt'
import type { SkillResolution, MemoryContext } from './types'

/**
 * 解析激活的 Skills
 *
 * 简化版：不再使用 TF-IDF 自动发现技能。
 * Agent 通过 Skill 工具主动调用技能。
 *
 * @param messages 消息列表
 * @param skills 已加载的 Skill 列表
 * @returns SkillResolution（空结果，技能通过工具调用）
 */
export async function resolveActiveSkills(messages: UIMessage[], skills: Skill[]): Promise<SkillResolution> {
  // 技能现在通过 Skill 工具主动调用，不再自动激活
  return {
    activeSkillNames: new Set<string>(),
    activeSkills: [],
    activeToolsWhitelist: null,
    activeModelOverride: null,
  }
}

export async function loadMemoryContext(
  messages: UIMessage[],
  userId: string,
): Promise<MemoryContext> {
  const userMemDir = getUserMemoryDir(userId)
  await ensureMemoryDirExists(userMemDir)

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessageText = lastUserMessage?.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ') || ''

  let recalledMemoriesContent = ''
  if (lastUserMessageText) {
    const relevantMemories = await findRelevantMemories(lastUserMessageText, userMemDir, {
      maxResults: 5,
    })

    if (relevantMemories.length > 0) {
      recalledMemoriesContent = await buildMemorySection(relevantMemories, userMemDir)
    }
  }

  return {
    userId,
    recalledMemoriesContent,
  }
}

/**
 * 构建 Agent 指令
 *
 * 简化版：技能指令现在通过 Skill 工具注入，不再拼接到系统提示词
 *
 * @param skillResolution 激活的技能解析结果（现在总是空）
 * @param memoryContext 记忆上下文
 * @param options 构建选项（包含已加载的数据）
 */
export interface BuildInstructionsOptions {
  cwd?: string  // 工作目录，用于告诉 Agent 正确的执行路径
  skills?: Skill[]
  permissions?: PermissionRule[]
  memoryEntries?: MemoryEntry[]
  projectContext?: LoadedProjectContext
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  }
}

export async function buildAgentInstructions(
  skillResolution: SkillResolution | null,
  memoryContext: MemoryContext | null,
  options?: BuildInstructionsOptions,
): Promise<string> {
  const { prompt } = await buildSystemPrompt({
    cwd: options?.cwd,  // 传递工作目录给系统提示
    skills: options?.skills,
    permissions: options?.permissions,
    memoryEntries: options?.memoryEntries,
    projectContext: options?.projectContext,
    includeProjectContext: true,
    conversationMeta: options?.conversationMeta ?? undefined,
    memoryContext: memoryContext ?? undefined,
  })

  // 技能指令现在通过 Skill 工具注入，不再拼接到系统提示词
  return prompt
}