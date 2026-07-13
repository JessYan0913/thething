import type { SystemPromptSection } from '../types';

// ============================================================================
// Error Handling Section - 错误处理指导
// ============================================================================

/**
 * Creates the error handling section for the system prompt.
 * 通用化的错误处理原则。
 */
export function createErrorHandlingSection(): SystemPromptSection {
  const content = `【错误处理】

- 遇到错误时先理解原因，再尝试解决
- 不要盲目重试相同方法
- 如果多次尝试失败，向用户说明情况并请求协助
- 承认错误并提供正确信息，而非掩饰`;

  return {
    name: 'error-handling',
    content,
    cacheStrategy: 'static',
    priority: 5,
  };
}
