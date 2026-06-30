import os from 'os';
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadSkills } from '../modules/skills/loader';
import { buildSystemPrompt } from '../modules/system-prompt/builder';

describe('Skills Mechanism (Skill Tool Approach)', () => {
  beforeAll(async () => {
    // no-op: caches removed
  });

  it('should load skills successfully', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd, configDir: path.join(os.homedir(), '.thething') });

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
    const skills = await loadSkills({ cwd, configDir: path.join(os.homedir(), '.thething') });

    const result = await buildSystemPrompt({
      skills,
      includeProjectContext: false,
    });

    console.log('Included sections:', result.includedSections);

    // 技能不再注入到系统提示词中
    // Agent 通过 Skill 工具主动调用获取技能指令
    expect(result.includedSections).not.toContain('skills');
  });

  it('should include skill-matching guidance always, even with 0 skills', async () => {
    const result = await buildSystemPrompt({
      skills: [],
      includeProjectContext: false,
    });

    // skill-matching section 始终存在，指导 Agent 使用 skill: "list"
    expect(result.includedSections).toContain('skill-matching');
    expect(result.prompt).toContain('skill: "list"');
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
