// ============================================================
// Resource Dirs Verification Test
// ============================================================
//
// 验收清单覆盖：
// 1. layout.resources 各字段能影响对应加载路径
// 2. loadAll() 不再依赖隐式默认扫描来补齐已声明目录
// 3. sourcePath/filePath 能反映真实加载路径
// 4. 默认行为在未传自定义目录时保持兼容

import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  loadAll,
  clearAllCache,
  loadSkills,
  loadAgents,
  loadMcpServers,
  loadConnectors,
  loadPermissions,
  loadMemory,
} from '../index';

// ============================================================
// Test Helpers
// ============================================================

let testRoot: string;

async function setupTestDir(): Promise<string> {
  testRoot = path.join(tmpdir(), `thething-resource-test-${Date.now()}`);
  await mkdir(testRoot, { recursive: true });
  return testRoot;
}

async function cleanupTestDir(): Promise<void> {
  if (testRoot) {
    await rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function createSkillFile(dir: string, name: string, description: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  await writeFile(filePath, [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    `Skill body for ${name}`,
  ].join('\n'), 'utf-8');
  return filePath;
}

async function createAgentFile(dir: string, name: string, description: string): Promise<string> {
  const filePath = path.join(dir, `${name}.md`);
  await writeFile(filePath, [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    `Instructions for ${name}`,
  ].join('\n'), 'utf-8');
  return filePath;
}

async function createMcpJson(dir: string, name: string, command: string): Promise<string> {
  const filePath = path.join(dir, `${name}.json`);
  await writeFile(filePath, JSON.stringify({
    name,
    transport: { type: 'stdio', command },
    enabled: true,
  }), 'utf-8');
  return filePath;
}

async function createConnectorYaml(dir: string, id: string, name: string): Promise<string> {
  const filePath = path.join(dir, `${id}.yaml`);
  await writeFile(filePath, [
    `id: ${id}`,
    `name: ${name}`,
    `version: '1.0.0'`,
    `description: Connector ${id}`,
    `enabled: true`,
  ].join('\n'), 'utf-8');
  return filePath;
}

async function createPermissionsJson(dir: string, ruleId: string, toolName: string, behavior: string): Promise<string> {
  const filePath = path.join(dir, 'permissions.json');
  await writeFile(filePath, JSON.stringify({
    version: 1,
    rules: [{
      id: ruleId,
      toolName,
      behavior,
      createdAt: Date.now(),
    }],
  }), 'utf-8');
  return filePath;
}

async function createMemoryMd(dir: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'MEMORY.md');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ============================================================
// Test Suite: Verification Criteria 1 - layout.resources affects paths
// ============================================================

describe('resource-dirs verification', () => {
  beforeEach(async () => {
    clearAllCache();
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // ---- Criterion 1: Each resource type loads from explicit dirs ----

  describe('criterion 1: explicit dirs override loading paths', () => {
    it('skills: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-skills');
      await mkdir(customDir, { recursive: true });
      await createSkillFile(customDir, 'test-skill', 'Test skill from custom dir');

      const result = await loadSkills({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(s => s.name === 'test-skill')).toBe(true);
      expect(result.every(s => s.sourcePath?.includes('custom-skills') || s.sourcePath?.includes('test-skill'))).toBe(true);
    });

    it('agents: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-agents');
      await mkdir(customDir, { recursive: true });
      await createAgentFile(customDir, 'test-agent', 'Test agent from custom dir');

      const result = await loadAgents({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(a => a.agentType === 'test-agent')).toBe(true);
      expect(result.some(a => a.filePath?.includes('custom-agents'))).toBe(true);
    });

    it('mcps: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-mcps');
      await mkdir(customDir, { recursive: true });
      await createMcpJson(customDir, 'test-mcp', 'node');

      const result = await loadMcpServers({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(m => m.name === 'test-mcp')).toBe(true);
      expect(result.some(m => m.sourcePath?.includes('custom-mcps'))).toBe(true);
    });

    it('connectors: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-connectors');
      await mkdir(customDir, { recursive: true });
      await createConnectorYaml(customDir, 'test-connector', 'Test Connector');

      const result = await loadConnectors({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(c => c.id === 'test-connector')).toBe(true);
      expect(result.some(c => c.sourcePath?.includes('custom-connectors'))).toBe(true);
    });

    it('permissions: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-permissions');
      await mkdir(customDir, { recursive: true });
      await createPermissionsJson(customDir, 'allow-read', 'read_file', 'allow');

      const result = await loadPermissions({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(p => p.id === 'allow-read')).toBe(true);
      expect(result.some(p => p.filePath?.includes('custom-permissions'))).toBe(true);
    });

    it('memory: loads from explicit dirs only', async () => {
      const customDir = path.join(testRoot, 'custom-memory');
      await createMemoryMd(customDir, 'custom memory content');

      const result = await loadMemory({ cwd: testRoot, dirs: [customDir] });
      expect(result.some(m => m.content === 'custom memory content')).toBe(true);
      expect(result.some(m => m.filePath?.includes('custom-memory'))).toBe(true);
    });
  });

  // ---- Criterion 2: loadAll() with resourceDirs doesn't fall back ----

  describe('criterion 2: loadAll with resourceDirs avoids implicit scan', () => {
    it('empty dirs array means no resources loaded for that type', async () => {
      const skillDir = path.join(testRoot, 'skills');
      await mkdir(skillDir, { recursive: true });
      await createSkillFile(skillDir, 'skill-in-default', 'Should NOT be loaded');

      const loaded = await loadAll({
        cwd: testRoot,
        resourceDirs: {
          skills: [],
          agents: [],
          mcps: [],
          connectors: [],
          permissions: [],
          memory: [],
        },
      });

      expect(loaded.skills).toEqual([]);
      expect(loaded.agents).toEqual([]);
      expect(loaded.mcps).toEqual([]);
      expect(loaded.connectors).toEqual([]);
      expect(loaded.permissions).toEqual([]);
      expect(loaded.memory).toEqual([]);
    });

    it('custom dirs only - no fallback to project/user defaults', async () => {
      const skillDir = path.join(testRoot, 'custom-skills');
      await mkdir(skillDir, { recursive: true });
      await createSkillFile(skillDir, 'custom-skill', 'From custom dir');

      const loaded = await loadAll({
        cwd: testRoot,
        resourceDirs: {
          skills: [skillDir],
          agents: [],
          mcps: [],
          connectors: [],
          permissions: [],
          memory: [],
        },
      });

      expect(loaded.skills.some(s => s.name === 'custom-skill')).toBe(true);
      expect(loaded.agents).toEqual([]);
      expect(loaded.mcps).toEqual([]);
    });
  });

  // ---- Criterion 3: sourcePath/filePath reflects real loading path ----

  describe('criterion 3: source info reflects real path', () => {
    it('skills sourcePath points to actual file', async () => {
      const skillDir = path.join(testRoot, 'skill-dir');
      await mkdir(skillDir, { recursive: true });
      const filePath = await createSkillFile(skillDir, 'path-skill', 'Path tracking skill');

      const result = await loadSkills({ cwd: testRoot, dirs: [skillDir] });
      const skill = result.find(s => s.name === 'path-skill');
      expect(skill).toBeDefined();
      expect(skill!.sourcePath).toBe(filePath);
    });

    it('agents filePath points to actual file', async () => {
      const agentDir = path.join(testRoot, 'agent-dir');
      await mkdir(agentDir, { recursive: true });
      const filePath = await createAgentFile(agentDir, 'path-agent', 'Path tracking agent');

      const result = await loadAgents({ cwd: testRoot, dirs: [agentDir] });
      const agent = result.find(a => a.agentType === 'path-agent');
      expect(agent).toBeDefined();
      expect(agent!.filePath).toBe(filePath);
    });

    it('mcps sourcePath points to actual file', async () => {
      const mcpDir = path.join(testRoot, 'mcp-dir');
      await mkdir(mcpDir, { recursive: true });
      const filePath = await createMcpJson(mcpDir, 'path-mcp', 'node');

      const result = await loadMcpServers({ cwd: testRoot, dirs: [mcpDir] });
      const mcp = result.find(m => m.name === 'path-mcp');
      expect(mcp).toBeDefined();
      expect(mcp!.sourcePath).toBe(filePath);
    });

    it('connectors sourcePath points to actual file', async () => {
      const connDir = path.join(testRoot, 'conn-dir');
      await mkdir(connDir, { recursive: true });
      const filePath = await createConnectorYaml(connDir, 'path-conn', 'Path Connector');

      const result = await loadConnectors({ cwd: testRoot, dirs: [connDir] });
      const conn = result.find(c => c.id === 'path-conn');
      expect(conn).toBeDefined();
      expect(conn!.sourcePath).toBe(filePath);
    });

    it('permissions filePath points to actual config file', async () => {
      const permDir = path.join(testRoot, 'perm-dir');
      await mkdir(permDir, { recursive: true });
      const filePath = await createPermissionsJson(permDir, 'path-rule', 'write_file', 'deny');

      const result = await loadPermissions({ cwd: testRoot, dirs: [permDir] });
      const rule = result.find(p => p.id === 'path-rule');
      expect(rule).toBeDefined();
      expect(rule!.filePath).toBe(filePath);
    });

    it('memory filePath points to actual MEMORY.md', async () => {
      const memDir = path.join(testRoot, 'mem-dir');
      const filePath = await createMemoryMd(memDir, 'memory path tracking');

      const result = await loadMemory({ cwd: testRoot, dirs: [memDir] });
      const mem = result.find(m => m.content === 'memory path tracking');
      expect(mem).toBeDefined();
      expect(mem!.filePath).toBe(filePath);
    });
  });

  // ---- Criterion 4: Default behavior stays compatible ----

  describe('criterion 4: default behavior without custom dirs', () => {
    it('loadSkills without dirs falls back to sources', async () => {
      // When no dirs are provided, sources determines default dirs
      const result = await loadSkills({ cwd: testRoot, sources: ['project'] });
      // Should not crash, may return empty if project skills dir doesn't exist
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadAgents without dirs falls back to sources', async () => {
      const result = await loadAgents({ cwd: testRoot, sources: ['project'] });
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadMcpServers without dirs falls back to sources', async () => {
      const result = await loadMcpServers({ cwd: testRoot, sources: ['project'] });
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadConnectors without dirs falls back to sources', async () => {
      const result = await loadConnectors({ cwd: testRoot, sources: ['project'] });
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadPermissions without dirs falls back to default dirs', async () => {
      const result = await loadPermissions({ cwd: testRoot });
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadMemory without dirs falls back to project dir', async () => {
      const result = await loadMemory({ cwd: testRoot });
      expect(Array.isArray(result)).toBe(true);
    });

    it('loadAll without resourceDirs uses defaults', async () => {
      const loaded = await loadAll({ cwd: testRoot });
      expect(Array.isArray(loaded.skills)).toBe(true);
      expect(Array.isArray(loaded.agents)).toBe(true);
      expect(Array.isArray(loaded.mcps)).toBe(true);
      expect(Array.isArray(loaded.connectors)).toBe(true);
      expect(Array.isArray(loaded.permissions)).toBe(true);
      expect(Array.isArray(loaded.memory)).toBe(true);
    });
  });

  // ---- Multi-dir priority test ----

  describe('multi-dir priority', () => {
    it('skills from multiple dirs merge with project > user priority', async () => {
      const dir1 = path.join(testRoot, 'skills-low');
      const dir2 = path.join(testRoot, 'skills-high');
      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });
      await createSkillFile(dir1, 'shared-skill', 'Low priority description');
      await createSkillFile(dir2, 'shared-skill', 'High priority description');

      // Load with both dirs (later dirs have higher priority in merge)
      const result = await loadSkills({ cwd: testRoot, dirs: [dir1, dir2] });
      const skill = result.find(s => s.name === 'shared-skill');
      expect(skill).toBeDefined();
      expect(skill!.description).toBe('High priority description');
    });

    it('loadAll distributes resourceDirs to each loader correctly', async () => {
      const skillDir = path.join(testRoot, 'r-skills');
      const agentDir = path.join(testRoot, 'r-agents');
      const mcpDir = path.join(testRoot, 'r-mcps');
      const connDir = path.join(testRoot, 'r-conns');
      const permDir = path.join(testRoot, 'r-perms');
      const memDir = path.join(testRoot, 'r-mem');

      await mkdir(skillDir, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await mkdir(mcpDir, { recursive: true });
      await mkdir(connDir, { recursive: true });
      await mkdir(permDir, { recursive: true });
      await createMemoryMd(memDir, 'distributed memory');

      await createSkillFile(skillDir, 'dist-skill', 'Distributed skill');
      await createAgentFile(agentDir, 'dist-agent', 'Distributed agent');
      await createMcpJson(mcpDir, 'dist-mcp', 'node');
      await createConnectorYaml(connDir, 'dist-conn', 'Distributed Connector');
      await createPermissionsJson(permDir, 'dist-rule', 'bash', 'allow');

      const loaded = await loadAll({
        cwd: testRoot,
        resourceDirs: {
          skills: [skillDir],
          agents: [agentDir],
          mcps: [mcpDir],
          connectors: [connDir],
          permissions: [permDir],
          memory: [memDir],
        },
      });

      expect(loaded.skills.some(s => s.name === 'dist-skill')).toBe(true);
      expect(loaded.agents.some(a => a.agentType === 'dist-agent')).toBe(true);
      expect(loaded.mcps.some(m => m.name === 'dist-mcp')).toBe(true);
      expect(loaded.connectors.some(c => c.id === 'dist-conn')).toBe(true);
      expect(loaded.permissions.some(p => p.id === 'dist-rule')).toBe(true);
      expect(loaded.memory.some(m => m.content === 'distributed memory')).toBe(true);

      // sourcePath/filePath reflects the custom dirs
      expect(loaded.skills.find(s => s.name === 'dist-skill')!.sourcePath).toContain('r-skills');
      expect(loaded.agents.find(a => a.agentType === 'dist-agent')!.filePath).toContain('r-agents');
      expect(loaded.mcps.find(m => m.name === 'dist-mcp')!.sourcePath).toContain('r-mcps');
      expect(loaded.connectors.find(c => c.id === 'dist-conn')!.sourcePath).toContain('r-conns');
      expect(loaded.permissions.find(p => p.id === 'dist-rule')!.filePath).toContain('r-perms');
      expect(loaded.memory.find(m => m.content === 'distributed memory')!.filePath).toContain('r-mem');
    });
  });
});