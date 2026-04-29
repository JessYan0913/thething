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
  const cwd = options.cwd ?? resolveProjectDir();

  // 初始化数据存储
  const dataStore = createSQLiteDataStore({
    dataDir: options.dataDir,
    ...options.databaseConfig,
  });

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

  return {
    dataDir: options.dataDir,
    dataStore,
    connectorRegistry,
    cwd,
    async dispose() {
      await shutdownConnectorGateway();
      dataStore.close();
    },
  };
}