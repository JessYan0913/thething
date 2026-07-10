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
import { PERMISSIONS_FILENAME } from './defaults';
import { DEFAULT_DB_FILENAME } from '../datastore/constants';

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
  /** Wiki 目录列表 */
  wiki: readonly string[];
}

/**
 * 文件系统布局配置（调用方输入）
 *
 * @example
 * // 最简场景
 * const layout: LayoutConfig = { resourceRoot: process.cwd(), configDir: path.join(os.homedir(), '.myapp') };
 *
 * @example
 * // 企业部署（数据与代码分离）
 * const layout: LayoutConfig = {
 *   resourceRoot: process.cwd(),
 *   configDir: '/var/lib/myapp',
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
   * 配置目录（绝对路径，如 ~/.thething）
   *
   * TheThing 以 ~/.thething 为唯一数据目录，通过 ~/.agents → ~/.thething symlink 兼容
   * Dot Agents Protocol（https://dotagentsprotocol.com/）和 Agent Skills（https://agentskills.io）。
   *
   *   配置来源（skills/agents/mcps）：<configDir>/<subcategory>
   *   运行时数据（connectors/permissions/data/wiki）：<configDir>/<subcategory>
   *
   * 默认数据目录：<configDir>/data（可被 dataDir 覆盖）
   */
  configDir: string;

  /**
   * 运行时数据目录（数据库、工具结果缓存等）
   * 不传时默认为 ~/<configDirName>/data
   *
   * 独立配置此字段可以把数据与代码分离（符合 12-factor app 原则）
   */
  dataDir?: string;

  /**
   * 各类资源的目录列表（绝对路径，按优先级从低到高排列）
   *
   * 不传时由 configDir 自动派生：
   *   skills: ['<configDir>/skills', '<resourceRoot>/<basename(configDir)>/skills']
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
  /** 用户配置目录（绝对路径） */
  readonly configDir: string;
  /** 配置目录名（由 configDir 派生，如 .agents） */
  readonly configDirName: string;
  /** 数据目录 */
  readonly dataDir: string;
  /** 资源目录列表 */
  readonly resources: Readonly<ResourceDirs>;
  /** 项目上下文文件名列表 */
  readonly contextFileNames: readonly string[];
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
 * TheThing 以 ~/.thething 为唯一数据目录，所有资源从 configDir 下读取。
 * 通过 ~/.agents → ~/.thething symlink 兼容 Dot Agents Protocol 和 Agent Skills 生态。
 *
 * 这是一个纯函数：给定相同输入，始终返回相同输出
 *
 * @param config - 布局配置
 * @returns 展开后的布局（所有路径已解析为绝对路径）
 *
 * @example
 * const layout = resolveLayout({ resourceRoot: process.cwd(), configDir: path.join(os.homedir(), '.thething') });
 * // layout.configDir === '~/.thething'
 * // layout.configDirName === '.thething'
 * // layout.dataDir === '~/.thething/data'
 */
export function resolveLayout(config: LayoutConfig): ResolvedLayout {
  const { resourceRoot, configDir } = config;
  const configDirName = path.basename(configDir);

  const projectDir = path.join(resourceRoot, configDirName);
  const userDir = configDir;
  const dataDir = config.dataDir ?? path.join(configDir, 'data');

  // 所有资源统一从 configDir（~/.thething）读取
  // 通过 ~/.agents → ~/.thething symlink 兼容 Agent Skills 生态
  const defaultResources: ResourceDirs = {
    skills:      [path.join(userDir, 'skills'),      path.join(projectDir, 'skills')],
    agents:      [path.join(userDir, 'agents'),      path.join(projectDir, 'agents')],
    mcps:        [],  // MCP 仅从 configDir/mcp.json 读取，不扫描子目录
    connectors:  [path.join(userDir, 'connectors'),  path.join(projectDir, 'connectors')],
    permissions: [path.join(userDir, 'permissions'), path.join(projectDir, 'permissions')],
    wiki:        [path.join(userDir, 'wiki'),        path.join(projectDir, 'wiki')],
  };

  return Object.freeze({
    resourceRoot,
    configDir,
    configDirName,
    dataDir,
    resources: Object.freeze({ ...defaultResources, ...config.resources }),
    contextFileNames: Object.freeze(config.contextFileNames ?? ['THING.md', 'CONTEXT.md']),
    filenames: Object.freeze({
      permissions: PERMISSIONS_FILENAME,
      db: DEFAULT_DB_FILENAME,
    }),
  });
}
