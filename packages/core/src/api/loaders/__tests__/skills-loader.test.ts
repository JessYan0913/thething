import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { loadSkills, clearSkillsCache } from '../skills';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../../config/defaults';

async function createTempSkillProject(): Promise<{ root: string; skillDir: string }> {
  const root = path.join(tmpdir(), `thething-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const skillDir = path.join(root, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'skills');
  const aiSdkDir = path.join(skillDir, 'ai-sdk');
  const shadcnDir = path.join(skillDir, 'shadcn');

  await mkdir(aiSdkDir, { recursive: true });
  await mkdir(shadcnDir, { recursive: true });
  await writeFile(path.join(aiSdkDir, 'SKILL.md'), `---
name: ai-sdk
description: AI SDK integration guide
allowedTools:
  - read_file
effort: medium
context: inline
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
    clearSkillsCache();
    if (root) {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      root = undefined;
    }
  });

  it(`loads skills from ${DEFAULT_PROJECT_CONFIG_DIR_NAME}/skills/ when explicit layout dirs are provided`, async () => {
    const project = await createTempSkillProject();
    root = project.root;

    const skills = await loadSkills({ cwd: root, dirs: [project.skillDir] });

    expect(skills.length).toBe(2);
    expect(skills.some(skill => skill.name === 'ai-sdk')).toBe(true);
    expect(skills.some(skill => skill.name === 'shadcn')).toBe(true);
  });

  it('returns complete skill metadata from parsed frontmatter and body', async () => {
    const project = await createTempSkillProject();
    root = project.root;

    const skills = await loadSkills({ cwd: root, dirs: [project.skillDir] });
    const aiSdkSkill = skills.find(skill => skill.name === 'ai-sdk');

    expect(aiSdkSkill).toBeDefined();
    expect(aiSdkSkill?.description).toContain('AI SDK');
    expect(aiSdkSkill?.body.length).toBeGreaterThan(20);
    expect(aiSdkSkill?.sourcePath).toContain('SKILL.md');
  });

  it('uses process.cwd() when cwd is omitted', async () => {
    const skills = await loadSkills();
    expect(Array.isArray(skills)).toBe(true);
  });
});
