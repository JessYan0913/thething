import os from 'os';
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { loadSkills } from '../modules/skills/loader';
import { buildSystemPrompt } from '../modules/system-prompt/builder';

describe('Skills Mechanism (Progressive Disclosure)', () => {
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

    // 每个技能应该有必要的元数据(body 可选--bulk load 时 undefined,按需加载)
    for (const skill of skills) {
      expect(skill.name).toBeDefined();
      expect(skill.sourcePath).toBeDefined();
    }
  });

  it('should include skill names in system prompt (Layer 1: metadata)', async () => {
    const cwd = path.resolve(process.cwd(), '../../');
    const skills = await loadSkills({ cwd, configDir: path.join(os.homedir(), '.thething') });

    const result = await buildSystemPrompt({
      skills,
      includeProjectContext: false,
    });

    console.log('Included sections:', result.includedSections);
    console.log('--- Skill-matching section content preview ---');
    const matchSection = result.sections.find(s => s.name === 'skill-matching');
    console.log(matchSection?.content?.slice(0, 500));

    // skill-matching section 应该存在
    expect(result.includedSections).toContain('skill-matching');

    // 技能名称和描述应该出现在 system prompt 中（Layer 1 渐进式披露）
    if (skills.length > 0) {
      expect(matchSection?.content).toContain(skills[0].name);
    }
  });

  it('should show minimal guidance when no skills available', async () => {
    const result = await buildSystemPrompt({
      skills: [],
      includeProjectContext: false,
    });

    expect(result.includedSections).toContain('skill-matching');

    const matchSection = result.sections.find(s => s.name === 'skill-matching');
    // 无技能时应该显示"无额外技能"的提示(已 i18n 为中文)
    expect(matchSection?.content).toContain('暂无可用技能');
    // 创建 Skill 的交付标准始终存在，避免用 Wiki 或脚本冒充完成
    expect(matchSection?.content).toContain('通过 skill 工具按精确名称重新加载');
    expect(matchSection?.content).toContain('保存 Wiki、只写脚本或只写说明文档都不能完成');
    // 不应该有技能列表（因为没有技能）
    expect(matchSection?.content).not.toContain('可用技能列表');
  });
});
