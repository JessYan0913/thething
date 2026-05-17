// ============================================================
// Bootstrap - 显式初始化核心基础设施
// ============================================================
//
// 这是使用 core 包的强制第一步（新 API）。
// 所有后续操作（createContext、createAgent）都以此为入参，
// 确保依赖显式、顺序可推断。

import { createSQLiteDataStore, type DataStore, type SQLiteDataStoreConfig } from './foundation/datastore';
import {
  createConnectorRuntime,
  initializeConnectorRuntime,
  disposeConnectorRuntime,
  type ConnectorRuntime,
  type ConnectorRuntimeConfig,
  type ConnectorRegistry,
} from './extensions/connector';
import type { ConnectorInboundRuntime } from './extensions/connector/inbound/types';
import {
  registerTokenizer,
  setTokenizerDir,
  setAutoDownload,
  preloadTokenizer,
} from './runtime/compaction/tokenizer';
import { createPricingResolver, type PricingResolver } from './foundation/model/pricing';
import { waitForAllCompactions } from './runtime/compaction/background-queue';
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
  /** 环境变量快照（由应用层显式传入） */
  env?: Record<string, string | undefined>;
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

  // 2. 构建行为配置
  const behavior = buildBehaviorConfig(options.behavior);

  // 3. 创建定价解析器（实例级，避免多次 bootstrap 互相污染）
  const pricingResolver = createPricingResolver(behavior.modelPricing);

  // 4. 初始化数据存储
  // 如果传入自定义 DataStore，直接使用；否则创建默认 SQLite 实现
  const dataStore = options.dataStore ?? createSQLiteDataStore({
    dataDir: layout.dataDir,
    ...options.databaseConfig,
  });

  // 5. 初始化 Connector Runtime（只加载 Registry；Inbound handler 在应用层有 AppContext 后绑定）
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
    env: options.connectorConfig?.env ?? env,
    debugEnabled: options.connectorConfig?.debugEnabled ?? Boolean(env.DEBUG),
    allowUnsafeScriptExecutor: options.connectorConfig?.allowUnsafeScriptExecutor,
  });
  await initializeConnectorRuntime(connectorRuntime, { startConsumer: false }).catch((err) => {
    console.error('[Bootstrap] ConnectorRuntime init failed:', err);
  });

  const connectorRegistry = connectorRuntime.registry;

  // 6. 初始化 Tokenizer（显式配置，不依赖环境变量）
  initTokenizer(options.tokenizerConfig);

  return {
    layout,
    behavior,
    dataStore,
      connectorRegistry,
      connectorRuntime,
      env,
      pricingResolver,
      connectorInbound: connectorRuntime.inbound,
    async dispose() {
      // 1. 等待所有后台压缩完成，避免关闭数据库时写入失败
      await waitForAllCompactions();

      // 2. 关闭 Connector Runtime
      await disposeConnectorRuntime(connectorRuntime);

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
