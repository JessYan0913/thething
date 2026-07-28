import os from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { loadSkills } from '../../../modules/skills/loader';
import { readSkillBody } from '../../../modules/skills/loader';

async function createTempSkillProject(): Promise<{ root: string; skillDir: string }> {
  const root = path.join(os.tmpdir(), `thething-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const skillDir = path.join(root, '.thething', 'skills');
  const aiSdkDir = path.join(skillDir, 'ai-sdk');
  const shadcnDir = path.join(skillDir, 'shadcn');

  await mkdir(aiSdkDir, { recursive: true });
  await mkdir(shadcnDir, { recursive: true });
  await writeFile(path.join(aiSdkDir, 'SKILL.md'), `---
name: ai-sdk
description: AI SDK integration guide
allowedTools:
  - read_file
effort: max
context: fork
agent: general-purpose
background: false
---
Use the AI SDK to build chat, tools, and structured generation features.
`, 'utf-8');
  await writeFile(path.join(shadcnDir, 'SKILL.md'), `---
name: shadcn
description: shadcn component guide
allowedTools:
  - read_file
  - edit_file
effort: medium
context: inline
---
Use shadcn components and patterns in a consistent way.
`, 'utf-8');

  return { root, skillDir };
}

describe('Skills Loader Integration', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      root = undefined;
    }
  });

  it('loads skills from .thething/skills/ when explicit layout dirs are provided', async () => {
    const project = await createTempSkillProject();
    root = project.root;

    const skills = await loadSkills({ cwd: root, configDir: path.join(os.homedir(), '.thething'), dirs: [project.skillDir] });

    // 显式 dirs = 只加载文件级 skill(resource-dirs 隔离契约,不混入 bundled)
    expect(skills.length).toBe(2);
    expect(skills.some(skill => skill.name === 'ai-sdk')).toBe(true);
    expect(skills.some(skill => skill.name === 'shadcn')).toBe(true);
  });

  it('returns complete skill metadata from parsed frontmatter and body', async () => {
    const project = await createTempSkillProject();
    root = project.root;

    const skills = await loadSkills({ cwd: root, configDir: path.join(os.homedir(), '.thething'), dirs: [project.skillDir] });
    const aiSdkSkill = skills.find(skill => skill.name === 'ai-sdk');

    expect(aiSdkSkill).toBeDefined();
    expect(aiSdkSkill?.description).toContain('AI SDK');
    expect(aiSdkSkill).toMatchObject({
      effort: 'max',
      context: 'fork',
      agent: 'general-purpose',
      background: false,
    });
    // 两阶段加载：body 在 bulk load 时为空，通过 readSkillBody 按需读取
    expect(aiSdkSkill?.body).toBeUndefined();
    const loadedBody = aiSdkSkill?.sourcePath ? await readSkillBody(aiSdkSkill.sourcePath) : '';
    expect(loadedBody.length).toBeGreaterThan(20);
    expect(loadedBody).toContain('Use the AI SDK');
    expect(aiSdkSkill?.sourcePath).toContain('SKILL.md');
  });

  it('uses standard name instead of the legacy id extension', async () => {
    const project = await createTempSkillProject();
    root = project.root;
    await writeFile(path.join(project.skillDir, 'ai-sdk', 'SKILL.md'), `---
id: legacy-ai-sdk
name: ai-sdk
description: AI SDK integration guide
---
Use the AI SDK.
`, 'utf-8');

    const skills = await loadSkills({ cwd: root, configDir: path.join(os.homedir(), '.thething'), dirs: [project.skillDir] });

    expect(skills.some(skill => skill.name === 'ai-sdk')).toBe(true);
    expect(skills.some(skill => skill.name === 'legacy-ai-sdk')).toBe(false);
  });

  it('ignores lowercase skill.md compatibility files', async () => {
    const project = await createTempSkillProject();
    root = project.root;
    const legacyDir = path.join(project.skillDir, 'legacy-skill');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'skill.md'), `---
name: legacy-skill
description: Legacy lowercase skill file
---
Legacy body.
`, 'utf-8');

    const skills = await loadSkills({ cwd: root, configDir: path.join(os.homedir(), '.thething'), dirs: [project.skillDir] });

    expect(skills.some(skill => skill.name === 'legacy-skill')).toBe(false);
  });

  it('uses process.cwd() when cwd is omitted', async () => {
    const skills = await loadSkills({ configDir: path.join(os.homedir(), '.thething') });
    expect(Array.isArray(skills)).toBe(true);
  });
});
