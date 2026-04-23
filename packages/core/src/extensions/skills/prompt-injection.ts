/**
 * Skill 提示词注入
 *
 * 注意：此文件中的旧函数已被消息附件系统替代。
 * 新的技能注入方式：
 * - skill_listing: 通过 getSkillListingAttachment 注入
 * - skill_discovery: 通过 getTurnZeroSkillDiscovery 注入
 *
 * 参考：docs/skill-metadata-loading-refactoring-plan.md
 */

import type { Skill } from './types';

/**
 * 格式化完整技能内容
 *
 * 用于技能激活后的完整指令注入（仍可用于子代理等场景）。
 */
export function formatFullSkillContent(skill: Skill): string {
  const toolsText = skill.allowedTools.length > 0 ? `\n  可用工具: ${skill.allowedTools.join(', ')}` : '';

  const modelText = skill.model ? `\n  推荐模型: ${skill.model}` : '';

  const effortText =
    skill.effort !== 'medium' ? `\n  执行深度: ${skill.effort === 'high' ? '深度执行' : '快速执行'}` : '';

  const pathsText = skill.paths.length > 0 ? `\n  适用路径: ${skill.paths.join(', ')}` : '';

  const whenToUseText = skill.whenToUse ? `\n  触发条件: ${skill.whenToUse}` : '';

  return `- **${skill.name}**: ${skill.description}${whenToUseText}${toolsText}${modelText}${effortText}${pathsText}

<技能指令>
${skill.body}
</技能指令>`;
}

/**
 * 格式化多个技能的完整内容
 *
 * 用于需要注入完整技能指令的场景（如子代理）。
 */
export function formatFullSkillsContent(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const skillsList = skills.map((skill) => formatFullSkillContent(skill)).join('\n\n');

  return `## 已激活技能

以下技能已激活，完整指令如下：

${skillsList}`;
}