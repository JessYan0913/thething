import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { loadAll, clearAllCache } from '../index';

describe('resource-aware loaders', () => {
  it('loads skills, agents, permissions, and memory from explicit resource dirs', async () => {
    const root = path.join(tmpdir(), `thething-resources-${Date.now()}`);
    const skillsDir = path.join(root, 'custom-skills');
    const agentDir = path.join(root, 'custom-agents');
    const permissionsDir = path.join(root, 'custom-permissions');
    const memoryDir = path.join(root, 'custom-memory');

    await mkdir(path.join(skillsDir, 'custom-skill'), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await mkdir(permissionsDir, { recursive: true });
    await mkdir(memoryDir, { recursive: true });

    await writeFile(
      path.join(skillsDir, 'custom-skill', 'SKILL.md'),
      [
        '---',
        'name: custom-skill',
        'description: Custom skill',
        '---',
        'Skill body',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      path.join(agentDir, 'custom-agent.md'),
      [
        '---',
        'name: custom-agent',
        'description: Custom agent',
        '---',
        'Agent instructions',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      path.join(permissionsDir, 'permissions.json'),
      JSON.stringify({
        version: 1,
        rules: [{
          id: 'allow-read',
          toolName: 'read_file',
          behavior: 'allow',
          createdAt: 1,
        }],
      }),
      'utf-8',
    );
    await writeFile(path.join(memoryDir, 'MEMORY.md'), 'custom memory', 'utf-8');

    clearAllCache();
    const loaded = await loadAll({
      cwd: root,
      resourceDirs: {
        skills: [skillsDir],
        agents: [agentDir],
        mcps: [],
        connectors: [],
        permissions: [permissionsDir],
        memory: [memoryDir],
      },
    });

    expect(loaded.skills.map((s) => s.name)).toContain('custom-skill');
    expect(loaded.agents.map((a) => a.agentType)).toContain('custom-agent');
    expect(loaded.permissions.map((p) => p.id)).toContain('allow-read');
    expect(loaded.memory.map((m) => m.content)).toContain('custom memory');
  });
});
