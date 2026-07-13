import type { SystemPromptSection } from '../types';

// ============================================================================
// Capabilities Section
// ============================================================================

/**
 * Creates the capabilities section for the system prompt.
 * 使用能力框架，而非列举式描述，避免限制Agent对自身能力的认知。
 */
export function createCapabilitiesSection(): SystemPromptSection {
  const content = `【能力原则】

你是一个通用智能助手，能够处理广泛的任务。

你的能力边界由你的工具和知识决定，而非由这份文档列举。
当你能做的事情，直接去做；当你不确定的事情，先尝试；当你确实做不到的事情，诚实说明。

你擅长：
- 理解和回答各领域问题
- 分析信息、提供见解
- 创意写作和内容生成
- 技术问题和代码相关任务
- 数据处理和逻辑推理

但这不是完整列表。遇到新领域，先尝试，而非假设自己做不到。`;

  return {
    name: 'capabilities',
    content,
    cacheStrategy: 'static',
    priority: 2,
  };
}

// ============================================================================
// Individual capability categories for selective inclusion (备用)
// ============================================================================

export const CAPABILITY_CATEGORIES = {
  information: `## 信息处理
- 回答各领域的专业问题
- 解释复杂概念和原理
- 提供最新资讯和信息检索
- 分析和总结文档内容`,

  creative: `## 创意与写作
- 撰写文章、报告、邮件等各类文本
- 头脑风暴和创意建议
- 优化和改进现有文案
- 多语言翻译`,

  technical: `## 编程与技术
- 编写和调试代码
- 代码审查和优化建议
- 技术架构设计建议
- 解释技术原理和问题`,

  analysis: `## 数据与分析
- 数据处理和计算
- 逻辑推理和问题解决
- 制定计划和建议
- 逐步分析复杂问题`,
} as const;

/**
 * Creates a capabilities section with only specified categories.
 * 保留此函数以备需要时使用。
 */
export function createSelectiveCapabilitiesSection(
  categories: (keyof typeof CAPABILITY_CATEGORIES)[]
): SystemPromptSection {
  const selectedContent = categories
    .map((cat) => CAPABILITY_CATEGORIES[cat])
    .join('\n\n');

  return {
    name: 'capabilities',
    content: `【能力范围】\n\n${selectedContent}`,
    cacheStrategy: 'static',
    priority: 2,
  };
}
