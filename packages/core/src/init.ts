// ============================================================
// Init - 统一初始化入口
// ============================================================

import { configureDataStore, type SQLiteDataStoreConfig } from './datastore'
import { initPermissions } from './permissions'
import { initConnectorGateway, type ConnectorGatewayConfig } from './connector'
import { getProjectDir } from './config'
import path from 'path'

export interface InitConfig {
  dataDir: string
  cwd?: string
  databaseConfig?: SQLiteDataStoreConfig
  connectorConfig?: ConnectorGatewayConfig
}

export async function initAll(config: InitConfig): Promise<void> {
  const projectDir = config.cwd ?? getProjectDir()

  configureDataStore({
    dataDir: config.dataDir,
    ...config.databaseConfig,
  })

  await initPermissions(projectDir).catch((err) => {
    console.error('[Permissions] Init failed:', err)
  })

  // 使用项目目录作为默认 connectors 目录
  const defaultConnectorsDir = path.join(projectDir, 'connectors')
  await initConnectorGateway({
    enableInbound: true,
    configDir: defaultConnectorsDir,
    ...config.connectorConfig,
  }).catch((err) => {
    console.error('[ConnectorGateway] Init failed:', err)
  })
}