import type { SystemPromptSection, UserPreferences } from '../types';

// ============================================================================
// User Preferences Section
// ============================================================================

/**
 * Creates a system prompt section based on user preferences.
 * Returns null if no preferences are set.
 */
export function createUserPreferencesSection(
  preferences: UserPreferences | null
): SystemPromptSection {
  if (!preferences) {
    return {
      name: 'user-preferences',
      content: null,
      cacheStrategy: 'session',
      priority: 20,
    };
  }

  const parts: string[] = [];

  // Language preference
  if (preferences.language) {
    parts.push(`- 回答语言：${preferences.language}`);
  }

  // Domain preference
  if (preferences.domain) {
    parts.push(`- 专业领域：${preferences.domain}`);
  }

  // Response style preference
  if (preferences.responseStyle) {
    const styleMap = {
      concise: '简洁明了，只提供关键信息',
      detailed: '详细全面，提供深入的解释和分析',
      balanced: '平衡适中，在简洁和详细之间取得平衡',
    };
    parts.push(`- 回答风格：${styleMap[preferences.responseStyle] || preferences.responseStyle}`);
  }

  // Custom system prompt additions
  if (preferences.customSystemPrompt) {
    parts.push(`\n【用户自定义指示】\n${preferences.customSystemPrompt}`);
  }

  const content = parts.length > 0 ? `【用户偏好】\n\n${parts.join('\n')}` : null;

  return {
    name: 'user-preferences',
    content,
    cacheStrategy: 'session', // Changes when user updates preferences
    priority: 20,
  };
}

// ============================================================================
// Response Style Templates
// ============================================================================

/**
 * Response style templates that can be applied based on user preference.
 */
export const RESPONSE_STYLES = {
  concise: `【回答风格要求】
- 简洁明了，直击要点
- 避免冗余和重复
- 使用简短段落
- 必要时使用列表要点`,

  detailed: `【回答风格要求】
- 详细全面，深入分析
- 提供充分的背景和解释
- 包含例子和应用场景
- 结构清晰，层次分明`,

  balanced: `【回答风格要求】
- 适中详略，平衡简洁和完整
- 突出关键信息
- 根据问题复杂度调整深度
- 保持逻辑清晰`,

  technical: `【回答风格要求】
- 使用准确的技术术语
- 提供代码示例（如适用）
- 引用相关文档或资源
- 解释技术细节和原理`,

  educational: `【回答风格要求】
- 解释原理和过程
- 使用类比和实例帮助理解
- 循序渐进，由浅入深
- 鼓励用户举一反三`,
} as const;

/**
 * Creates a response style section based on the specified style.
 */
export function createResponseStyleSection(
  style: keyof typeof RESPONSE_STYLES
): SystemPromptSection {
  return {
    name: 'response-style',
    content: RESPONSE_STYLES[style] || RESPONSE_STYLES.balanced,
    cacheStrategy: 'static', // Style preference is relatively stable
    priority: 15,
  };
}

/**
 * Creates a response style section from a custom style description.
 */
export function createCustomResponseStyleSection(
  customStyle: string
): SystemPromptSection {
  return {
    name: 'response-style',
    content: `【回答风格要求】\n\n${customStyle}`,
    cacheStrategy: 'static',
    priority: 15,
  };
}
