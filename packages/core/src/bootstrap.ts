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
import { resolveProjectDir, setResolvedConfigDirName, setResolvedCwd } from './foundation/paths';
import {
  registerTokenizer,
  setTokenizerDir,
  setAutoDownload,
  preloadTokenizer,
} from './runtime/compaction/tokenizer';
import { configurePricing } from './foundation/model/pricing';
import { waitForAllCompactions } from './runtime/compaction/background-queue';
import { initGlobalTaskStoreFromDataStore } from './runtime/tasks/store';
import { resolveLayout, type LayoutConfig, type ResolvedLayout } from './config/layout';
import { buildBehaviorConfig, type BehaviorConfig } from './config/behavior';
import path from 'path';

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
 *     configDirName: '.myapp'
 *   }
 * });
 *
 * @example
 * // 企业部署（数据与代码分离 + 调整预算）
 * const runtime = await bootstrap({
 *   layout: {
 *     resourceRoot: process.cwd(),
 *     configDirName: '.myapp',
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
  /** 自定义 DataStore 实例（可选，替换默认 SQLite 实现） */
  dataStore?: DataStore;
  /** 数据库配置（可选，仅当使用默认 SQLite 时生效） */
  databaseConfig?: SQLiteDataStoreConfig;
  /** Connector Gateway 配置（可选） */
  connectorConfig?: ConnectorGatewayConfig;
  /** Tokenizer 配置（可选） */
  tokenizerConfig?: TokenizerConfig;

  // ── 向后兼容（deprecated）──────────────────────────────────

  /**
   * @deprecated 使用 layout.resourceRoot 代替
   * 项目目录（可选，默认使用 resolveProjectDir）
   */
  cwd?: string;

  /**
   * @deprecated 使用 layout.dataDir 代替
   * 数据目录（必填，现改为 layout 配置）
   */
  dataDir?: string;
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
 * // 向后兼容 API（deprecated）
 * const runtime = await bootstrap({
 *   dataDir: './data',
 *   cwd: process.cwd()
 * });
 */
export async function bootstrap(options: BootstrapOptions): Promise<CoreRuntime> {
  // ── 处理向后兼容 ──────────────────────────────────────────
  // 如果使用旧的 dataDir/cwd 参数，自动转换为 layout
  let layoutConfig: LayoutConfig;
  if (options.layout) {
    layoutConfig = options.layout;
  } else if (options.dataDir) {
    // 向后兼容：从旧参数构建 layout
    layoutConfig = {
      resourceRoot: options.cwd ?? resolveProjectDir(),
      dataDir: options.dataDir,
    };
  } else {
    // 必须提供 layout
    throw new Error('[Bootstrap] layout is required. Provide layout: { resourceRoot: ... }');
  }

  // 1. 解析布局
  const layout = resolveLayout(layoutConfig);

  // 1.1. 设置全局 configDirName 和 cwd（让所有 get* 便捷函数使用正确的值）
  setResolvedConfigDirName(layout.configDirName);
  setResolvedCwd(layout.resourceRoot);
  console.log(`[Bootstrap] configDirName set to: ${layout.configDirName}`);
  console.log(`[Bootstrap] cwd set to: ${layout.resourceRoot}`);

  // 2. 构建行为配置
  const behavior = buildBehaviorConfig(options.behavior);

  // 3. 定价配置注入（必须最先执行，确保后续所有 CostTracker 使用正确数据）
  if (behavior.modelPricing) {
    configurePricing(behavior.modelPricing);
  }

  // 4. 初始化数据存储
  // 如果传入自定义 DataStore，直接使用；否则创建默认 SQLite 实现
  const dataStore = options.dataStore ?? createSQLiteDataStore({
    dataDir: layout.dataDir,
    ...options.databaseConfig,
  });

  // 5. 初始化全局 TaskStore（使用 DataStore 的持久化 taskStore）
  initGlobalTaskStoreFromDataStore(dataStore);

  // 6. 初始化权限系统（使用全局 configDirName，传入 filename）
  await initPermissions(layout.resourceRoot, layout.filenames.permissions).catch((err) => {
    console.error('[Bootstrap] Permissions init failed:', err);
  });

  // 7. 初始化 Connector Gateway（仅 Registry，Inbound 在应用层初始化）
  await initConnectorGateway({
    enableInbound: false,  // Bootstrap 只初始化 Registry，Inbound 需要 AppContext
    cwd: layout.resourceRoot,
    idempotencyDbPath: path.join(layout.dataDir, '.connector-idempotency.db'),
    ...options.connectorConfig,
  }).catch((err) => {
    console.error('[Bootstrap] ConnectorGateway init failed:', err);
  });

  // 8. 获取 Connector Registry（使用全局 configDirName）
  const connectorRegistry = await getConnectorRegistry(layout.resourceRoot);

  // 9. 初始化 Tokenizer（显式配置，不依赖环境变量）
  initTokenizer(options.tokenizerConfig);

  return {
    layout,
    behavior,
    dataStore,
    connectorRegistry,
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