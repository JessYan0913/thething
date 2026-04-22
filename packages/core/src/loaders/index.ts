// ============================================================
// Loaders Module - 加载器导出
// ============================================================

export {
  loadSkills,
  loadSkillFile,
  clearSkillsCache,
  type LoadSkillsOptions,
} from './skills';

export {
  loadAgents,
  loadAgentFile,
  clearAgentsCache,
  type LoadAgentsOptions,
} from './agents';

export {
  loadMcpServers,
  loadMcpFile,
  clearMcpsCache,
  type LoadMcpsOptions,
} from './mcps';

export {
  loadConnectors,
  loadConnectorFile,
  clearConnectorsCache,
  type LoadConnectorsOptions,
} from './connectors';

export {
  loadPermissions,
  clearPermissionsCache,
  type LoadPermissionsOptions,
} from './permissions';

export {
  loadMemory,
  clearMemoryCache,
  type LoadMemoryOptions,
  type MemoryEntry,
} from './memory';

// ============================================================
// 统一加载
// ============================================================

import { detectProjectDir, getUserDataDir } from '../paths';
import type { Skill } from '../skills/types';
import type { AgentDefinition } from '../subagents/types';
import type { McpServerConfig } from '../mcp/types';
import type { ConnectorFrontmatter } from '../connector/loader';
import type { PermissionRule } from '../permissions/types';
import type { MemoryEntry, LoadSkillsOptions, LoadAgentsOptions, LoadMcpsOptions, LoadConnectorsOptions, LoadPermissionsOptions, LoadMemoryOptions } from './index';
import { loadSkills, clearSkillsCache } from './skills';
import { loadAgents, clearAgentsCache } from './agents';
import { loadMcpServers, clearMcpsCache } from './mcps';
import { loadConnectors, clearConnectorsCache } from './connectors';
import { loadPermissions, clearPermissionsCache } from './permissions';
import { loadMemory, clearMemoryCache } from './memory';

export interface LoadAllOptions {
  cwd?: string;
  dataDir?: string;
  skills?: LoadSkillsOptions;
  agents?: LoadAgentsOptions;
  mcps?: LoadMcpsOptions;
  connectors?: LoadConnectorsOptions;
  permissions?: LoadPermissionsOptions;
  memory?: LoadMemoryOptions;
}

export interface LoadAllResult {
  cwd: string;
  dataDir: string;
  skills: Skill[];
  agents: AgentDefinition[];
  mcps: McpServerConfig[];
  connectors: ConnectorFrontmatter[];
  permissions: PermissionRule[];
  memory: MemoryEntry[];
}

/**
 * 加载所有配置
 *
 * @param options 加载选项
 * @returns 所有配置
 */
export async function loadAll(options?: LoadAllOptions): Promise<LoadAllResult> {
  const cwd = options?.cwd ?? detectProjectDir();
  const dataDir = options?.dataDir ?? getUserDataDir();

  // 并行加载所有模块
  const [skills, agents, mcps, connectors, permissions, memory] = await Promise.all([
    loadSkills({ cwd, ...options?.skills }),
    loadAgents({ cwd, ...options?.agents }),
    loadMcpServers({ cwd, ...options?.mcps }),
    loadConnectors({ cwd, ...options?.connectors }),
    loadPermissions({ cwd, ...options?.permissions }),
    loadMemory({ cwd, ...options?.memory }),
  ]);

  return {
    cwd,
    dataDir,
    skills,
    agents,
    mcps,
    connectors,
    permissions,
    memory,
  };
}

/**
 * 清除所有缓存
 */
export function clearAllCache(): void {
  clearSkillsCache();
  clearAgentsCache();
  clearMcpsCache();
  clearConnectorsCache();
  clearPermissionsCache();
  clearMemoryCache();
}