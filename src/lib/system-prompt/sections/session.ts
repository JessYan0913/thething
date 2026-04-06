import type { SystemPromptSection, ConversationMeta } from '../types';

// ============================================================================
// Session-Level Dynamic Content
// ============================================================================

/**
 * Creates session-level guidance section.
 * This content is dynamic and changes per conversation/session.
 */
export function createSessionGuidanceSection(
  meta: ConversationMeta
): SystemPromptSection {
  const parts: string[] = [];

  // Add conversation context
  if (meta.isNewConversation) {
    parts.push('这是一个新的对话。请花些时间了解用户的需求。');
  } else {
    parts.push(`这是对话中的第 ${meta.messageCount + 1} 条消息。请基于之前的上下文继续对话。`);
  }

  // Add time-based guidance if applicable
  const hour = new Date().getHours();
  if (hour < 6) {
    parts.push('现在是深夜时分，请注意简洁高效。');
  } else if (hour < 9) {
    parts.push('现在是早晨时分。');
  } else if (hour < 12) {
    parts.push('现在是上午时分。');
  } else if (hour < 14) {
    parts.push('现在是中午时分。');
  } else if (hour < 18) {
    parts.push('现在是下午时分。');
  } else if (hour < 22) {
    parts.push('现在是晚间时分。');
  } else {
    parts.push('现在是深夜时分。');
  }

  const content = `【会话指导】\n\n${parts.join('\n')}`;

  return {
    name: 'session-guidance',
    content,
    cacheStrategy: 'dynamic', // Changes every message
    priority: 100, // Highest priority number = comes last
  };
}

/**
 * Creates a session guidance for first message in a conversation.
 */
export function createFirstMessageGuidance(): SystemPromptSection {
  const content = `【新对话指导】

这是一个新的对话的开始。请：
1. 友好地问候用户
2. 简要介绍你的能力范围
3. 询问用户需要什么帮助
4. 保持简洁，不要一次说太多`;

  return {
    name: 'first-message-guidance',
    content,
    cacheStrategy: 'dynamic',
    priority: 99,
  };
}

// ============================================================================
// Dynamic Boundary Marker
// ============================================================================

/**
 * Boundary marker separating static sections from dynamic sections.
 * This is inspired by Claude Code's SYSTEM_PROMPT_DYNAMIC_BOUNDARY.
 *
 * When the API/provider supports prompt caching, content before this
 * boundary can be cached globally, while content after must be
 * recalculated per session/conversation.
 */
export const DYNAMIC_BOUNDARY = '__DYNAMIC_CONTENT_BOUNDARY__';

/**
 * Creates the dynamic boundary marker section.
 * This allows providers with caching support to identify cacheable content.
 */
export function createDynamicBoundarySection(): SystemPromptSection {
  return {
    name: 'dynamic-boundary',
    content: DYNAMIC_BOUNDARY,
    cacheStrategy: 'dynamic',
    priority: 50, // Middle priority - splits static and dynamic
  };
}
