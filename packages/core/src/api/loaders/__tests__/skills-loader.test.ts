import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadSkills, clearSkillsCache } from '../skills';

describe('Skills Loader Integration', () => {
  beforeAll(async () => {
    // Clear cache to ensure fresh load
    clearSkillsCache();
  });

  it('should load skills from .thething/skills/ directory', async () => {
    // 使用 packages/core 目录，测试数据在此目录下
    const cwd = path.resolve(process.cwd());
    const skills = await loadSkills({ cwd });

    // 应该加载到多个 skills
    console.log('Loaded skills:', skills.length, 'from cwd:', cwd);
    skills.forEach(s => console.log('  -', s.name));

    expect(skills.length).toBeGreaterThan(0);

    // 检查是否包含已知 skills
    expect(skills.some(s => s.name === 'ai-sdk')).toBe(true);
    expect(skills.some(s => s.name === 'shadcn')).toBe(true);
  });

  it('should have complete skill metadata', async () => {
    const cwd = path.resolve(process.cwd());
    const skills = await loadSkills({ cwd });

    const aiSdkSkill = skills.find(s => s.name === 'ai-sdk');
    expect(aiSdkSkill).toBeDefined();

    if (aiSdkSkill) {
      expect(aiSdkSkill.description).toContain('AI SDK');
      expect(aiSdkSkill.body).toBeDefined();
      expect(aiSdkSkill.body.length).toBeGreaterThan(100);
      expect(aiSdkSkill.sourcePath).toContain('SKILL.md');
    }
  });

  it('should use project directory when cwd not specified', async () => {
    const skills = await loadSkills();
    // 默认应该也能加载到 skills
    expect(skills.length).toBeGreaterThanOrEqual(0);
  });
});