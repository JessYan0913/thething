// ============================================================
// Bootstrap - 显式初始化核心基础设施
// ============================================================
//
// 这是使用 core 包的强制第一步（新 API）。
// 所有后续操作（createContext、createAgent）都以此为入参，
// 确保依赖显式、顺序可推断。

import { createSQLiteDataStore, type DataStore, type SQLiteDataStoreConfig } from './foundation/datastore';
import { getConnectorRegistry, shutdownConnectorGateway, initConnectorGateway, type ConnectorGatewayConfig, type ConnectorRegistry } from './extensions/connector';
import { initPermissions } from './extensions/permissions';
import { resolveProjectDir } from './foundation/paths';
import {
  registerTokenizer,
  setTokenizerDir,
  setAutoDownload,
  preloadTokenizer,
} from './runtime/compaction/tokenizer';
import { configurePricing, type ModelPricing } from './foundation/model/pricing';
import { waitForAllCompactions } from './runtime/compaction/background-queue';
import { initGlobalTaskStoreFromDataStore } from './runtime/tasks/store';

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
// 核心运行时类型
// ============================================================

/**
 * 核心运行时句柄。
 * 通过 bootstrap() 创建，代表"已就绪的基础设施"。
 * AppContext 和 Agent 的创建都依赖此对象。
 */
export interface CoreRuntime {
  /** 数据目录 */
  readonly dataDir: string;
  /** 数据存储实例 */
  readonly dataStore: DataStore;
  /** Connector Registry 实例 */
  readonly connectorRegistry: ConnectorRegistry;
  /** 项目工作目录 */
  readonly cwd: string;
  /** 销毁所有资源（关闭数据库连接、停止 gateway 等） */
  dispose(): Promise<void>;
}

/**
 * Bootstrap 配置选项
 */
export interface BootstrapOptions {
  /** 数据目录（必填） */
  dataDir: string;
  /** 项目目录（可选，默认使用 resolveProjectDir） */
  cwd?: string;
  /** 数据库配置 */
  databaseConfig?: SQLiteDataStoreConfig;
  /** Connector Gateway 配置 */
  connectorConfig?: ConnectorGatewayConfig;
  /** Tokenizer 配置 */
  tokenizerConfig?: TokenizerConfig;
  /**
   * 模型定价覆盖配置
   *
   * 覆盖内置定价表 DEFAULT_PRICING。
   * 键为模型名，值为 USD/百万 token。
   *
   * @example
   * modelPricing: {
   *   'qwen-max': { input: 3.5, output: 10, cached: 0.8 }
   * }
   */
  modelPricing?: Record<string, ModelPricing>;
}

/**
 * 初始化核心基础设施，返回运行时句柄。
 *
 * 这是使用 core 包（新 API）的强制第一步。
 * 所有后续操作（createContext、createAgent）都以此为入参，
 * 确保依赖显式、顺序可推断。
 *
 * @example
 * const runtime = await bootstrap({ dataDir: './data' });
 * const context = await createContext({ runtime, cwd });
 * const { agent } = await createAgent({ context });
 * // ...
 * await runtime.dispose();
 */
export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  // 定价配置最先执行，确保后续所有 CostTracker 使用正确数据
  if (options.modelPricing) {
    configurePricing(options.modelPricing);
  }

  const cwd = options.cwd ?? resolveProjectDir();

  // 初始化数据存储
  const dataStore = createSQLiteDataStore({
    dataDir: options.dataDir,
    ...options.databaseConfig,
  });

  // 初始化全局 TaskStore（使用 DataStore 的持久化 taskStore）
  initGlobalTaskStoreFromDataStore(dataStore);

  // 初始化权限系统
  await initPermissions(cwd).catch((err) => {
    console.error('[Bootstrap] Permissions init failed:', err);
  });

  // 初始化 Connector Gateway
  await initConnectorGateway({
    enableInbound: true,
    cwd,
    dataStore,
    ...options.connectorConfig,
  }).catch((err) => {
    console.error('[Bootstrap] ConnectorGateway init failed:', err);
  });

  // 获取 Connector Registry
  const connectorRegistry = await getConnectorRegistry(cwd);

  // 初始化 Tokenizer（显式配置，不依赖环境变量）
  initTokenizer(options.tokenizerConfig);

  return {
    dataDir: options.dataDir,
    dataStore,
    connectorRegistry,
    cwd,
    async dispose() {
      // 1. 等待所有后台压缩完成，避免关闭数据库时写入失败
      await waitForAllCompactions();

      // 2. 关闭 Connector Gateway
      await shutdownConnectorGateway();

      // 3. 关闭数据库连接
      dataStore.close();
    },
  };
}

// ============================================================
// Tokenizer 初始化辅助函数
// ============================================================

/**
 * 初始化 Tokenizer（内部函数）
 *
 * 设计约束：
 * - 不读取 process.env（配置已通过 BootstrapOptions 显式传入）
 * - 配置优先级：registrations > dir > 默认行为
 */
function initTokenizer(config?: TokenizerConfig): void {
  if (!config) return;

  // 1. 禁用自动下载（如果指定）
  if (config.disableAutoDownload) {
    setAutoDownload(false);
  }

  // 2. 设置 tokenizer 目录（全局覆盖）
  if (config.dir) {
    setTokenizerDir(config.dir);
    console.log(`[Bootstrap] Tokenizer 目录已设置: ${config.dir}`);
  }

  // 3. 注册单个模型（精确映射）
  if (config.registrations && config.registrations.length > 0) {
    for (const { modelName, path } of config.registrations) {
      registerTokenizer(modelName, path);
      console.log(`[Bootstrap] Tokenizer 注册: ${modelName} -> ${path}`);
    }
  }

  // 4. 预加载模型（可选，避免首次使用延迟）
  if (config.preloadModels && config.preloadModels.length > 0) {
    // 异步预加载，不阻塞 bootstrap
    Promise.all(config.preloadModels.map(model => preloadTokenizer(model)))
      .then(() => {
        console.log(`[Bootstrap] Tokenizer 预加载完成: ${config.preloadModels!.join(', ')}`);
      })
      .catch(err => {
        console.error('[Bootstrap] Tokenizer 预加载失败:', err);
      });
  }
}