/**
 * 消息附件注入器
 *
 * 在消息发送给 Agent 之前，注入技能附件：
 * - skill_listing: 技能摘要列表（供 Skill 工具使用）
 *
 * 注入方式：在消息列表开头添加 user 消息，内容包装为 system-reminder 标签
 */

import type { UIMessage } from 'ai'
import type { Skill } from '../skills/types'
import {
  getSkillListingAttachment,
  formatSkillListingMessage,
} from './skill-listing'
import { clearSentSkills } from './sent-tracker'

/**
 * 消息附件注入配置
 */
export interface MessageAttachmentConfig {
  /** session 唯一标识（用于追踪已发送技能） */
  sessionKey: string
  /** 已加载的技能列表 */
  skills: Skill[]
  /** context window token 数量 */
  contextWindowTokens?: number
}

/**
 * 消息附件注入结果
 */
export interface MessageAttachmentResult {
  /** 注入后的消息列表 */
  messages: UIMessage[]
  /** 是否注入了 skill_listing */
  hasSkillListing: boolean
  /** skill_listing 的技能数量 */
  skillListingCount: number
}

/**
 * 创建 skill_listing 消息
 *
 * 使用 user 角色，内容包装为 system-reminder 标签
 * 这样 Agent 会将其视为需要处理的信息
 *
 * @param content - system-reminder 内容
 * @returns UIMessage
 */
function createSkillListingMessage(content: string): UIMessage {
  return {
    id: `skill-listing-${Date.now()}`,
    role: 'user',
    parts: [
      {
        type: 'text',
        text: `<system-reminder>\n${content}\n</system-reminder>`,
      },
    ],
  }
}

/**
 * 注入消息附件
 *
 * @param messages - 原始消息列表
 * @param config - 注入配置
 * @returns 注入结果
 */
export async function injectMessageAttachments(
  messages: UIMessage[],
  config: MessageAttachmentConfig,
): Promise<MessageAttachmentResult> {
  const {
    sessionKey,
    skills,
    contextWindowTokens,
  } = config

  let hasSkillListing = false
  let skillListingCount = 0

  const attachmentMessages: UIMessage[] = []

  // 1. 获取 skill_listing 附件
  const listingAttachment = await getSkillListingAttachment(
    skills,
    sessionKey,
    contextWindowTokens,
  )

  if (listingAttachment) {
    hasSkillListing = true
    skillListingCount = listingAttachment.skillCount
    const content = formatSkillListingMessage(listingAttachment)
    attachmentMessages.push(createSkillListingMessage(content))
  }

  // 2. 将附件消息插入到消息列表开头
  const resultMessages: UIMessage[] = [...attachmentMessages, ...messages]

  return {
    messages: resultMessages,
    hasSkillListing,
    skillListingCount,
  }
}

/**
 * 清除 session 的附件状态
 *
 * 在新对话开始时调用。
 *
 * @param sessionKey - session 唯一标识
 */
export function clearMessageAttachmentState(sessionKey: string): void {
  clearSentSkills(sessionKey)
}

/**
 * 获取用户消息文本
 *
 * 从消息列表中提取最后一条用户消息的文本内容。
 *
 * @param messages - 消息列表
 * @returns 用户消息文本
 */
export function extractUserInput(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUserMessage) return ''

  const textParts = lastUserMessage.parts
    .filter(p => p.type === 'text')
    .map(p => (p as { type: 'text'; text: string }).text)
    .join(' ')

  return textParts
}