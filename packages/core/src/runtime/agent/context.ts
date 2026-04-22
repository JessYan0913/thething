// ============================================================
// Agent Context - Skills 和 Memory 上下文构建
// ============================================================

import type { UIMessage } from 'ai'
import type { Skill } from '../../extensions/skills/types'
import type { PermissionRule } from '../../extensions/permissions/types'
import type { MemoryEntry } from '../../api/loaders/memory'
import type { LoadedProjectContext } from '../../extensions/system-prompt/sections/project-context'
import {
  determineActiveSkills,
} from '../../extensions/skills'
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
 * 改造说明：接收已加载的 skills 数据，不再需要 cwd
 *
 * @param messages 消息列表
 * @param skills 已加载的 Skill 列表
 * @returns SkillResolution
 */
export function resolveActiveSkills(messages: UIMessage[], skills: Skill[]): SkillResolution {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUserMessage) {
    return {
      activeSkillNames: new Set<string>(),
      activeSkills: [],
      activeToolsWhitelist: null,
      activeModelOverride: null,
    }
  }

  const userMessageText = lastUserMessage.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')

  const activeSkillNames = determineActiveSkills(skills, userMessageText)
  if (activeSkillNames.size === 0) {
    return {
      activeSkillNames,
      activeSkills: [],
      activeToolsWhitelist: null,
      activeModelOverride: null,
    }
  }

  // 从传入的 skills 中获取激活的完整 Skill
  const activeSkills = skills
    .filter((s) => activeSkillNames.has(s.name))
    .map((s) => ({
      name: s.name,
      body: s.body,
      allowedTools: s.allowedTools,
      model: s.model,
    }))

  const allAllowedTools = new Set<string>()
  let modelOverride: string | null = null
  for (const skill of activeSkills) {
    for (const tool of skill.allowedTools) {
      allAllowedTools.add(tool)
    }
    if (skill.model && !modelOverride) {
      modelOverride = skill.model
    }
  }

  return {
    activeSkillNames,
    activeSkills,
    activeToolsWhitelist: allAllowedTools.size > 0 ? allAllowedTools : null,
    activeModelOverride: modelOverride,
  }
}

export function formatActiveSkillBodies(skillBodies: { name: string; body: string }[]): string {
  if (skillBodies.length === 0) return ''

  const sections = skillBodies
    .map((s) => `<技能指令 name="${s.name}">\n${s.body}\n</技能指令>`)
    .join('\n\n')

  return `## 已激活技能完整指令

以下技能已根据你的需求自动激活，请严格按照指令执行：

${sections}`
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
 * 改造说明：接收已加载的数据，不再需要 cwd
 *
 * @param skillResolution 激活的技能解析结果
 * @param memoryContext 记忆上下文
 * @param options 构建选项（包含已加载的数据）
 */
export interface BuildInstructionsOptions {
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
    skills: options?.skills,
    permissions: options?.permissions,
    memoryEntries: options?.memoryEntries,
    projectContext: options?.projectContext,
    includeProjectContext: true,
    conversationMeta: options?.conversationMeta ?? undefined,
    memoryContext: memoryContext ?? undefined,
  })

  const finalInstructions =
    skillResolution?.activeSkills && skillResolution.activeSkills.length > 0
      ? `${prompt}\n\n${formatActiveSkillBodies(
          skillResolution.activeSkills.map((s) => ({ name: s.name, body: s.body })),
        )}`
      : prompt

  return finalInstructions
}