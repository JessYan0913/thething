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
  parseAgentMarkdown,
  serializeAgentMarkdown,
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

import type { ResourceDirs } from '../../config/layout';
import type { Skill } from '../../extensions/skills/types';
import type { AgentDefinition } from '../../extensions/subagents/types';
import type { McpServerConfig } from '../../extensions/mcp/types';
import type { ConnectorFrontmatter } from '../../extensions/connector/loader';
import type { PermissionRule } from '../../extensions/permissions/types';
import type { MemoryEntry, LoadSkillsOptions, LoadAgentsOptions, LoadMcpsOptions, LoadConnectorsOptions, LoadPermissionsOptions, LoadMemoryOptions } from './index';
import { loadSkills, clearSkillsCache } from './skills';
import { loadAgents, clearAgentsCache } from './agents';
import { loadMcpServers, clearMcpsCache } from './mcps';
import { loadConnectors, clearConnectorsCache } from './connectors';
import { loadPermissions, clearPermissionsCache } from './permissions';
import { loadMemory, clearMemoryCache } from './memory';

export interface LoadAllOptions {
  cwd?: string;
  /** 已解析的资源目录（可选，直接使用而不重新计算） */
  resourceDirs?: ResourceDirs;
  /** 配置目录名（用于未显式传 dirs 的 loader） */
  configDirName?: string;
  /** 用户 home 目录 */
  homeDir?: string;
  /** 环境变量快照 */
  env?: Record<string, string | undefined>;
  skills?: LoadSkillsOptions;
  agents?: LoadAgentsOptions;
  mcps?: LoadMcpsOptions;
  connectors?: LoadConnectorsOptions;
  permissions?: LoadPermissionsOptions;
  memory?: LoadMemoryOptions;
}

export interface LoadAllResult {
  cwd: string;
  skills: Skill[];
  agents: AgentDefinition[];
  mcps: McpServerConfig[];
  connectors: ConnectorFrontmatter[];
  permissions: PermissionRule[];
  memory: MemoryEntry[];
}

// 别名，供外部使用
export type LoadedData = LoadAllResult;

/**
 * 加载所有配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取，
 * 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
 *
 * @param options 加载选项
 * @returns 所有配置
 */
export async function loadAll(options?: LoadAllOptions): Promise<LoadAllResult> {
  const cwd = options?.cwd ?? process.cwd();

  // 并行加载所有模块（使用全局 configDirName）
  const [skills, agents, mcps, connectors, permissions, memory] = await Promise.all([
    loadSkills({
      cwd,
      dirs: options?.resourceDirs?.skills,
      configDirName: options?.configDirName,
      homeDir: options?.homeDir,
      ...options?.skills,
    }),
    loadAgents({
      cwd,
      dirs: options?.resourceDirs?.agents,
      configDirName: options?.configDirName,
      homeDir: options?.homeDir,
      ...options?.agents,
    }),
    loadMcpServers({
      cwd,
      dirs: options?.resourceDirs?.mcps,
      configDirName: options?.configDirName,
      homeDir: options?.homeDir,
      ...options?.mcps,
    }),
    loadConnectors({
      cwd,
      dirs: options?.resourceDirs?.connectors,
      configDirName: options?.configDirName,
      homeDir: options?.homeDir,
      env: options?.env,
      ...options?.connectors,
    }),
    loadPermissions({
      cwd,
      dirs: options?.resourceDirs?.permissions,
      configDirName: options?.configDirName,
      homeDir: options?.homeDir,
      ...options?.permissions,
    }),
    loadMemory({
      cwd,
      dirs: options?.resourceDirs?.memory,
      configDirName: options?.configDirName,
      ...options?.memory,
    }),
  ]);

  return {
    cwd,
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
