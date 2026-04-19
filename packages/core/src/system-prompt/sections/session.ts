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

  const content = `【会话指导】\n\n${parts.join('\n')}`;

  return {
    name: 'session-guidance',
    content,
    cacheStrategy: 'dynamic', // Changes every message
    priority: 100, // Highest priority number = comes last
  };
}

/**
 * Creates a system context section with current date/time.
 * Always injected so the model always knows what time it is.
 */
export function createSystemContextSection(): SystemPromptSection {
  const now = new Date();
  const iso = now.toISOString(); // Always UTC, e.g. "2026-04-07T12:02:00.000Z"
  const dateStr = iso.slice(0, 10);  // YYYY-MM-DD
  const timeStr = iso.slice(11, 16); // HH:mm

  const content = `当前日期时间：${dateStr} ${timeStr} (UTC)`;

  return {
    name: 'system-context',
    content,
    cacheStrategy: 'dynamic', // Changes per request
    priority: 51, // Just after dynamic boundary (50), before project-context (60)
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
