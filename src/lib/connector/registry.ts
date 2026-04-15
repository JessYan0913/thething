// ============================================================
// Connector 注册表 - 管理所有 Connector 的加载和调用
// ============================================================

import fs from 'fs'
import path from 'path'
import type {
  ConnectorManifest,
  ConnectorConfig,
  ToolCallRequest,
  ToolCallResponse,
  ToolDefinition,
} from './types'
import { TokenManager } from './token-manager'

// Connector 注册表清单
interface ConnectorRegistryData {
  version: string
  connectors: {
    id: string
    manifest_path: string
    config_path: string
    enabled: boolean
  }[]
}

export class ConnectorRegistry {
  private manifests = new Map<string, ConnectorManifest>()
  private configs = new Map<string, ConnectorConfig>()
  private tokenManager: TokenManager

  constructor(
    private configDir: string,
    private getCredentials: (connectorId: string) => Promise<Record<string, string>>
  ) {
    this.tokenManager = new TokenManager(getCredentials)
  }

  /**
   * 初始化：加载所有 Connector 配置
   */
  async initialize(): Promise<void> {
    const registryPath = path.join(this.configDir, 'registry.json')

    if (!fs.existsSync(registryPath)) {
      console.log('[ConnectorRegistry] No registry.json found, starting empty')
      return
    }

    const registryData: ConnectorRegistryData = JSON.parse(
      fs.readFileSync(registryPath, 'utf-8')
    )

    console.log(`[ConnectorRegistry] Loading ${registryData.connectors.length} connectors...`)

    for (const entry of registryData.connectors) {
      if (!entry.enabled) {
        continue
      }

      try {
        await this.loadConnector(entry.id, entry.manifest_path, entry.config_path)
      } catch (error) {
        console.error(`[ConnectorRegistry] Failed to load connector ${entry.id}:`, error)
      }
    }

    console.log(`[ConnectorRegistry] Initialized ${this.manifests.size} connectors`)
  }

  /**
   * 加载单个 Connector
   */
  async loadConnector(
    id: string,
    manifestPath: string,
    configPath: string
  ): Promise<void> {
    // 加载 Manifest
    const fullManifestPath = path.join(this.configDir, manifestPath)
    if (!fs.existsSync(fullManifestPath)) {
      throw new Error(`Manifest not found: ${fullManifestPath}`)
    }
    const manifest: ConnectorManifest = JSON.parse(
      fs.readFileSync(fullManifestPath, 'utf-8')
    )

    // 加载 Config
    const fullConfigPath = path.join(this.configDir, configPath)
    if (!fs.existsSync(fullConfigPath)) {
      throw new Error(`Config not found: ${fullConfigPath}`)
    }
    const config: ConnectorConfig = JSON.parse(
      fs.readFileSync(fullConfigPath, 'utf-8')
    )

    // 验证
    if (manifest.id !== id || config.connector_id !== id) {
      throw new Error(`Connector ID mismatch: manifest=${manifest.id}, config=${config.connector_id}, expected=${id}`)
    }

    this.manifests.set(id, manifest)
    this.configs.set(id, config)

    console.log(`[ConnectorRegistry] Loaded connector: ${id} (${manifest.name} v${manifest.version})`)
  }

  /**
   * 获取 Connector Manifest
   */
  getManifest(connectorId: string): ConnectorManifest | undefined {
    return this.manifests.get(connectorId)
  }

  /**
   * 获取 Connector Config
   */
  getConfig(connectorId: string): ConnectorConfig | undefined {
    return this.configs.get(connectorId)
  }

  /**
   * 获取所有已加载的 Connector ID
   */
  getConnectorIds(): string[] {
    return Array.from(this.manifests.keys())
  }

  /**
   * 获取某个 Connector 的工具列表
   */
  getTools(connectorId: string): ToolDefinition[] {
    const manifest = this.manifests.get(connectorId)
    return manifest?.tools || []
  }

  /**
   * 调用 Connector 的工具
   */
  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    const startTime = Date.now()
    const { connector_id, tool_name, tool_input } = request

    // 1. 获取 manifest 和 config
    const manifest = this.manifests.get(connector_id)
    const config = this.configs.get(connector_id)

    if (!manifest) {
      return {
        success: false,
        error: `Connector not found: ${connector_id}`,
      }
    }

    if (!config || !config.enabled) {
      return {
        success: false,
        error: `Connector disabled: ${connector_id}`,
      }
    }

    // 2. 查找工具定义
    const toolDef = manifest.tools.find(t => t.name === tool_name)
    if (!toolDef) {
      return {
        success: false,
        error: `Tool not found: ${tool_name} in connector ${connector_id}`,
      }
    }

    try {
      // 3. 根据 executor 类型执行
      let result: unknown

      switch (toolDef.executor) {
        case 'http': {
          const { HttpExecutor } = await import('./executors/http')
          const executor = new HttpExecutor({
            tokenManager: this.tokenManager,
            getCredentials: this.getCredentials,
          })
          const execResult = await executor.execute(
            connector_id,
            manifest,
            config,
            toolDef.executor_config as any,
            tool_input
          )
          if (!execResult.success) {
            return {
              success: false,
              error: execResult.error,
              metadata: {
                duration_ms: Date.now() - startTime,
                connector_id,
                tool_name,
              },
            }
          }
          result = execResult.data
          break
        }

        case 'mock': {
          const { MockExecutor } = await import('./executors/mock')
          const executor = new MockExecutor()
          const execResult = await executor.execute(
            toolDef.executor_config as any,
            tool_input
          )
          if (!execResult.success) {
            return {
              success: false,
              error: execResult.error,
              metadata: {
                duration_ms: Date.now() - startTime,
                connector_id,
                tool_name,
              },
            }
          }
          result = execResult.data
          break
        }

        default:
          return {
            success: false,
            error: `Unsupported executor type: ${toolDef.executor}`,
          }
      }

      return {
        success: true,
        result,
        metadata: {
          duration_ms: Date.now() - startTime,
          connector_id,
          tool_name,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          duration_ms: Date.now() - startTime,
          connector_id,
          tool_name,
        },
      }
    }
  }

  /**
   * 获取 Token Manager（用于 Webhook 入站处理）
   */
  getTokenManager(): TokenManager {
    return this.tokenManager
  }
}
