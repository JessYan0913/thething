// ============================================================
// Agent Context - Skills 和 Memory 上下文构建
// ============================================================

import type { UIMessage } from 'ai'
import {
  getAvailableSkillsMetadata,
  loadFullSkill,
  recordSkillUsage,
  determineActiveSkills,
} from '../skills'
import {
  findRelevantMemories,
  buildMemorySection,
  getUserMemoryDir,
  ensureMemoryDirExists,
} from '../memory'
import { buildSystemPrompt } from '../system-prompt'
import type { SkillResolution, MemoryContext } from './types'

export async function resolveActiveSkills(messages: UIMessage[], cwd?: string): Promise<SkillResolution> {
  const skillsMetadata = await getAvailableSkillsMetadata({ cwd })

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

  const activeSkillNames = determineActiveSkills(skillsMetadata, userMessageText)
  if (activeSkillNames.size === 0) {
    return {
      activeSkillNames,
      activeSkills: [],
      activeToolsWhitelist: null,
      activeModelOverride: null,
    }
  }

  const activeSkills = await Promise.all(
    Array.from(activeSkillNames).map(async (name) => {
      const metadata = skillsMetadata.find((s) => s.name === name)
      if (!metadata) return null
      return loadFullSkill(metadata)
    }),
  )

  const filteredActiveSkills = activeSkills.filter((s): s is NonNullable<typeof s> => s !== null)

  for (const skill of filteredActiveSkills) {
    recordSkillUsage(skill.name)
  }

  const allAllowedTools = new Set<string>()
  let modelOverride: string | null = null
  for (const skill of filteredActiveSkills) {
    for (const tool of skill.allowedTools) {
      allAllowedTools.add(tool)
    }
    if (skill.model && !modelOverride) {
      modelOverride = skill.model
    }
  }

  return {
    activeSkillNames,
    activeSkills: filteredActiveSkills.map((s) => ({
      name: s.name,
      body: s.body,
      allowedTools: s.allowedTools,
      model: s.model,
    })),
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

export async function buildAgentInstructions(
  skillResolution: SkillResolution | null,
  memoryContext: MemoryContext | null,
  conversationMeta?: {
    messageCount: number
    isNewConversation: boolean
    conversationStartTime: number
  },
  cwd?: string,
): Promise<string> {
  const { prompt } = await buildSystemPrompt({
    cwd,
    includeProjectContext: true,
    conversationMeta: conversationMeta ?? undefined,
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