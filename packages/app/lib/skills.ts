import { getServerRuntime } from '@/lib/runtime';
import { loadSkills, type Skill } from '@the-thing/core';
import path from 'path';

export interface ResolvedSkill {
  skill: Skill;
  folderName: string;
  /** 技能所在磁盘目录；内联 bundled skill（sourcePath 为 builtin:xxx）为 null */
  dir: string | null;
}

export async function loadAllSkills(): Promise<ResolvedSkill[]> {
  const rt = await getServerRuntime();
  const skills = await loadSkills({
    configDir: rt.layout.configDir,
    cwd: process.cwd(),
    dirs: rt.layout.resources.skills,
  });
  return skills.map((skill) => {
    const isInline = skill.sourcePath.startsWith('builtin:');
    return {
      skill,
      folderName: isInline ? skill.name : path.basename(path.dirname(skill.sourcePath)),
      dir: isInline ? null : path.dirname(skill.sourcePath),
    };
  });
}

export async function resolveSkillByFolderName(folderName: string): Promise<ResolvedSkill | null> {
  const all = await loadAllSkills();
  return all.find((s) => s.folderName === folderName) ?? null;
}

/** 为内联 bundled skill 合成一份只读的 SKILL.md 内容 */
export function synthesizeSkillMd(skill: Skill): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.whenToUse) lines.push(`whenToUse: ${skill.whenToUse}`);
  if (skill.allowedTools?.length) {
    lines.push('allowedTools:');
    for (const tool of skill.allowedTools) lines.push(`  - ${tool}`);
  }
  if (skill.context) lines.push(`context: ${skill.context}`);
  if (skill.effort) lines.push(`effort: ${skill.effort}`);
  lines.push('---', '', skill.body ?? '');
  return lines.join('\n');
}
