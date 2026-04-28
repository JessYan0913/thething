// ============================================================
// App Context - 配置上下文创建
// ============================================================

import { resolveHomeDir, resolveProjectDir, computeUserConfigDir, computeProjectConfigDir } from '../../foundation/paths';
import { loadAll, type LoadAllOptions } from '../loaders';
import type { AppContext, CreateContextOptions, ReloadOptions, LoadSourceInfo } from './types';

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
  const cwd = options.cwd ?? runtime.cwd;
  const dataDir = options.dataDir ?? runtime.dataDir;
  const homeDir = resolveHomeDir();

  // 加载所有配置
  const loadOptions: LoadAllOptions = { cwd, dataDir };
  const loaded = await loadAll(loadOptions);

  // 构建加载来源信息
  const loadedFrom: LoadSourceInfo = {
    skills: {
      path: computeProjectConfigDir(cwd, 'skills'),
      source: 'project',
      count: loaded.skills.length,
    },
    agents: {
      path: computeProjectConfigDir(cwd, 'agents'),
      source: 'project',
      count: loaded.agents.length,
    },
    mcps: {
      path: computeProjectConfigDir(cwd, 'mcps'),
      source: 'project',
      count: loaded.mcps.length,
    },
    connectors: {
      path: computeProjectConfigDir(cwd, 'connectors'),
      source: 'project',
      count: loaded.connectors.length,
    },
    permissions: {
      userPath: computeUserConfigDir(homeDir, 'permissions'),
      userCount: loaded.permissions.filter(p => p.source === 'user').length,
      projectPath: computeProjectConfigDir(cwd, 'permissions'),
      projectCount: loaded.permissions.filter(p => p.source === 'project').length,
    },
    memory: {
      path: computeProjectConfigDir(cwd, 'memory'),
      count: loaded.memory.length,
    },
  };

  // 打印日志（如果 verbose）
  if (verbose) {
    console.log('[AppContext] Configuration loaded:');
    console.log(`  cwd: ${cwd}`);
    console.log(`  dataDir: ${dataDir}`);
    console.log(`  skills: ${loaded.skills.length}`);
    console.log(`  agents: ${loaded.agents.length}`);
    console.log(`  mcps: ${loaded.mcps.length}`);
    console.log(`  connectors: ${loaded.connectors.length}`);
    console.log(`  permissions: ${loaded.permissions.length}`);
    console.log(`  memory: ${loaded.memory.length}`);
  }

  // 调用 onLoad 回调
  if (onLoad) {
    const modules: Array<{ name: 'skills' | 'agents' | 'mcps' | 'connectors' | 'permissions' | 'memory'; path: string }> = [
      { name: 'skills', path: loadedFrom.skills.path },
      { name: 'agents', path: loadedFrom.agents.path },
      { name: 'mcps', path: loadedFrom.mcps.path },
      { name: 'connectors', path: loadedFrom.connectors.path },
      { name: 'permissions', path: loadedFrom.permissions.projectPath },
      { name: 'memory', path: loadedFrom.memory.path },
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
  const context: AppContext = {
    runtime,
    cwd,
    dataDir,
    skills: Object.freeze([...loaded.skills]),
    agents: Object.freeze([...loaded.agents]),
    mcps: Object.freeze([...loaded.mcps]),
    connectors: Object.freeze([...loaded.connectors]),
    permissions: Object.freeze([...loaded.permissions]),
    memory: Object.freeze([...loaded.memory]),
    loadedFrom,
    reload: async (reloadOptions?: ReloadOptions) => {
      return createContext({
        runtime,
        cwd: reloadOptions?.cwd ?? cwd,
        verbose: reloadOptions?.verbose ?? verbose,
        onLoad,
      });
    },
  };

  return Object.freeze(context);
}

// ============================================================
// 便捷函数（向后兼容）
// ============================================================

/**
 * 获取当前 AppContext（从默认 cwd）
 *
 * @deprecated 此函数需要 runtime 参数，请使用 bootstrap() + createContext() 替代。
 * 保留向后兼容，内部自动创建 runtime（但不推荐）。
 */
export async function getAppContext(): Promise<AppContext> {
  // 向后兼容：自动创建 runtime
  // 但这违反了显式依赖原则，不推荐使用
  const { bootstrap } = await import('../../bootstrap');
  const cwd = resolveProjectDir();
  const runtime = await bootstrap({ dataDir: cwd }); // 使用临时 runtime

  return createContext({ runtime, cwd });
}