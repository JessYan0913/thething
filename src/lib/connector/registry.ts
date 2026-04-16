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
  HttpExecutorConfig,
  MockExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
} from './types'
import { TokenManager } from './token-manager'
import { CircuitBreakerRegistry, CircuitBreakerError } from './circuit-breaker'
import { AuditLogger } from './audit-logger'
import { withRetry } from './retry'

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

export interface ConnectorRegistryOptions {
  getDbPath?: (connectionId: string) => Promise<string>
  enableRetry?: boolean
  enableCircuitBreaker?: boolean
}

export class ConnectorRegistry {
  private manifests = new Map<string, ConnectorManifest>()
  private configs = new Map<string, ConnectorConfig>()
  private tokenManager: TokenManager
  private circuitBreakers: CircuitBreakerRegistry
  private auditLogger: AuditLogger
  private options: Required<ConnectorRegistryOptions>

  private sqlExecutorCache: Map<string, import('./executors/sql').SqlExecutor> = new Map()

  constructor(
    private configDir: string,
    private getCredentials: (connectorId: string) => Promise<Record<string, string>>,
    options?: ConnectorRegistryOptions
  ) {
    this.tokenManager = new TokenManager(getCredentials)
    this.circuitBreakers = new CircuitBreakerRegistry()
    this.auditLogger = new AuditLogger()
    this.options = {
      getDbPath: options?.getDbPath ?? (async () => { throw new Error('getDbPath not configured') }),
      enableRetry: options?.enableRetry ?? true,
      enableCircuitBreaker: options?.enableCircuitBreaker ?? true,
    }
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

    // 3. 检查熔断器
    if (this.options.enableCircuitBreaker) {
      const breaker = this.circuitBreakers.get(connector_id)
      try {
        return await breaker.execute(async () => {
          return this.executeWithRetry(toolDef, connector_id, manifest, config, tool_input, startTime)
        })
      } catch (error) {
        if (error instanceof CircuitBreakerError) {
          this.auditLogger.logCircuitBreakerTrip(connector_id, error.message)
          return {
            success: false,
            error: `Circuit breaker open for connector ${connector_id}`,
            metadata: {
              duration_ms: Date.now() - startTime,
              connector_id,
              tool_name,
            },
          }
        }
        throw error
      }
    }

    return this.executeWithRetry(toolDef, connector_id, manifest, config, tool_input, startTime)
  }

  private async executeWithRetry(
    toolDef: ToolDefinition,
    connectorId: string,
    manifest: ConnectorManifest,
    config: ConnectorConfig,
    toolInput: Record<string, unknown>,
    startTime: number
  ): Promise<ToolCallResponse> {
    const execute = async () => {
      return this.executeTool(toolDef, connectorId, manifest, config, toolInput, startTime)
    }

    if (this.options.enableRetry && toolDef.retryable) {
      try {
        return await withRetry(execute, {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 10000,
          retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'HTTP 5', 'timeout'],
        }) as ToolCallResponse
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            duration_ms: Date.now() - startTime,
            connector_id: connectorId,
            tool_name: toolDef.name,
          },
        }
      }
    }

    return execute()
  }

  private async executeTool(
    toolDef: ToolDefinition,
    connectorId: string,
    manifest: ConnectorManifest,
    config: ConnectorConfig,
    toolInput: Record<string, unknown>,
    startTime: number
  ): Promise<ToolCallResponse> {
    try {
      let result: unknown

      switch (toolDef.executor) {
        case 'http': {
          const { HttpExecutor } = await import('./executors/http')
          const executor = new HttpExecutor({
            tokenManager: this.tokenManager,
            getCredentials: this.getCredentials,
          })
          const execResult = await executor.execute(
            connectorId,
            manifest,
            config,
            toolDef.executor_config as HttpExecutorConfig,
            toolInput
          )
          if (!execResult.success) {
            throw new Error(execResult.error ?? 'HTTP execution failed')
          }
          result = execResult.data
          break
        }

        case 'mock': {
          const { MockExecutor } = await import('./executors/mock')
          const executor = new MockExecutor()
          const execResult = await executor.execute(
            toolDef.executor_config as MockExecutorConfig,
            toolInput
          )
          if (!execResult.success) {
            throw new Error(execResult.error ?? 'Mock execution failed')
          }
          result = execResult.data
          break
        }

        case 'sql': {
          const { SqlExecutor } = await import('./executors/sql')
          let executor = this.sqlExecutorCache.get(connectorId)
          if (!executor) {
            executor = new SqlExecutor({
              getDbPath: this.options.getDbPath,
            })
            this.sqlExecutorCache.set(connectorId, executor)
          }
          const execResult = await executor.execute(
            toolDef.executor_config as SqlExecutorConfig,
            toolInput
          )
          if (!execResult.success) {
            throw new Error(execResult.error ?? 'SQL execution failed')
          }
          result = execResult.data
          break
        }

        case 'script': {
          result = await this.executeScript(
            toolDef.executor_config as ScriptExecutorConfig,
            toolInput,
            connectorId
          )
          break
        }

        default:
          throw new Error(`Unsupported executor type: ${toolDef.executor}`)
      }

      const durationMs = Date.now() - startTime
      this.auditLogger.logToolCall(connectorId, toolDef.name, 'success', 'Execution completed', durationMs)

      return {
        success: true,
        result,
        metadata: {
          duration_ms: durationMs,
          connector_id: connectorId,
          tool_name: toolDef.name,
        },
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.auditLogger.logToolCall(connectorId, toolDef.name, 'failure', errorMsg, durationMs)

      return {
        success: false,
        error: errorMsg,
        metadata: {
          duration_ms: durationMs,
          connector_id: connectorId,
          tool_name: toolDef.name,
        },
      }
    }
  }

  private async executeScript(
    config: ScriptExecutorConfig,
    input: Record<string, unknown>,
    connectorId: string
  ): Promise<unknown> {
    // 在沙箱环境中执行脚本（简化版，生产环境应使用更安全的沙箱）
    const sandbox = {
      input,
      connectorId,
      console: { log: () => {} },
      result: undefined as unknown,
    }

    // 使用 Function 构造器执行（注意：生产环境应使用 vm2 或类似沙箱）
    const wrappedScript = `
      "use strict";
      const { input, connectorId } = this;
      ${config.script}
    `

    const fn = new Function(wrappedScript)
    const result = fn.call(sandbox)

    return sandbox.result ?? result
  }

  /**
   * 获取 Token Manager
   */
  getTokenManager(): TokenManager {
    return this.tokenManager
  }

  /**
   * 获取熔断器注册表
   */
  getCircuitBreakers(): CircuitBreakerRegistry {
    return this.circuitBreakers
  }

  /**
   * 获取审计日志
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger
  }

  /**
   * 清理资源
   */
  dispose(): void {
    for (const executor of this.sqlExecutorCache.values()) {
      executor.closeAll()
    }
    this.sqlExecutorCache.clear()
  }
}
