// ============================================================
// Loaders Module - 加载器导出
// ============================================================

export {
  loadSkills,
  loadSkillFile,
  type LoadSkillsOptions,
} from '../../modules/skills/loader';

export {
  loadAgents,
  loadAgentFile,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  type LoadAgentsOptions,
} from '../../modules/agent/loader';

export {
  loadMcpServers,
  loadMcpFile,
  type LoadMcpsOptions,
} from '../../modules/mcp/loader';

export {
  loadConnectors,
  loadConnectorFile,
  type LoadConnectorsOptions,
} from '../../modules/connector/loader-internal';

export {
  loadPermissions,
  type LoadPermissionsOptions,
} from './permissions';

// ============================================================
// 统一加载
// ============================================================

import type { ResourceDirs } from '../../services/config/layout';
import type { Skill } from '../../modules/skills/types';
import type { AgentDefinition } from '../../modules/agent/types';
import type { McpServerConfig } from '../../modules/mcp/types';
import type { ConnectorFrontmatter } from '../../modules/connector/loader';
import type { PermissionRule } from '../../modules/permissions/types';
// 直接导入来源模块，避免对自身 index 的自导入：
// esbuild 打包异步模块时，自导入会在模块工厂内生成 `await init_x()` 自等待 → 死锁
//（表现为 CLI 构建产物启动时卡在 unsettled top-level await）。
import type { LoadSkillsOptions } from '../../modules/skills/loader';
import type { LoadAgentsOptions } from '../../modules/agent/loader';
import type { LoadMcpsOptions } from '../../modules/mcp/loader';
import type { LoadConnectorsOptions } from '../../modules/connector/loader-internal';
import type { LoadPermissionsOptions } from './permissions';
import { loadSkills } from '../../modules/skills/loader';
import { loadAgents } from '../../modules/agent/loader';
import { loadMcpServers } from '../../modules/mcp/loader';
import { loadConnectors } from '../../modules/connector/loader-internal';
import { loadPermissions } from './permissions';

export interface LoadAllOptions {
  cwd?: string;
  /** 已解析的资源目录（可选，直接使用而不重新计算） */
  resourceDirs?: ResourceDirs;
  /** 配置目录路径（如 ~/.thething，用于未显式传 dirs 的 loader） */
  configDir?: string;
  /** 用户 home 目录 */
  homeDir?: string;
  /** 环境变量快照 */
  env?: Record<string, string | undefined>;
  skills?: LoadSkillsOptions;
  agents?: LoadAgentsOptions;
  mcps?: LoadMcpsOptions;
  connectors?: LoadConnectorsOptions;
  permissions?: LoadPermissionsOptions;
}

export interface LoadAllResult {
  cwd: string;
  skills: Skill[];
  agents: AgentDefinition[];
  mcps: McpServerConfig[];
  connectors: ConnectorFrontmatter[];
  permissions: PermissionRule[];
}

// 别名，供外部使用
export type LoadedData = LoadAllResult;

/**
 * 加载所有配置
 *
 * 直接调用各 loader，不再通过 AppModule 生命周期包装。
 */
export async function loadAll(options?: LoadAllOptions): Promise<LoadAllResult> {
  const cwd = options?.cwd ?? process.cwd();
  const configDir = options?.configDir;
  if (!configDir) throw new Error('loadAll: configDir is required');

  const homeDir = options?.homeDir ?? process.env.HOME ?? process.cwd();
  const resourceDirs = options?.resourceDirs;

  const [skills, agents, mcps, connectors, permissions] = await Promise.all([
    loadSkills({
      cwd,
      configDir,
      homeDir,
      dirs: resourceDirs?.skills,
      ...options?.skills,
    }),
    loadAgents({
      cwd,
      configDir,
      homeDir,
      dirs: resourceDirs?.agents,
      ...options?.agents,
    }),
    loadMcpServers({
      cwd,
      configDir,
      homeDir,
      dirs: resourceDirs?.mcps,
      ...options?.mcps,
    }),
    loadConnectors({
      cwd,
      configDir,
      homeDir,
      dirs: resourceDirs?.connectors,
      ...options?.connectors,
    }),
    loadPermissions({
      cwd,
      configDir,
      homeDir,
      dirs: resourceDirs?.permissions,
      filename: options?.permissions?.filename,
      ...options?.permissions,
    }),
  ]);

  return {
    cwd,
    skills,
    agents,
    mcps,
    connectors,
    permissions,
  };
}
