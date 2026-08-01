import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill } from '../types';
import {
  DEFAULT_RESIDENT_LIMIT,
  MAX_RESIDENT_ENTRY_CHARS,
  selectResidentSet,
  formatResidentSections,
  getSessionSkillResidentSet,
  clearSessionSkillResidentSetCache,
} from '../resident-set';
import { loadSkillPreferences, EMPTY_SKILL_PREFERENCES } from '../preferences';
import { loadSkillUsage, recordSkillUsage, usageScore } from '../usage';

function makeSkill(name: string, overrides?: Partial<Skill>): Skill {
  return {
    name,
    description: `${name} description with trigger words`,
    whenToUse: `when the user asks about ${name}`,
    sourcePath: `/skills/${name}/SKILL.md`,
    source: 'user',
    ...overrides,
  };
}

const NOW = 1_750_000_000_000;

// ============================================================
// selectResidentSet
// ============================================================
describe('selectResidentSet', () => {
  it('keeps all skills resident when under the limit', () => {
    const skills = [makeSkill('a'), makeSkill('b')];
    const result = selectResidentSet(skills, { now: NOW });
    expect(result.resident.map(s => s.name)).toEqual(['a', 'b']);
    expect(result.catalog).toEqual([]);
  });

  it('caps resident set at the limit and moves the rest to catalog', () => {
    const skills = Array.from({ length: 50 }, (_, i) =>
      makeSkill(`skill-${String(i).padStart(2, '0')}`));
    const result = selectResidentSet(skills, { now: NOW });
    expect(result.resident).toHaveLength(DEFAULT_RESIDENT_LIMIT);
    expect(result.catalog).toHaveLength(10);
  });

  it('ranks by priority tier: builtin > pinned > project > rest', () => {
    const skills = [
      makeSkill('zz-user'),
      makeSkill('m-project', { source: 'project' }),
      makeSkill('x-pinned'),
      makeSkill('z-builtin', { source: 'builtin' }),
    ];
    const result = selectResidentSet(skills, {
      limit: 4,
      preferences: { pinned: ['x-pinned'], disabled: [] },
      now: NOW,
    });
    expect(result.resident.map(s => s.name)).toEqual([
      'z-builtin', 'x-pinned', 'm-project', 'zz-user',
    ]);
  });

  it('puts agent-bound skills above builtin', () => {
    const skills = [
      makeSkill('z-builtin', { source: 'builtin' }),
      makeSkill('a-bound'),
    ];
    const result = selectResidentSet(skills, {
      agentBoundSkills: ['a-bound'],
      now: NOW,
    });
    expect(result.resident[0].name).toBe('a-bound');
  });

  it('ranks same-tier skills by usage score, then name', () => {
    const skills = [makeSkill('cold'), makeSkill('hot'), makeSkill('warm')];
    const result = selectResidentSet(skills, {
      usage: {
        hot: { count: 10, lastUsedAt: NOW },
        warm: { count: 2, lastUsedAt: NOW },
      },
      now: NOW,
    });
    expect(result.resident.map(s => s.name)).toEqual(['hot', 'warm', 'cold']);
  });

  it('is deterministic: same input yields identical output', () => {
    const skills = Array.from({ length: 60 }, (_, i) => makeSkill(`s-${i}`));
    const opts = {
      usage: { 's-42': { count: 3, lastUsedAt: NOW } },
      now: NOW,
    };
    const a = selectResidentSet(skills, opts);
    const b = selectResidentSet(skills, opts);
    expect(a).toEqual(b);
  });

  it('excludes disabled skills from both resident and catalog', () => {
    const skills = Array.from({ length: 45 }, (_, i) => makeSkill(`s-${String(i).padStart(2, '0')}`));
    const result = selectResidentSet(skills, {
      preferences: { pinned: [], disabled: ['s-00', 's-44'] },
      now: NOW,
    });
    const allNames = [...result.resident, ...result.catalog].map(s => s.name);
    expect(allNames).not.toContain('s-00');
    expect(allNames).not.toContain('s-44');
    expect(allNames).toHaveLength(43);
  });
});

// ============================================================
// formatResidentSections
// ============================================================
describe('formatResidentSections', () => {
  it('renders resident entries with description and whenToUse, no sourcePath', () => {
    const result = selectResidentSet([makeSkill('alpha')], { now: NOW });
    const text = formatResidentSections(result);
    expect(text).toContain('- alpha: alpha description with trigger words - when the user asks about alpha');
    expect(text).not.toContain('/skills/alpha');
  });

  it('renders catalog as names only with find_skills guidance', () => {
    const skills = Array.from({ length: 42 }, (_, i) => makeSkill(`s-${String(i).padStart(2, '0')}`));
    const result = selectResidentSet(skills, { now: NOW });
    const text = formatResidentSections(result);
    expect(text).toContain('其他可用技能');
    expect(text).toContain('find_skills');
    // catalog 条目只有名字，没有描述
    const catalogName = result.catalog[0].name;
    expect(text).toContain(catalogName);
    expect(text).not.toContain(`- ${catalogName}:`);
  });

  it('truncates long user-skill entries at MAX_RESIDENT_ENTRY_CHARS', () => {
    const longDesc = 'x'.repeat(600);
    const result = selectResidentSet(
      [makeSkill('long-skill', { description: longDesc, whenToUse: undefined })],
      { now: NOW },
    );
    const text = formatResidentSections(result);
    const line = text.split('\n').find(l => l.startsWith('- long-skill:'))!;
    expect(line.length).toBeLessThanOrEqual('- long-skill: '.length + MAX_RESIDENT_ENTRY_CHARS);
    expect(line).toContain('…');
  });

  it('does not truncate builtin or pinned entries', () => {
    const longDesc = 'y'.repeat(600);
    const skills = [
      makeSkill('big-builtin', { source: 'builtin', description: longDesc, whenToUse: undefined }),
      makeSkill('big-pinned', { description: longDesc, whenToUse: undefined }),
    ];
    const prefs = { pinned: ['big-pinned'], disabled: [] };
    const result = selectResidentSet(skills, { preferences: prefs, now: NOW });
    const text = formatResidentSections(result, prefs);
    expect(text).toContain(`- big-builtin: ${longDesc}`);
    expect(text).toContain(`- big-pinned: ${longDesc}`);
  });

  it('keeps outputs paths info on resident entries', () => {
    const result = selectResidentSet(
      [makeSkill('with-paths', { paths: ['out/'] })],
      { now: NOW },
    );
    expect(formatResidentSections(result)).toContain('(outputs: out/)');
  });
});

// ============================================================
// getSessionSkillResidentSet
// ============================================================
describe('getSessionSkillResidentSet', () => {
  beforeEach(() => clearSessionSkillResidentSetCache());
  afterEach(() => clearSessionSkillResidentSetCache());

  it('computes once per conversation and returns the cached result after', () => {
    let calls = 0;
    const compute = () => {
      calls += 1;
      return selectResidentSet([makeSkill(`v${calls}`)], { now: NOW });
    };
    const first = getSessionSkillResidentSet('conv-1', compute);
    const second = getSessionSkillResidentSet('conv-1', compute);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('computes separately for different conversations', () => {
    let calls = 0;
    const compute = () => {
      calls += 1;
      return selectResidentSet([], { now: NOW });
    };
    getSessionSkillResidentSet('conv-a', compute);
    getSessionSkillResidentSet('conv-b', compute);
    expect(calls).toBe(2);
  });
});

// ============================================================
// preferences
// ============================================================
describe('loadSkillPreferences', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'skill-prefs-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns empty defaults when the file is missing', async () => {
    expect(await loadSkillPreferences(dir)).toEqual(EMPTY_SKILL_PREFERENCES);
  });

  it('returns empty defaults when the skills key is missing', async () => {
    await writeFile(path.join(dir, 'preferences.json'), JSON.stringify({ selectedModel: 'default' }));
    expect(await loadSkillPreferences(dir)).toEqual(EMPTY_SKILL_PREFERENCES);
  });

  it('reads pinned and disabled lists', async () => {
    await writeFile(path.join(dir, 'preferences.json'), JSON.stringify({
      selectedModel: 'default',
      skills: { pinned: ['a'], disabled: ['b', 'c'] },
    }));
    expect(await loadSkillPreferences(dir)).toEqual({ pinned: ['a'], disabled: ['b', 'c'] });
  });

  it('tolerates corrupt JSON and malformed values', async () => {
    await writeFile(path.join(dir, 'preferences.json'), '{oops');
    expect(await loadSkillPreferences(dir)).toEqual(EMPTY_SKILL_PREFERENCES);

    await writeFile(path.join(dir, 'preferences.json'), JSON.stringify({
      skills: { pinned: 'not-array', disabled: [1, 'ok', null] },
    }));
    expect(await loadSkillPreferences(dir)).toEqual({ pinned: [], disabled: ['ok'] });
  });
});

// ============================================================
// usage
// ============================================================
describe('skill usage', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'skill-usage-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns empty map when the file is missing', async () => {
    expect(await loadSkillUsage(dir)).toEqual({});
  });

  it('records and accumulates usage', async () => {
    await recordSkillUsage(dir, 'docx');
    await recordSkillUsage(dir, 'docx');
    await recordSkillUsage(dir, 'pdf');
    const usage = await loadSkillUsage(dir);
    expect(usage.docx.count).toBe(2);
    expect(usage.pdf.count).toBe(1);
    expect(usage.docx.lastUsedAt).toBeGreaterThan(0);
    // 文件确实落盘且是合法 JSON
    const raw = JSON.parse(await readFile(path.join(dir, 'skill-usage.json'), 'utf-8'));
    expect(raw.docx.count).toBe(2);
  });

  it('does not throw when the data dir is not writable', async () => {
    await expect(recordSkillUsage('/nonexistent-root-path/nope', 'docx')).resolves.toBeUndefined();
  });

  it('drops malformed entries on load', async () => {
    await writeFile(path.join(dir, 'skill-usage.json'), JSON.stringify({
      good: { count: 1, lastUsedAt: NOW },
      bad: { count: 'x' },
      worse: null,
    }));
    expect(await loadSkillUsage(dir)).toEqual({ good: { count: 1, lastUsedAt: NOW } });
  });

  it('decays usage score by half every 14 days', () => {
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const fresh = usageScore({ count: 8, lastUsedAt: NOW }, NOW);
    const aged = usageScore({ count: 8, lastUsedAt: NOW - fourteenDays }, NOW);
    expect(fresh).toBe(8);
    expect(aged).toBeCloseTo(4);
    expect(usageScore(undefined, NOW)).toBe(0);
  });
});
