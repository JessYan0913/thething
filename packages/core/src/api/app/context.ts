// ============================================================
// App Context - 配置上下文创建
// ============================================================

import { resolveHomeDir } from '../../foundation/paths';
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
  const layout = runtime.layout;
  const behavior = runtime.behavior;

  // 从 layout 取值（支持 cwd/dataDir 参数覆盖，向后兼容）
  const cwd = options.cwd ?? layout.resourceRoot;
  const dataDir = options.dataDir ?? layout.dataDir;
  const homeDir = resolveHomeDir();

  // 加载所有配置（configDirName 使用全局单例，已在 bootstrap 时设置）
  // 从 layout.filenames 和 behavior.memory 获取配置参数
  const loadOptions: LoadAllOptions = {
    cwd,
    dataDir,
    resourceDirs: layout.resources,
    permissions: {
      cwd,
      filename: layout.filenames.permissions,  // 从 ResolvedLayout 传入
    },
    memory: {
      cwd,
      maxLines: behavior.memory.mdMaxLines,    // 从 BehaviorConfig 传入
      maxSizeKb: behavior.memory.mdMaxSizeKb,
    },
  };
  const loaded = await loadAll(loadOptions);

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
    memory: {
      path: layout.resources.memory[0] ?? `${cwd}/${layout.configDirName}/memory`,
      count: loaded.memory.length,
    },
  };

  // 打印日志（如果 verbose）
  if (verbose) {
    console.log('[AppContext] Configuration loaded:');
    console.log(`  cwd: ${cwd}`);
    console.log(`  dataDir: ${dataDir}`);
    console.log(`  configDirName: ${layout.configDirName}`);
    console.log(`  skills: ${loaded.skills.length}`);
    console.log(`  agents: ${loaded.agents.length}`);
    console.log(`  mcps: ${loaded.mcps.length}`);
    console.log(`  connectors: ${loaded.connectors.length}`);
    console.log(`  permissions: ${loaded.permissions.length}`);
    console.log(`  memory: ${loaded.memory.length}`);
    console.log(`  behavior.maxStepsPerSession: ${behavior.maxStepsPerSession}`);
    console.log(`  behavior.maxBudgetUsdPerSession: ${behavior.maxBudgetUsdPerSession}`);
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
    layout,
    behavior,
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
        dataDir,
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
// 注意：这些函数已被移除，请使用 bootstrap() + createContext() 替代
