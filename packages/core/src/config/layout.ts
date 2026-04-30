// ============================================================
// Layout Config - 文件系统布局配置
// ============================================================
//
// 与 BehaviorConfig 分离的原因：
// - 布局是部署决策（文件放在哪）
// - 行为是业务决策（系统怎么运行）
// - 两者变化的原因不同，因此分开定义
//
// 典型场景：
// - 开发时：layout 指向项目目录，behavior 使用默认值
// - 生产部署：layout 把数据目录指向 /var/lib/app，behavior 调大预算上限
// - 测试：layout 指向临时目录，behavior 缩小步骤数加速测试
//

import path from 'path';
import os from 'os';
import {
  DEFAULT_PROJECT_CONFIG_DIR_NAME,
  TOKENIZER_CACHE_DIR_NAME,
  PERMISSIONS_FILENAME,
  DEFAULT_DB_FILENAME,
} from './defaults';

/**
 * 资源目录结构
 */
export interface ResourceDirs {
  /** Skills 目录列表（按优先级从低到高） */
  skills: readonly string[];
  /** Agents 目录列表 */
  agents: readonly string[];
  /** MCP 配置目录列表 */
  mcps: readonly string[];
  /** Connectors 目录列表 */
  connectors: readonly string[];
  /** Permissions 目录列表 */
  permissions: readonly string[];
  /** Memory 目录列表 */
  memory: readonly string[];
}

/**
 * 文件系统布局配置（调用方输入）
 *
 * @example
 * // 最简场景
 * const layout: LayoutConfig = { resourceRoot: process.cwd() };
 *
 * @example
 * // 替换应用名
 * const layout: LayoutConfig = {
 *   resourceRoot: process.cwd(),
 *   configDirName: '.myapp',
 * };
 *
 * @example
 * // 企业部署（数据与代码分离）
 * const layout: LayoutConfig = {
 *   resourceRoot: process.cwd(),
 *   configDirName: '.myapp',
 *   dataDir: '/var/lib/myapp/data',
 * };
 */
export interface LayoutConfig {
  /**
   * 项目根目录（绝对路径）
   * 资源文件（skills、agents 等）从此目录的子目录加载
   */
  resourceRoot: string;

  /**
   * 配置目录名（相对于 resourceRoot 和用户 home 目录）
   *
   * 这一个字段决定了整个约定体系：
   *   资源目录：<resourceRoot>/<configDirName>/skills、mcps ...
   *   用户目录：~/<configDirName>/skills、mcps ...
   *   数据目录：<resourceRoot>/<configDirName>/data（可被 dataDir 覆盖）
   *
   * @default '.thething'
   */
  configDirName?: string;

  /**
   * 运行时数据目录（数据库、工具结果缓存等）
   * 不传时默认为 <resourceRoot>/<configDirName>/data
   *
   * 独立配置此字段可以把数据与代码分离（符合 12-factor app 原则）
   */
  dataDir?: string;

  /**
   * 各类资源的目录列表（绝对路径，按优先级从低到高排列）
   *
   * 不传时由 configDirName 自动派生：
   *   skills: ['~/<configDirName>/skills', '<resourceRoot>/<configDirName>/skills']
   *
   * 传入时完整替换默认列表（不合并）
   */
  resources?: Partial<ResourceDirs>;

  /**
   * 项目上下文文件的文件名列表（按优先级排列）
   * 这些文件会被加载进 system prompt，描述项目背景
   * @default ['THING.md', 'CONTEXT.md']
   */
  contextFileNames?: readonly string[];
}

/**
 * 展开后的布局（不可变，所有路径为绝对路径）
 * 由 resolveLayout() 从 LayoutConfig 构建，之后在系统内流通
 */
export interface ResolvedLayout {
  /** 项目根目录 */
  readonly resourceRoot: string;
  /** 配置目录名 */
  readonly configDirName: string;
  /** 数据目录 */
  readonly dataDir: string;
  /** 资源目录列表 */
  readonly resources: Readonly<ResourceDirs>;
  /** 项目上下文文件名列表 */
  readonly contextFileNames: readonly string[];
  /** Tokenizer 缓存目录 */
  readonly tokenizerCacheDir: string;
  // 新增：文件名常量
  /** 文件名配置 */
  readonly filenames: {
    /** Permissions 配置文件名 */
    readonly permissions: string;
    /** 数据库文件名 */
    readonly db: string;
  };
}

/**
 * 将 LayoutConfig 展开为 ResolvedLayout
 *
 * 这是一个纯函数：给定相同输入，始终返回相同输出
 *
 * @param config - 布局配置
 * @returns 展开后的布局（所有路径已解析为绝对路径）
 *
 * @example
 * const layout = resolveLayout({ resourceRoot: process.cwd() });
 * // layout.configDirName === '.thething'
 * // layout.dataDir === '<cwd>/.thething/data'
 */
export function resolveLayout(config: LayoutConfig): ResolvedLayout {
  const { resourceRoot } = config;
  const configDirName = config.configDirName ?? DEFAULT_PROJECT_CONFIG_DIR_NAME;

  const projectDir = path.join(resourceRoot, configDirName);
  const userDir = path.join(os.homedir(), configDirName);
  const dataDir = config.dataDir ?? path.join(projectDir, 'data');

  const defaultResources: ResourceDirs = {
    skills:      [path.join(userDir, 'skills'),      path.join(projectDir, 'skills')],
    agents:      [path.join(userDir, 'agents'),      path.join(projectDir, 'agents')],
    mcps:        [path.join(userDir, 'mcps'),        path.join(projectDir, 'mcps')],
    connectors:  [                                    path.join(projectDir, 'connectors')],
    permissions: [path.join(userDir, 'permissions'), path.join(projectDir, 'permissions')],
    memory:      [                                    path.join(projectDir, 'memory')],
  };

  return Object.freeze({
    resourceRoot,
    configDirName,
    dataDir,
    resources: Object.freeze({ ...defaultResources, ...config.resources }),
    contextFileNames: Object.freeze(config.contextFileNames ?? ['THING.md', 'CONTEXT.md']),
    tokenizerCacheDir: path.join(os.homedir(), '.cache', 'thething', TOKENIZER_CACHE_DIR_NAME),
    // 新增：文件名配置
    filenames: Object.freeze({
      permissions: PERMISSIONS_FILENAME,
      db: DEFAULT_DB_FILENAME,
    }),
  });
}

// ============================================================
// 向后兼容：保留原有类型和函数
// ============================================================

/**
 * @deprecated 使用 ResolvedLayout 代替
 */
export type ResourceLayout = ResourceDirs;

/**
 * 根据 cwd 和 homeDir 计算默认的资源目录布局
 *
 * @deprecated 使用 resolveLayout({ resourceRoot }) 代替
 *
 * @param cwd 项目工作目录
 * @param homeDir 用户 home 目录
 * @param configDirName 配置目录名（默认 '.thething'）
 * @returns 默认的资源目录布局
 */
export function buildDefaultResourceLayout(
  cwd: string,
  homeDir: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME
): ResourceLayout {
  const projectDir = path.join(cwd, configDirName);
  const userDir = path.join(homeDir, configDirName);

  return {
    skills:      [path.join(userDir, 'skills'),      path.join(projectDir, 'skills')],
    agents:      [path.join(userDir, 'agents'),      path.join(projectDir, 'agents')],
    mcps:        [path.join(userDir, 'mcps'),        path.join(projectDir, 'mcps')],
    connectors:  [                                    path.join(projectDir, 'connectors')],
    permissions: [path.join(userDir, 'permissions'), path.join(projectDir, 'permissions')],
    memory:      [                                    path.join(projectDir, 'memory')],
  };
}