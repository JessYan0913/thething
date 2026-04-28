// ============================================================
// Init - 统一初始化入口（已废弃）
// ============================================================
//
// @deprecated 使用 bootstrap() 替代。
// bootstrap() 返回 CoreRuntime，使依赖显式化。
// initAll() 初始化全局可变状态，隐式依赖。
//
// 新 API 示例：
// ```typescript
// const runtime = await bootstrap({ dataDir: './data' });
// const context = await createContext({ runtime, cwd });
// const { agent } = await createAgent({ context, ... });
// ```

import { configureDataStore } from './foundation/datastore';
import { initPermissions } from './extensions/permissions';
import { initConnectorGateway } from './extensions/connector';
import { resolveProjectDir } from './foundation/paths';
import path from 'path';
import type { InitConfig } from './config/types';

export type { InitConfig };

/**
 * 全局初始化（已废弃）
 *
 * @deprecated 使用 bootstrap() 替代。
 * 此函数初始化全局可变状态，导致隐式顺序依赖。
 *
 * @param config 初始化配置
 */
export async function initAll(config: InitConfig): Promise<void> {
  const projectDir = config.cwd ?? resolveProjectDir({
    monorepoPatterns: ['packages/server', 'packages/cli'],
  });

  configureDataStore({
    dataDir: config.dataDir,
    ...config.databaseConfig,
  });

  await initPermissions(projectDir).catch((err) => {
    console.error('[Permissions] Init failed:', err);
  });

  // 使用项目目录作为默认 connectors 目录
  const defaultConnectorsDir = path.join(projectDir, 'connectors');
  await initConnectorGateway({
    enableInbound: true,
    configDir: defaultConnectorsDir,
    ...config.connectorConfig,
  }).catch((err) => {
    console.error('[ConnectorGateway] Init failed:', err);
  });
}