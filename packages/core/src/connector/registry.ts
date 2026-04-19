// ============================================================
// Connector 注册表 - 管理所有 Connector 的加载和调用
// ============================================================

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type {
  ConnectorDefinition,
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

export interface ConnectorRegistryOptions {
  getDbPath?: (connectionId: string) => Promise<string>
  enableRetry?: boolean
  enableCircuitBreaker?: boolean
}

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDefinition>()
  private tokenManager: TokenManager
  private circuitBreakers: CircuitBreakerRegistry
  private auditLogger: AuditLogger
  private options: Required<ConnectorRegistryOptions>

  private sqlExecutorCache: Map<string, import('./executors/sql').SqlExecutor> = new Map()

  constructor(
    private configDir: string,
    options?: ConnectorRegistryOptions
  ) {
    this.tokenManager = new TokenManager(this.getCredentials.bind(this))
    this.circuitBreakers = new CircuitBreakerRegistry()
    this.auditLogger = new AuditLogger()
    this.options = {
      getDbPath: options?.getDbPath ?? (async () => { throw new Error('getDbPath not configured') }),
      enableRetry: options?.enableRetry ?? true,
      enableCircuitBreaker: options?.enableCircuitBreaker ?? true,
    }
  }

  /**
   * 初始化：扫描并加载所有 YAML 配置文件
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.configDir)) {
      console.log('[ConnectorRegistry] Config directory not found:', this.configDir)
      return
    }

    // 扫描所有 .yaml 和 .yml 文件
    const yamlFiles = fs.readdirSync(this.configDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => path.join(this.configDir, f))

    console.log(`[ConnectorRegistry] Found ${yamlFiles.length} YAML files`)

    for (const yamlPath of yamlFiles) {
      try {
        await this.loadConnector(yamlPath)
      } catch (error) {
        console.error(`[ConnectorRegistry] Failed to load ${yamlPath}:`, error)
      }
    }

    console.log(`[ConnectorRegistry] Initialized ${this.connectors.size} connectors`)
  }

  /**
   * 加载单个 YAML 配置文件
   */
  async loadConnector(yamlPath: string): Promise<void> {
    const content = fs.readFileSync(yamlPath, 'utf-8')

    // 解析 YAML
    const raw = yaml.load(content) as Record<string, unknown>

    // 替换环境变量
    const processed = this.replaceEnvVars(raw)

    // 构建 ConnectorDefinition
    const connector: ConnectorDefinition = {
      id: processed.id as string,
      name: processed.name as string,
      version: processed.version as string,
      description: processed.description as string,
      enabled: processed.enabled as boolean ?? true,
      inbound: processed.inbound as ConnectorDefinition['inbound'],
      auth: processed.auth as ConnectorDefinition['auth'],
      credentials: processed.credentials as Record<string, string>,
      custom_settings: processed.custom_settings as Record<string, unknown>,
      base_url: processed.base_url as string,
      tools: (processed.tools as ToolDefinition[]) || [],
    }

    // 验证必要字段
    if (!connector.id) {
      throw new Error(`Connector missing 'id' field in ${yamlPath}`)
    }

    this.connectors.set(connector.id, connector)
    console.log(`[ConnectorRegistry] Loaded connector: ${connector.id} (${connector.name} v${connector.version})`)
  }

  /**
   * 替换环境变量 ${VAR_NAME} 或 $VAR_NAME
   */
  private replaceEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replaceEnvVarInString(value)
      } else if (Array.isArray(value)) {
        // 保留数组结构，递归处理数组元素
        result[key] = value.map(item => {
          if (typeof item === 'string') {
            return this.replaceEnvVarInString(item)
          } else if (typeof item === 'object' && item !== null) {
            return this.replaceEnvVars(item as Record<string, unknown>)
          }
          return item
        })
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.replaceEnvVars(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }

    return result
  }

  private replaceEnvVarInString(str: string): string {
    // 替换 ${VAR_NAME} 格式
    return str.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = process.env[varName]
      if (envValue === undefined) {
        console.warn(`[ConnectorRegistry] Environment variable ${varName} not found, keeping original`)
        return str
      }
      return envValue
    })
  }

  /**
   * 获取 Connector 凭证
   */
  private async getCredentials(connectorId: string): Promise<Record<string, string>> {
    const connector = this.connectors.get(connectorId)
    return connector?.credentials || {}
  }

  /**
   * 获取 Connector 定义
   */
  getDefinition(connectorId: string): ConnectorDefinition | undefined {
    return this.connectors.get(connectorId)
  }

  /**
   * 获取所有已加载的 Connector ID
   */
  getConnectorIds(): string[] {
    return Array.from(this.connectors.keys())
  }

  /**
   * 获取所有已启用的 Connector
   */
  getEnabledConnectors(): ConnectorDefinition[] {
    return Array.from(this.connectors.values()).filter(c => c.enabled)
  }

  /**
   * 获取某个 Connector 的工具列表
   */
  getTools(connectorId: string): ToolDefinition[] {
    const connector = this.connectors.get(connectorId)
    return connector?.tools || []
  }

  /**
   * 调用 Connector 的工具
   */
  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    const startTime = Date.now()
    const { connector_id, tool_name, tool_input } = request

    // 1. 获取 connector 定义
    const connector = this.connectors.get(connector_id)

    if (!connector) {
      return {
        success: false,
        error: `Connector not found: ${connector_id}`,
      }
    }

    if (!connector.enabled) {
      return {
        success: false,
        error: `Connector disabled: ${connector_id}`,
      }
    }

    // 2. 查找工具定义
    const toolDef = connector.tools.find(t => t.name === tool_name)
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
          return this.executeWithRetry(toolDef, connector, tool_input, startTime)
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

    return this.executeWithRetry(toolDef, connector, tool_input, startTime)
  }

  private async executeWithRetry(
    toolDef: ToolDefinition,
    connector: ConnectorDefinition,
    toolInput: Record<string, unknown>,
    startTime: number
  ): Promise<ToolCallResponse> {
    const execute = async () => {
      return this.executeTool(toolDef, connector, toolInput, startTime)
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
            connector_id: connector.id,
            tool_name: toolDef.name,
          },
        }
      }
    }

    return execute()
  }

  private async executeTool(
    toolDef: ToolDefinition,
    connector: ConnectorDefinition,
    toolInput: Record<string, unknown>,
    startTime: number
  ): Promise<ToolCallResponse> {
    try {
      let result: unknown
      const credentials = connector.credentials || {}

      switch (toolDef.executor) {
        case 'http': {
          const { HttpExecutor } = await import('./executors/http')
          const executor = new HttpExecutor({
            tokenManager: this.tokenManager,
            getCredentials: async () => credentials,
          })
          const execResult = await executor.execute(
            connector.id,
            connector,
            connector,
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
          let executor = this.sqlExecutorCache.get(connector.id)
          if (!executor) {
            executor = new SqlExecutor({
              getDbPath: this.options.getDbPath,
            })
            this.sqlExecutorCache.set(connector.id, executor)
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
            connector.id
          )
          break
        }

        default:
          throw new Error(`Unsupported executor type: ${toolDef.executor}`)
      }

      const durationMs = Date.now() - startTime
      this.auditLogger.logToolCall(connector.id, toolDef.name, 'success', 'Execution completed', durationMs)

      return {
        success: true,
        result,
        metadata: {
          duration_ms: durationMs,
          connector_id: connector.id,
          tool_name: toolDef.name,
        },
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.auditLogger.logToolCall(connector.id, toolDef.name, 'failure', errorMsg, durationMs)

      return {
        success: false,
        error: errorMsg,
        metadata: {
          duration_ms: durationMs,
          connector_id: connector.id,
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