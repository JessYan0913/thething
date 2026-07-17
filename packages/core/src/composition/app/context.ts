// ============================================================
// App Context - 配置上下文创建
// ============================================================

import { resolveHomeDir } from '../../primitives/paths';
import { loadAll, type LoadAllOptions } from '../loaders';
import type { AppContext, CreateContextOptions, LoadSourceInfo } from './types';
import { createMcpRegistry } from '../../modules/mcp';
import { logger } from '../../primitives/logger';

// ============================================================
// CreateContext
// ============================================================

/**
 * 创建配置上下文
 *
 * 消费 CoreRuntime，返回不可变的配置快照。
 * 一轮对话绑定一个 AppContext，如果需要更新，下一轮对话用新的 AppContext。
 *
 * @param options 配置选项（runtime 必填）
 * @returns AppContext（不可变快照）
 */
export async function createContext(options: CreateContextOptions): Promise<AppContext> {
  const { runtime, verbose, onLoad } = options;
  const layout = options.layout ?? runtime.layout;
  const behavior = runtime.behavior;
  const cwd = layout.resourceRoot;
  const homeDir = resolveHomeDir();

  // 加载所有配置（configDirName 使用全局单例，已在 bootstrap 时设置）
  // 从 layout.filenames 和 behavior.memory 获取配置参数
  const loadOptions: LoadAllOptions = {
    cwd,
    configDir: layout.configDir,
    homeDir,
    env: runtime.env,
    resourceDirs: layout.resources,
    permissions: {
      filename: layout.filenames.permissions,
      dirs: layout.resources.permissions,
    },
  };
  const loaded = await loadAll(loadOptions);

  logger.debug('AppContext', `Loaded: skills=${loaded.skills.length} agents=${loaded.agents.length} mcps=${loaded.mcps.length} connectors=${loaded.connectors.length} permissions=${loaded.permissions.length}`);
  if (loaded.mcps.length > 0) {
    logger.debug('AppContext', `MCP servers: ${loaded.mcps.map(m => m.name).join(', ')}`);
  }

  // 将 connector 快照合并回 ConnectorRegistry（merge，不清除已有定义）。
  // 使用 merge 而非 clear+set，避免项目级 context 覆盖掉全局 connector（如飞书 WS）。
  runtime.connectorRegistry.mergeFromDefinitions(loaded.connectors);

  // 构建加载来源信息（使用 layout.resources）
  const loadedFrom: LoadSourceInfo = {
    skills: {
      path: layout.resources.skills[1] ?? `${cwd}/${layout.configDirName}/skills`,
      source: 'project',
      count: loaded.skills.length,
    },
    agents: {
      path: layout.resources.agents[1] ?? `${cwd}/${layout.configDirName}/agents`,
      source: 'project',
      count: loaded.agents.length,
    },
    mcps: {
      path: layout.resources.mcps[1] ?? `${cwd}/${layout.configDirName}/mcps`,
      source: 'project',
      count: loaded.mcps.length,
    },
    connectors: {
      path: layout.resources.connectors[0] ?? `${cwd}/${layout.configDirName}/connectors`,
      source: 'project',
      count: loaded.connectors.length,
    },
    permissions: {
      userPath: layout.resources.permissions[0] ?? `${homeDir}/${layout.configDirName}/permissions`,
      userCount: loaded.permissions.filter(p => p.source === 'user').length,
      projectPath: layout.resources.permissions[1] ?? `${cwd}/${layout.configDirName}/permissions`,
      projectCount: loaded.permissions.filter(p => p.source === 'project').length,
    },
  };

  // 打印日志（如果 verbose）
  if (verbose) {
    logger.debug('AppContext', 'Configuration loaded:');
    logger.debug('AppContext', `  cwd: ${cwd}`);
    logger.debug('AppContext', `  dataDir: ${layout.dataDir}`);
    logger.debug('AppContext', `  configDir: ${layout.configDir}`);
    logger.debug('AppContext', `  skills: ${loaded.skills.length}`);
    logger.debug('AppContext', `  agents: ${loaded.agents.length}`);
    logger.debug('AppContext', `  mcps: ${loaded.mcps.length}`);
    logger.debug('AppContext', `  connectors: ${loaded.connectors.length}`);
    logger.debug('AppContext', `  permissions: ${loaded.permissions.length}`);
    logger.debug('AppContext', `  behavior.maxStepsPerSession: ${behavior.maxStepsPerSession}`);
    logger.debug('AppContext', `  behavior.maxBudgetUsdPerSession: ${behavior.maxBudgetUsdPerSession}`);
  }

  // 调用 onLoad 回调
  if (onLoad) {
    const modules: Array<{ name: 'skills' | 'agents' | 'mcps' | 'connectors' | 'permissions'; path: string }> = [
      { name: 'skills', path: loadedFrom.skills.path },
      { name: 'agents', path: loadedFrom.agents.path },
      { name: 'mcps', path: loadedFrom.mcps.path },
      { name: 'connectors', path: loadedFrom.connectors.path },
      { name: 'permissions', path: loadedFrom.permissions.projectPath },
    ];
    for (const { name, path } of modules) {
      onLoad({
        module: name,
        path,
        count: loaded[name].length,
      });
    }
  }

  // 创建不可变快照
  // 创建共享 MCP 注册表（跨请求复用连接，延迟到首次 connectAll 时建立）
  const mcpRegistry = loaded.mcps.length > 0 ? createMcpRegistry(loaded.mcps) : undefined;

  const context: AppContext = {
    runtime,
    layout,
    behavior,
    skills: Object.freeze([...loaded.skills]),
    agents: Object.freeze([...loaded.agents]),
    mcps: Object.freeze([...loaded.mcps]),
    connectors: Object.freeze([...loaded.connectors]),
    permissions: Object.freeze([...loaded.permissions]),
    mcpRegistry,
    loadedFrom,
    reload: async (reloadOptions?: { verbose?: boolean; onLoad?: (event: import('./types').LoadEvent) => void }) => {
      if (mcpRegistry) await mcpRegistry.disconnectAll().catch(() => {});
      return createContext({
        runtime,
        verbose: reloadOptions?.verbose ?? verbose,
        onLoad: reloadOptions?.onLoad ?? onLoad,
      });
    },
    dispose: async () => {
      if (mcpRegistry) await mcpRegistry.disconnectAll().catch(() => {});
    },
  };

  return Object.freeze(context);
}

// ============================================================
// 便捷函数（向后兼容）
// ============================================================
// 注意：这些函数已被移除，请使用 bootstrap() + createContext() 替代
