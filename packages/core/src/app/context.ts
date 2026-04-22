// ============================================================
// App Context - 配置上下文创建
// ============================================================

import { detectProjectDir, getUserDataDir, getUserConfigDir, getProjectConfigDir } from '../paths';
import { loadAll, type LoadAllOptions, type LoadAllResult } from '../loaders';
import type { AppContext, CreateContextOptions, LoadEvent, LoadSourceInfo, LoadError } from './types';

// ============================================================
// CreateContext
// ============================================================

/**
 * 创建配置上下文
 *
 * @param options 配置选项
 * @returns AppContext
 */
export async function createContext(options?: CreateContextOptions): Promise<AppContext> {
  const cwd = options?.cwd ?? detectProjectDir();
  const dataDir = options?.dataDir ?? getUserDataDir();

  // 加载所有配置
  const loadOptions: LoadAllOptions = { cwd, dataDir };
  const loaded = await loadAll(loadOptions);

  // 构建加载来源信息
  const loadedFrom: LoadSourceInfo = {
    skills: {
      path: getProjectConfigDir(cwd, 'skills'),
      source: 'project',
      count: loaded.skills.length,
    },
    agents: {
      path: getProjectConfigDir(cwd, 'agents'),
      source: 'project',
      count: loaded.agents.length,
    },
    mcps: {
      path: getProjectConfigDir(cwd, 'mcps'),
      source: 'project',
      count: loaded.mcps.length,
    },
    connectors: {
      path: getProjectConfigDir(cwd, 'connectors'),
      source: 'project',
      count: loaded.connectors.length,
    },
    permissions: {
      userPath: getUserConfigDir('permissions'),
      userCount: loaded.permissions.filter(p => p.source === 'user').length,
      projectPath: getProjectConfigDir(cwd, 'permissions'),
      projectCount: loaded.permissions.filter(p => p.source === 'project').length,
    },
    memory: {
      path: getProjectConfigDir(cwd, 'memory'),
      count: loaded.memory.length,
    },
  };

  // 打印日志（如果 verbose）
  if (options?.verbose) {
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
  if (options?.onLoad) {
    const modules: Array<{ name: 'skills' | 'agents' | 'mcps' | 'connectors' | 'permissions' | 'memory'; path: string }> = [
      { name: 'skills', path: loadedFrom.skills.path },
      { name: 'agents', path: loadedFrom.agents.path },
      { name: 'mcps', path: loadedFrom.mcps.path },
      { name: 'connectors', path: loadedFrom.connectors.path },
      { name: 'permissions', path: loadedFrom.permissions.projectPath },
      { name: 'memory', path: loadedFrom.memory.path },
    ];
    for (const { name, path } of modules) {
      options.onLoad!({
        module: name,
        path,
        count: loaded[name].length,
      });
    }
  }

  return {
    cwd,
    dataDir,
    skills: loaded.skills,
    agents: loaded.agents,
    mcps: loaded.mcps,
    connectors: loaded.connectors,
    permissions: loaded.permissions,
    memory: loaded.memory,
    loadedFrom,
  };
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 获取当前 AppContext（从默认 cwd）
 */
export async function getAppContext(): Promise<AppContext> {
  return createContext();
}