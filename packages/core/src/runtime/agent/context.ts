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
import { truncateEntrypointContent } from '../../extensions/memory/memdir'
import { buildSystemPrompt } from '../../extensions/system-prompt'
import type { SkillResolution, MemoryContext } from './types'

export interface MemoryLoadOptions {
  entrypointMaxLines?: number
  entrypointMaxBytes?: number
}

export async function resolveActiveSkills(messages: UIMessage[], skills: Skill[]): Promise<SkillResolution> {
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
  memoryBaseDir: string,
  options?: MemoryLoadOptions,
): Promise<MemoryContext> {
  const userMemDir = getUserMemoryDir(userId, memoryBaseDir)
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
      let content = await buildMemorySection(relevantMemories, userMemDir)
      if (options?.entrypointMaxBytes || options?.entrypointMaxLines) {
        content = truncateEntrypointContent(content, options?.entrypointMaxLines, options?.entrypointMaxBytes)
      }
      recalledMemoriesContent = content
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
  memoryBaseDir?: string
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
    memoryBaseDir: options?.memoryBaseDir,
  })

  // 技能指令现在通过 Skill 工具注入，不再拼接到系统提示词
  return prompt
}
