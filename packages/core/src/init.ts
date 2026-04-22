// ============================================================
// Init - 统一初始化入口
// ============================================================

import { configureDataStore } from './foundation/datastore';
import { initPermissions } from './extensions/permissions';
import { initConnectorGateway } from './extensions/connector';
import { detectProjectDir } from './foundation/paths';
import path from 'path';
import type { InitConfig } from './config/types';

export type { InitConfig };

export async function initAll(config: InitConfig): Promise<void> {
  const projectDir = config.cwd ?? detectProjectDir();

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