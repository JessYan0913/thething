// ============================================================
// Loaders Module - 加载器导出
// ============================================================

export {
  loadSkills,
  loadSkillFile,
  clearSkillsCache,
  type LoadSkillsOptions,
} from '../../modules/skills/loader';

export {
  loadAgents,
  loadAgentFile,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  clearAgentsCache,
  type LoadAgentsOptions,
} from '../../modules/subagents/loader';

export {
  loadMcpServers,
  loadMcpFile,
  clearMcpsCache,
  type LoadMcpsOptions,
} from '../../modules/mcp/loader';

export {
  loadConnectors,
  loadConnectorFile,
  clearConnectorsCache,
  type LoadConnectorsOptions,
} from '../../modules/connector/loader-internal';

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
// AppModule 类型和适配器
// ============================================================

export type { AppModule, ModuleContext } from './module-types';
export {
  createSkillsModule,
  createAgentsModule,
  createMcpModule,
  createConnectorModule,
  createPermissionsModule,
  createMemoryModule,
} from './modules';

// ============================================================
// 统一加载
// ============================================================

import type { ResourceDirs } from '../../services/config/layout';
import type { Skill } from '../../modules/skills/types';
import type { AgentDefinition } from '../../modules/subagents/types';
import type { McpServerConfig } from '../../modules/mcp/types';
import type { ConnectorFrontmatter } from '../../modules/connector/loader';
import type { PermissionRule } from '../../modules/permissions/types';
import type { MemoryEntry, LoadSkillsOptions, LoadAgentsOptions, LoadMcpsOptions, LoadConnectorsOptions, LoadPermissionsOptions, LoadMemoryOptions } from './index';
import type { AppModule, ModuleContext } from './module-types';
import {
  createSkillsModule,
  createAgentsModule,
  createMcpModule,
  createConnectorModule,
  createPermissionsModule,
  createMemoryModule,
} from './modules';

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
  /** 已初始化的模块实例（用于后续 dispose） */
  moduleInstances: AppModule[];
}

// 别名，供外部使用
export type LoadedData = LoadAllResult;

/**
 * 加载所有配置
 *
 * 内部使用 AppModule 统一生命周期，每个模块独立 init/snapshot。
 * 返回 moduleInstances 供调用者后续 dispose。
 *
 * @param options 加载选项
 * @returns 所有配置 + 模块实例
 */
export async function loadAll(options?: LoadAllOptions): Promise<LoadAllResult> {
  const cwd = options?.cwd ?? process.cwd();

  // 构建 ModuleContext
  const moduleContext: ModuleContext = {
    cwd,
    configDirName: options?.configDirName ?? '.thething',
    homeDir: options?.homeDir ?? process.env.HOME ?? process.cwd(),
    env: options?.env ?? {},
    resourceDirs: options?.resourceDirs ?? {
      skills: [],
      agents: [],
      mcps: [],
      connectors: [],
      permissions: [],
      memory: [],
    },
  };

  // 创建模块实例（每个模块使用对应的 LoadOptions）
  const modules: AppModule[] = [
    createSkillsModule(options?.skills),
    createAgentsModule(options?.agents),
    createMcpModule(options?.mcps),
    createConnectorModule(options?.connectors),
    createPermissionsModule(options?.permissions),
    createMemoryModule(options?.memory),
  ];

  // 并行 init 所有模块
  await Promise.all(
    modules.map((mod) => mod.init?.(moduleContext)),
  );

  // 并行获取所有快照
  const snapshots = await Promise.all(
    modules.map((mod) => Promise.resolve(mod.snapshot?.())),
  );

  return {
    cwd,
    skills: (snapshots[0] ?? []) as Skill[],
    agents: (snapshots[1] ?? []) as AgentDefinition[],
    mcps: (snapshots[2] ?? []) as McpServerConfig[],
    connectors: (snapshots[3] ?? []) as ConnectorFrontmatter[],
    permissions: (snapshots[4] ?? []) as PermissionRule[],
    memory: (snapshots[5] ?? []) as MemoryEntry[],
    moduleInstances: modules,
  };
}

/**
 * 释放所有模块资源
 *
 * @param modules 要释放的模块实例列表
 */
export async function disposeModules(modules: AppModule[]): Promise<void> {
  await Promise.all(
    modules.map((mod) => mod.dispose?.()),
  );
}

/**
 * 清除所有缓存（向后兼容）
 */
export function clearAllCache(): void {
  // 通过创建临时模块实例并 dispose 来清缓存
  const modules = [
    createSkillsModule(),
    createAgentsModule(),
    createMcpModule(),
    createConnectorModule(),
    createPermissionsModule(),
    createMemoryModule(),
  ];
  disposeModules(modules);
}
