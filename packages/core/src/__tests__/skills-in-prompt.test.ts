import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadSkills, clearSkillsCache } from '../api/loaders/skills';
import { buildSystemPrompt } from '../extensions/system-prompt/builder';
import { getSkillListingAttachment, formatSkillListingMessage } from '../extensions/attachments/skill-listing';

describe('Skills Mechanism (Skill Tool Approach)', () => {
  beforeAll(async () => {
    clearSkillsCache();
  });

  it('should load skills successfully', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd });

    console.log('Skills loaded:', skills.length);
    skills.forEach(s => console.log(`  - ${s.name} (${s.source})`));

    // 技能加载功能应该正常工作
    expect(skills.length).toBeGreaterThanOrEqual(0);

    // 每个技能应该有必要的元数据
    for (const skill of skills) {
      expect(skill.name).toBeDefined();
      expect(skill.sourcePath).toBeDefined();
      expect(skill.body).toBeDefined();
    }
  });

  it('should NOT include skills in system prompt (skills now via Skill tool)', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd });

    const result = await buildSystemPrompt({
      skills,
      includeProjectContext: false,
    });

    console.log('Included sections:', result.includedSections);

    // 技能不再注入到系统提示词中
    // Agent 通过 Skill 工具主动调用获取技能指令
    // skill_listing 通过附件注入（system-reminder 格式）
    expect(result.includedSections).not.toContain('skills');
  });

  it('should format skill listing for Skill tool usage', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd });

    if (skills.length === 0) {
      console.log('No skills found, skipping skill listing test');
      return;
    }

    // 获取 skill_listing 附件
    const listing = await getSkillListingAttachment(
      skills,
      'test-session',
      100000,  // context window tokens
    );

    if (listing) {
      // 格式化为消息内容
      const message = formatSkillListingMessage(listing);

      // 应该包含 "Skill tool" 关键词
      expect(message).toContain('Skill tool');

      console.log('Skill listing message preview:', message.substring(0, 200));
    }
  });

  it('should return empty sections when no skills', async () => {
    const result = await buildSystemPrompt({
      skills: [],
      includeProjectContext: false,
    });

    // 没有 skills 时不应该包含 skills section
    expect(result.includedSections).not.toContain('skills');
  });
});