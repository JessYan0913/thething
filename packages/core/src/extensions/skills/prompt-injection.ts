import type { Skill, SkillMetadata } from './types';

export function injectSkillsIntoPrompt(systemPrompt: string, skills: Skill[], activeSkillNames: Set<string>): string {
  if (skills.length === 0 || activeSkillNames.size === 0) {
    return systemPrompt;
  }

  const activeSkills = skills.filter((s) => activeSkillNames.has(s.name));

  if (activeSkills.length === 0) {
    return systemPrompt;
  }

  const skillsSection = formatSkillsSection(activeSkills);

  return `${systemPrompt}\n\n${skillsSection}`;
}

export function formatSkillMetadataOnly(skills: SkillMetadata[]): string {
  if (skills.length === 0) return '';

  const skillsList = skills
    .map((skill) => formatSkillMetadataSingle(skill))
    .join('\n\n');

  return `## 可用技能

当前已加载 ${skills.length} 个技能，使用时会自动加载完整指令：

${skillsList}`;
}

function formatSkillMetadataSingle(skill: SkillMetadata): string {
  const toolsText = skill.allowedTools.length > 0 ? ` | 可用工具: ${skill.allowedTools.join(', ')}` : '';
  const modelText = skill.model ? ` | 推荐模型: ${skill.model}` : '';
  const pathsText = skill.paths.length > 0 ? ` | 适用路径: ${skill.paths.join(', ')}` : '';
  const whenToUseText = skill.whenToUse ? `\n  触发条件: ${skill.whenToUse}` : '';

  return `- **${skill.name}**: ${skill.description}${whenToUseText}${toolsText}${modelText}${pathsText}`;
}

function formatSkillsSection(skills: Skill[]): string {
  const skillsList = skills.map((skill) => formatSingleSkill(skill)).join('\n\n');

  return `## 已激活技能

以下技能已激活，完整指令如下：

${skillsList}`;
}

function formatSingleSkill(skill: Skill): string {
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

export function determineActiveSkills(skills: SkillMetadata[], userMessage: string): Set<string> {
  const active = new Set<string>();
  const message = userMessage.toLowerCase();

  for (const skill of skills) {
    if (!skill.whenToUse) continue;

    const triggers = skill.whenToUse.toLowerCase();

    const keywords = extractKeywords(triggers);

    for (const keyword of keywords) {
      if (message.includes(keyword)) {
        active.add(skill.name);
        break;
      }
    }
  }

  return active;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    '的',
    '了',
    '是',
    '在',
    '我',
    '有',
    '和',
    '就',
    '不',
    '人',
    '都',
    '一',
    '一个',
    '上',
    '也',
    '很',
    '到',
    '说',
    '要',
    '去',
    '你',
    '会',
    '着',
    '没有',
    '看',
    '好',
    '自己',
    '这',
    '那',
    '啊',
    '呢',
    '吧',
    '吗',
    '可以',
    '进行',
    '提供',
    '支持',
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'and',
    'or',
    'but',
    'if',
    'then',
    'than',
    'so',
    'that',
    'this',
    'these',
    'those',
  ]);

  const raw = text.split(/[,，.。;；\s]+/);

  return raw.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 1 && !stopWords.has(w));
}