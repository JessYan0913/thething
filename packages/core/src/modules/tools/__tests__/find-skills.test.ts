import { describe, expect, it } from 'vitest';
import type { Skill } from '../../skills/types';
import { createFindSkillsTool } from '../find-skills';
import { createSkillTool } from '../skill';

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] });
}

function makeSkill(name: string, overrides?: Partial<Skill>): Skill {
  return {
    name,
    description: `${name} description`,
    whenToUse: `when working with ${name}`,
    sourcePath: '',
    source: 'user',
    body: `Instructions for ${name}`,
    ...overrides,
  };
}

describe('find_skills tool', () => {
  const skills = [
    makeSkill('docx', { description: 'Create and edit Word documents' }),
    makeSkill('pdf', { description: 'PDF manipulation toolkit' }),
    makeSkill('pdf-forms', { description: 'Fill PDF forms' }),
    makeSkill('video-editor', { description: 'Edit videos', whenToUse: 'when the user wants to cut a video' }),
  ];

  it('matches by name substring with highest rank', async () => {
    const tool = createFindSkillsTool({ skills });
    const result = await execute(tool, { query: 'pdf' });
    expect(result.results[0].name).toBe('pdf');
    expect(result.results.map((r: any) => r.name)).toContain('pdf-forms');
  });

  it('matches by description and whenToUse, case-insensitive', async () => {
    const tool = createFindSkillsTool({ skills });
    const result = await execute(tool, { query: 'Cut A Video' });
    expect(result.results.map((r: any) => r.name)).toContain('video-editor');
  });

  it('returns empty results for no match', async () => {
    const tool = createFindSkillsTool({ skills });
    const result = await execute(tool, { query: 'quantum-chemistry' });
    expect(result.totalMatches).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const many = Array.from({ length: 20 }, (_, i) => makeSkill(`pdf-tool-${i}`));
    const tool = createFindSkillsTool({ skills: many });
    const result = await execute(tool, { query: 'pdf', limit: 3 });
    expect(result.results).toHaveLength(3);
    expect(result.totalMatches).toBe(20);
  });

  it('excludes disabled skills from results', async () => {
    const tool = createFindSkillsTool({ skills, disabledSkills: ['pdf'] });
    const result = await execute(tool, { query: 'pdf' });
    expect(result.results.map((r: any) => r.name)).not.toContain('pdf');
    expect(result.results.map((r: any) => r.name)).toContain('pdf-forms');
  });

  it('prefers reloaded skills over the snapshot', async () => {
    const tool = createFindSkillsTool({
      skills,
      reloadSkills: async () => [makeSkill('fresh-skill', { description: 'brand new pdf helper' })],
    });
    const result = await execute(tool, { query: 'pdf' });
    expect(result.results.map((r: any) => r.name)).toEqual(['fresh-skill']);
  });

  it('falls back to the snapshot when reload fails', async () => {
    const tool = createFindSkillsTool({
      skills,
      reloadSkills: async () => { throw new Error('disk error'); },
    });
    const result = await execute(tool, { query: 'docx' });
    expect(result.results.map((r: any) => r.name)).toContain('docx');
  });
});

describe('skill tool disabled rejection', () => {
  it('rejects a disabled skill on snapshot hit', async () => {
    const tool = createSkillTool({
      skills: [makeSkill('banned')],
      disabledSkills: ['banned'],
    });
    const result = await execute(tool, { skill: 'banned' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
    expect(result.error).toContain('preferences.json');
  });

  it('rejects a disabled skill even when reload would find it', async () => {
    const tool = createSkillTool({
      skills: [],
      reloadSkills: async () => [makeSkill('banned')],
      disabledSkills: ['banned'],
    });
    const result = await execute(tool, { skill: 'banned' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('still loads non-disabled skills normally', async () => {
    const tool = createSkillTool({
      skills: [makeSkill('allowed')],
      disabledSkills: ['banned'],
    });
    const result = await execute(tool, { skill: 'allowed' });
    expect(result.success).toBe(true);
  });
});
