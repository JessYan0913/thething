// ============================================================
// Init - 统一初始化入口
// ============================================================

import { configureDatabase, type DatabaseConfig } from './db'
import { initPermissions } from './permissions'
import { initConnectorGateway, type ConnectorGatewayConfig } from './connector'

export interface InitConfig {
  dataDir: string
  databaseConfig?: DatabaseConfig
  connectorConfig?: ConnectorGatewayConfig
}

export async function initAll(config: InitConfig): Promise<void> {
  configureDatabase({
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