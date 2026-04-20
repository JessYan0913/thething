// ============================================================
// Init - 统一初始化入口
// ============================================================

import { configureDataStore, type SQLiteDataStoreConfig } from './datastore'
import { initPermissions } from './permissions'
import { initConnectorGateway, type ConnectorGatewayConfig } from './connector'

export interface InitConfig {
  dataDir: string
  databaseConfig?: SQLiteDataStoreConfig
  connectorConfig?: ConnectorGatewayConfig
}

export async function initAll(config: InitConfig): Promise<void> {
  configureDataStore({
    dataDir: config.dataDir,
    ...config.databaseConfig,
  })

  await initPermissions().catch((err) => {
    console.error('[Permissions] Init failed:', err)
  })

  await initConnectorGateway({
    enableInbound: true,
    ...config.connectorConfig,
  }).catch((err) => {
    console.error('[ConnectorGateway] Init failed:', err)
  })
}