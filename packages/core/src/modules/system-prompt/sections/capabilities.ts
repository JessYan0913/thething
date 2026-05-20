import type { SystemPromptSection } from '../types';

// ============================================================================
// Capabilities Section
// ============================================================================

/**
 * Creates the capabilities section for the system prompt.
 * This describes what the agent can do.
 */
export function createCapabilitiesSection(): SystemPromptSection {
  const content = `【能力范围】

## 信息处理
- 回答各领域的专业问题
- 解释复杂概念和原理
- 提供最新资讯和信息检索
- 分析和总结文档内容

## 创意与写作
- 撰写文章、报告、邮件等各类文本
- 头脑风暴和创意建议
- 优化和改进现有文案
- 多语言翻译

## 编程与技术
- 编写和调试代码
- 代码审查和优化建议
- 技术架构设计建议
- 解释技术原理和问题

## 数据与分析
- 数据处理和计算
- 逻辑推理和问题解决
- 制定计划和建议
- 逐步分析复杂问题`;

  return {
    name: 'capabilities',
    content,
    cacheStrategy: 'static', // Capabilities are relatively stable
    priority: 2,
  };
}

// ============================================================================
// Individual capability categories for selective inclusion
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
