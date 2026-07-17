// ============================================================
// Bootstrap - 显式初始化核心基础设施
// ============================================================
//
// 这是使用 core 包的强制第一步（新 API）。
// 所有后续操作（createContext、createAgent）都以此为入参，
// 确保依赖显式、顺序可推断。

import { createSQLiteDataStore, type DataStore, type SQLiteDataStoreConfig } from '../services/datastore';
import {
  createConnectorRuntime,
  initializeConnectorRuntime,
  disposeConnectorRuntime,
  type ConnectorRuntime,
  type ConnectorRuntimeConfig,
  type ConnectorRegistry,
} from '../modules/connector';
import type { ConnectorInboundRuntime } from '../modules/connector/inbound/types';
import { CronScheduler, SQLiteCronJobStore, type CronJobStore } from '../modules/cron';
import { createPricingResolver, type PricingResolver } from '../services/model/pricing';
import { resolveLayout, type LayoutConfig, type ResolvedLayout } from '../services/config/layout';
import { buildBehaviorConfig, type BehaviorConfig } from '../services/config/behavior';
import { setDebugEnabled, logger } from '../primitives/logger';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// ============================================================
// Tokenizer 配置类型
// ============================================================

/**
 * Tokenizer 配置选项
 *
 * 符合设计原则：配置显式传入，不依赖环境变量
 */
export interface TokenizerConfig {
  /** tokenizer 目录（所有模型从该目录加载） */
  dir?: string;
  /** 单个模型注册（精确映射到本地文件） */
  registrations?: Array<{
    modelName: string;
    path: string;
  }>;
  /** 禁用自动下载（仅使用已配置的 tokenizer） */
  disableAutoDownload?: boolean;
  /** 预加载模型列表（启动时加载，避免首次使用延迟） */
  preloadModels?: string[];
}

// ============================================================
// Bootstrap 配置类型（重构）
// ============================================================

/**
 * Bootstrap 配置选项
 *
 * 新结构：layout 必填，behavior 可选（全部使用默认值）
 *
 * @example
 * // 最简场景（全部默认值）
 * const runtime = await bootstrap({
 *   layout: { resourceRoot: process.cwd() }
 * });
 *
 * @example
 * // 替换应用名
 * const runtime = await bootstrap({
 *   layout: {
 *     resourceRoot: process.cwd(),
 *     configDir: path.join(os.homedir(), '.myapp')
 *   }
 * });
 *
 * @example
 * // 企业部署（数据与代码分离 + 调整预算）
 * const runtime = await bootstrap({
 *   layout: {
 *     resourceRoot: process.cwd(),
 *     configDir: path.join(os.homedir(), '.myapp'),
 *     dataDir: '/var/lib/myapp/data'
 *   },
 *   behavior: {
 *     maxBudgetUsdPerSession: 20.0,
 *     maxStepsPerSession: 100
 *   }
 * });
 */
export interface BootstrapOptions {
  /** 布局配置（必填） */
  layout: LayoutConfig;
  /** 行为配置（可选，不传则全部使用默认值） */
  behavior?: Partial<BehaviorConfig>;
  /** 环境变量快照（由应用层显式传入） */
  env?: Record<string, string | undefined>;
  /** 是否启用调试日志（默认 false） */
  debug?: boolean;
  /** 自定义 DataStore 实例（可选，替换默认 SQLite 实现） */
  dataStore?: DataStore;
  /** 数据库配置（可选，仅当使用默认 SQLite 时生效） */
  databaseConfig?: SQLiteDataStoreConfig;
  /** Connector Runtime 配置（可选） */
  connectorConfig?: Partial<ConnectorRuntimeConfig>;
  /** Tokenizer 配置（可选） */
  tokenizerConfig?: TokenizerConfig;
}

// ============================================================
// 核心运行时类型（重构）
// ============================================================

/**
 * 核心运行时句柄。
 * 通过 bootstrap() 创建，代表"已就绪的基础设施"。
 * AppContext 和 Agent 的创建都依赖此对象。
 */
export interface CoreRuntime {
  /** 展开后的布局（所有路径已解析为绝对路径） */
  readonly layout: ResolvedLayout;
  /** 完整行为配置（所有字段已填充默认值） */
  readonly behavior: BehaviorConfig;
  /** 数据存储实例 */
  readonly dataStore: DataStore;
  /** Connector Registry 实例 */
  readonly connectorRegistry: ConnectorRegistry;
  /** Connector Runtime 实例 */
  readonly connectorRuntime: ConnectorRuntime;
  /** 环境变量快照 */
  readonly env: Record<string, string | undefined>;
  /** 定价解析器实例 */
  readonly pricingResolver: PricingResolver;
  /** Connector 入站运行时 */
  readonly connectorInbound: ConnectorInboundRuntime | null;
  /** Cron 调度器 */
  readonly cronScheduler: CronScheduler | null;
  /** Cron 任务存储 */
  readonly cronStore: CronJobStore | null;
  /** 用户级 tasks 目录（~/.agents/tasks），供 cron 工具写 task.md 文件 */
  readonly tasksDir: string;
  /** 销毁所有资源（关闭数据库连接、停止 gateway 等） */
  dispose(): Promise<void>;
}

/**
 * 初始化核心基础设施，返回运行时句柄。
 *
 * 这是使用 core 包的强制第一步。
 * 所有后续操作（createContext、createAgent）都以此为入参，
 * 确保依赖显式、顺序可推断。
 *
 * @example
 * // 新 API
 * const runtime = await bootstrap({
 *   layout: { resourceRoot: process.cwd() }
 * });
 * const context = await createContext({ runtime });
 * const { agent } = await createAgent({ context });
 * await runtime.dispose();
 *
 * @example
 * // 兼容旧字段写法（建议迁移到 layout）
 * const runtime = await bootstrap({
 *   dataDir: './data',
 *   cwd: process.cwd()
 * });
 */
export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  // 1. 解析布局
  if (!options.layout) {
    throw new Error('[Bootstrap] layout is required. Provide layout: { resourceRoot: ... }');
  }
  const layout = resolveLayout(options.layout);
  const env = Object.freeze({ ...(options.env ?? {}) });

  // 初始化日志系统（优先使用显式 debug 参数，其次 fallback 到 env.DEBUG）
  setDebugEnabled(options.debug ?? Boolean(env.DEBUG));

  // 1b. 确保 ~/.agents → ~/.thething symlink 存在（Dot Agents 协议兼容）
  await ensureDotAgentsSymlink(layout.configDir);

  // 2. 构建行为配置
  const behavior = buildBehaviorConfig(options.behavior);

  // 3. 创建定价解析器（实例级，避免多次 bootstrap 互相污染）
  const pricingResolver = createPricingResolver(behavior.modelPricing, behavior.availableModels);

  // 4. 初始化数据存储
  // 如果传入自定义 DataStore，直接使用；否则创建默认 SQLite 实现
  const dataStore = options.dataStore ?? createSQLiteDataStore({
    dataDir: layout.dataDir,
    ...options.databaseConfig,
  });

  // 5. 初始化 Connector Runtime（只加载 Registry；Inbound handler 在应用层有 AppContext 后绑定）
  const { default: path } = await import('path');
  const connectorConfigDir = options.connectorConfig?.configDir
    ?? layout.resources.connectors[layout.resources.connectors.length - 1]
    ?? path.join(layout.resourceRoot, layout.configDirName, 'connectors');
  const connectorRuntime = createConnectorRuntime({
    cwd: layout.resourceRoot,
    configDir: connectorConfigDir,
    dataDir: layout.dataDir,
    userId: options.connectorConfig?.userId,
    model: options.connectorConfig?.model,
    appContext: options.connectorConfig?.appContext,
  });
  await initializeConnectorRuntime(connectorRuntime, { startConsumer: false }).catch((err) => {
    logger.error('Bootstrap', 'ConnectorRuntime init failed:', err);
  });

  const connectorRegistry = connectorRuntime.registry;

  // 6. Cron Scheduler（创建但不启动，启动在应用层绑定 Agent handler 之后）
  let cronStore: CronJobStore | null = null;
  let cronScheduler: CronScheduler | null = null;
  const userTasksDir = path.join(os.homedir(), '.thething', 'tasks');
  if (connectorRuntime.inbound) {
    cronStore = new SQLiteCronJobStore({ dataDir: layout.dataDir });
    cronScheduler = new CronScheduler({
      store: cronStore,
      inbox: connectorRuntime.inbound.inbox,
    });

    // 从 ~/.thething/tasks/<name>/task.md 同步任务定义
    const { loadTasksFromFiles } = await import('../modules/cron/task-loader');
    await loadTasksFromFiles({
      store: cronStore,
      userDir: userTasksDir,
      projectDir: path.join(layout.resourceRoot, layout.configDirName, 'tasks'),
    });
  }

  return {
    layout,
    behavior,
    dataStore,
    connectorRegistry,
    connectorRuntime,
    env,
    pricingResolver,
    connectorInbound: connectorRuntime.inbound,
    cronScheduler,
    cronStore,
    tasksDir: userTasksDir,
    async dispose() {
      cronScheduler?.stop();
      cronStore?.close();
      await disposeConnectorRuntime(connectorRuntime);
      dataStore.close();
    },
  };
}

// ============================================================
// Tokenizer 初始化辅助函数（已废弃，保留接口兼容）
// ============================================================

function initTokenizer(_config?: TokenizerConfig): void {
  // 已替换为字符估算，无需初始化
}

// ============================================================
// Dot Agents 协议兼容 symlink
// ============================================================

/**
 * 确保 ~/.agents → configDir 的 symlink 存在。
 *
 * Agent Skills 生态工具（如 `npx agent skill add`）默认读写 ~/.agents/ 目录。
 * 通过 ~/.agents → ~/.thething symlink，这些工具的操作透明地映射到 TheThing 的数据目录。
 *
 * 行为：
 * - ~/.agents 不存在 → 创建 symlink 指向 configDir
 * - ~/.agents 已是 symlink 且指向 configDir → 无操作
 * - ~/.agents 已是 symlink 但指向其他路径 → 打印警告，不覆盖
 * - ~/.agents 作为普通文件/目录存在 → 打印警告，不覆盖
 * - 创建失败（如 Windows 无权限） → 静默跳过，不阻塞启动
 */
async function ensureDotAgentsSymlink(configDir: string): Promise<void> {
  const homeDir = os.homedir();
  const agentsPath = path.join(homeDir, '.agents');

  try {
    // 检查 ~/.agents 当前状态
    const stat = await fs.lstat(agentsPath).catch(() => null);

    if (stat === null) {
      // 不存在 → 创建 symlink
      await fs.symlink(configDir, agentsPath, 'dir');
      logger.info('Bootstrap', `Created symlink: ${agentsPath} → ${configDir}`);
      return;
    }

    // 已存在且是 symlink
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(agentsPath);
      if (target === configDir) {
        // 指向正确，无操作
        logger.debug('Bootstrap', `Symlink already exists: ${agentsPath} → ${configDir}`);
      } else {
        // 指向其他路径，警告但不覆盖
        logger.warn('Bootstrap', `Symlink ${agentsPath} already points to ${target}, not ${configDir}. Remove it manually to recreate.`);
      }
      return;
    }

    // 已存在但是普通文件或目录，不覆盖
    logger.warn('Bootstrap', `${agentsPath} already exists and is not a symlink. Agent Skills ecosystem tools may not work correctly.`);
  } catch (error) {
    // 创建失败（Windows 无权限等），不阻塞启动
    logger.debug('Bootstrap', `Failed to create ${agentsPath} symlink: ${(error as Error).message}`);
  }
}

// ============================================================
// Project Layout 辅助函数
// ============================================================

/**
 * 根据项目路径创建一个新的 ResolvedLayout。
 *
 * 当对话关联了项目时，用项目的 path 作为 resourceRoot 重新解析 layout，
 * 加载该目录下的配置资源（skills、agents、mcps 等，来自 .agents/）。
 *
 * @param baseLayout - 基础 layout（提供 configDir 等配置）
 * @param projectPath - 项目的本地目录绝对路径
 * @returns 新的 ResolvedLayout，resourceRoot 指向项目目录
 */
export function resolveProjectLayout(
  baseLayout: ResolvedLayout,
  projectPath: string,
): ResolvedLayout {
  return resolveLayout({
    resourceRoot: projectPath,
    configDir: baseLayout.configDir,
    dataDir: baseLayout.dataDir,
    contextFileNames: baseLayout.contextFileNames,
  });
}
