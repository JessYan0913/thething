import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadSkills, clearSkillsCache } from '../loaders/skills';
import { buildSystemPrompt } from '../system-prompt/builder';

describe('Skills in System Prompt Integration', () => {
  beforeAll(async () => {
    clearSkillsCache();
  });

  it('should include skills metadata in system prompt', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd });

    console.log('Skills loaded:', skills.length);

    const result = await buildSystemPrompt({
      skills,
      includeProjectContext: false,
    });

    console.log('System prompt length:', result.prompt.length);
    console.log('Included sections:', result.includedSections);

    // 检查是否包含 skills section
    expect(result.includedSections).toContain('skills');

    // 检查系统提示词中是否包含 skills 内容
    if (skills.length > 0) {
      expect(result.prompt).toContain('## 可用技能');
      // 检查是否包含每个 skill 的名称和源文件路径
      for (const skill of skills.slice(0, 3)) {
        expect(result.prompt).toContain(`### ${skill.name}`);
        expect(result.prompt).toContain(`源文件: ${skill.sourcePath}`);
        console.log(`  Found skill '${skill.name}' with sourcePath '${skill.sourcePath}'`);
      }
    }
  });

  it('should return null section when no skills', async () => {
    const result = await buildSystemPrompt({
      skills: [], // 空 skills
      includeProjectContext: false,
    });

    // 应该不包含 skills section
    expect(result.includedSections).not.toContain('skills');
  });
});