import type { SystemPromptSection, ConversationMeta } from '../types';

// ============================================================================
// Session-Level Dynamic Content
// ============================================================================

/**
 * Creates session-level guidance section.
 * 合并环境信息、会话指导、新对话指导为一个section，减少冗余。
 */
export function createSessionGuidanceSection(
  meta: ConversationMeta
): SystemPromptSection {
  const parts: string[] = [];

  // 环境信息
  const now = new Date();
  const iso = now.toISOString();
  const dateStr = iso.slice(0, 10);
  const timeStr = iso.slice(11, 16);
  parts.push(`当前时间：${dateStr} ${timeStr} (UTC)`);

  // 会话来源
  const source = meta.sessionSource ?? 'user';
  const sourceId = meta.sessionSourceId;
  const sourceLabel = source === 'connector'
    ? `connector:${sourceId ?? 'unknown'}`
    : source === 'cron'
      ? 'cron'
      : 'local';
  parts.push(`会话来源：${sourceLabel}`);

  // 对话上下文
  if (meta.isNewConversation) {
    parts.push('这是一个新对话。');
  } else {
    parts.push(`这是第 ${meta.messageCount + 1} 条消息。`);
  }

  const content = `【会话信息】\n\n${parts.join('\n')}`;

  return {
    name: 'session',
    content,
    cacheStrategy: 'dynamic',
    priority: 51,
  };
}

/**
 * Creates a system context section with current date/time and working directory.
 * 保留此函数以备需要单独使用时调用。
 */
export function createSystemContextSection(cwd?: string): SystemPromptSection {
  const now = new Date();
  const iso = now.toISOString();
  const dateStr = iso.slice(0, 10);
  const timeStr = iso.slice(11, 16);

  const parts: string[] = [
    `当前日期时间：${dateStr} ${timeStr} (UTC)`,
  ];

  if (cwd) {
    parts.push(`Primary working directory: ${cwd}`);
    parts.push(`IMPORTANT: Run all bash commands from this directory. Do NOT use /home/sandbox or other Linux paths.`);
  }

  const content = `【环境信息】\n\n${parts.join('\n')}`;

  return {
    name: 'system-context',
    content,
    cacheStrategy: 'dynamic',
    priority: 51,
  };
}

/**
 * Creates a session guidance for first message in a conversation.
 * 保留此函数以备需要单独使用时调用。
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
 */
export const DYNAMIC_BOUNDARY = '__DYNAMIC_CONTENT_BOUNDARY__';

/**
 * Creates the dynamic boundary marker section.
 */
export function createDynamicBoundarySection(): SystemPromptSection {
  return {
    name: 'dynamic-boundary',
    content: DYNAMIC_BOUNDARY,
    cacheStrategy: 'dynamic',
    priority: 50,
  };
}
