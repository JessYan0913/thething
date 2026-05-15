// ============================================================
// Connector 注册表 - 管理所有 Connector 的加载和调用
// ============================================================

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type {
  ConnectorDefinition,
  ToolCallResponse,
  ConnectorToolCall,
  ToolDefinition,
  HttpExecutorConfig,
  MockExecutorConfig,
  SqlExecutorConfig,
  ScriptExecutorConfig,
} from './types'
import type { ConnectorFrontmatter } from './loader'
import { TokenManager } from './token-manager'
import { CircuitBreakerRegistry, CircuitBreakerError } from './circuit-breaker'
import { AuditLogger } from './audit-logger'
import { withRetry } from './retry'
import { debugLog, debugWarn, debugError } from './debug'

export interface ConnectorRegistryOptions {
  getDbPath?: (connectionId: string) => Promise<string>
  enableRetry?: boolean
  enableCircuitBreaker?: boolean
  env?: Record<string, string | undefined>
  allowUnsafeScriptExecutor?: boolean
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
      env: options?.env ?? {},
      allowUnsafeScriptExecutor: options?.allowUnsafeScriptExecutor ?? false,
    }
  }

  /**
   * 初始化：扫描并加载所有 YAML 配置文件
   */
  async initialize(): Promise<void> {
    console.log(`[ConnectorRegistry] Initializing with configDir: ${this.configDir}`)

    if (!fs.existsSync(this.configDir)) {
      console.warn('[ConnectorRegistry] Config directory not found:', this.configDir)
      return
    }

    // 扫描所有 .yaml 和 .yml 文件
    const yamlFiles = fs.readdirSync(this.configDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => path.join(this.configDir, f))

    console.log(`[ConnectorRegistry] Found ${yamlFiles.length} YAML files:`, yamlFiles.map(f => path.basename(f)))

    for (const yamlPath of yamlFiles) {
      try {
        await this.loadConnector(yamlPath)
      } catch (error) {
        console.error(`[ConnectorRegistry] Failed to load ${yamlPath}:`, error)
      }
    }

    console.log(`[ConnectorRegistry] Initialized ${this.connectors.size} connectors:`, this.connectors.keys())
  }

  /**
   * 从 AppContext 快照数据初始化，替代目录扫描。
   *
   * 由 createContext() 调用，确保 Registry 使用与快照一致的 connector 定义，
   * 避免因目录扫描路径差异导致 Registry 和 AppContext 数据不一致。
   */
  initializeFromDefinitions(defs: ConnectorFrontmatter[]): void {
    this.connectors.clear()
    for (const def of defs) {
      // ConnectorFrontmatter 和 ConnectorDefinition 结构相同，
      // 仅 auth.config 和 tools 的 TypeScript 类型表示有细微差异
      // （Zod schema 用 z.unknown() / z.any()，runtime 接口用精确联合类型）。
      // 数据经 Zod 校验，运行时保证有效。
      const connector = def as unknown as ConnectorDefinition
      this.connectors.set(connector.id, connector)
    }
    console.log(`[ConnectorRegistry] Initialized from snapshot: ${this.connectors.size} connectors`, this.connectors.keys())
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
    debugLog(`[ConnectorRegistry] Loaded connector: ${connector.id} (${connector.name} v${connector.version})`)
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
    const missingVars: string[] = []

    const result = str.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = this.options.env[varName]
      if (envValue === undefined) {
        missingVars.push(varName)
        return '' // 替换为空字符串，允许 connector 加载
      }
      return envValue
    })

    // 记录缺失的环境变量（警告而非错误）
    // 允许 connector 加载，运行时会根据实际情况处理
    if (missingVars.length > 0) {
      console.warn(
        `[ConnectorRegistry] Warning: Missing environment variables for placeholder: ${missingVars.join(', ')}\n` +
        `Original string: "${str}" - replaced with empty string`
      )
    }

    return result
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
  async callTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    const startTime = Date.now()
    const { connectorId, toolName, input } = request

    // 1. 获取 connector 定义
    const connector = this.connectors.get(connectorId)

    if (!connector) {
      return {
        success: false,
        error: `Connector not found: ${connectorId}`,
      }
    }

    if (!connector.enabled) {
      return {
        success: false,
        error: `Connector disabled: ${connectorId}`,
      }
    }

    // 2. 查找工具定义
    const toolDef = connector.tools.find(t => t.name === toolName)
    if (!toolDef) {
      return {
        success: false,
        error: `Tool not found: ${toolName} in connector ${connectorId}`,
      }
    }

    // 3. 检查熔断器
    if (this.options.enableCircuitBreaker) {
      const breaker = this.circuitBreakers.get(connectorId)
      try {
        return await breaker.execute(async () => {
          return this.executeWithRetry(toolDef, connector, input, startTime)
        })
      } catch (error) {
        if (error instanceof CircuitBreakerError) {
          this.auditLogger.logCircuitBreakerTrip(connectorId, error.message)
          return {
            success: false,
            error: `Circuit breaker open for connector ${connectorId}`,
            metadata: {
              durationMs: Date.now() - startTime,
              connectorId,
              toolName,
            },
          }
        }
        throw error
      }
    }

    return this.executeWithRetry(toolDef, connector, input, startTime)
  }

  async invokeTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    return this.callTool(request)
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
            durationMs: Date.now() - startTime,
            connectorId: connector.id,
            toolName: toolDef.name,
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
          durationMs,
          connectorId: connector.id,
          toolName: toolDef.name,
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
          durationMs,
          connectorId: connector.id,
          toolName: toolDef.name,
        },
      }
    }
  }

  private async executeScript(
    config: ScriptExecutorConfig,
    input: Record<string, unknown>,
    connectorId: string
  ): Promise<unknown> {
    // ============================================================
    // SECURITY: Script executor is DISABLED by default
    // ============================================================
    // `new Function()` has no sandbox isolation - can access process, require, fs
    // This is a Remote Code Execution (RCE) vulnerability if YAML is tampered
    //
    // To enable (unsafe, only for trusted internal connectors):
    // 1. Set CONNECTOR_ENABLE_SCRIPT_EXECUTOR=true
    // 2. Ensure connector YAML files are from trusted sources only
    //
    // Recommended alternatives:
    // - Use 'http' executor for API calls
    // - Use 'sql' executor for database operations
    // - Use 'mock' executor for testing
    // ============================================================
    if (!this.options.allowUnsafeScriptExecutor) {
      throw new Error(
        `[ScriptExecutor] DISABLED for security reasons.\n` +
        `Connector: ${connectorId}\n` +
        `Script executor allows arbitrary code execution without sandbox isolation.\n` +
        `Alternatives:\n` +
        `  1. Use 'http' executor for API calls (recommended)\n` +
        `  2. Use 'sql' executor for database operations\n` +
        `  3. Use 'mock' executor for testing\n` +
        `To enable (unsafe): Set CONNECTOR_ENABLE_SCRIPT_EXECUTOR=true\n` +
        `WARNING: Only enable if connector YAML files are from trusted sources!`
      )
    }

    // ============================================================
    // Enabled mode: Execute with limited sandbox
    // ============================================================
    // WARNING: This is still NOT fully secure. The sandbox only limits
    // direct access, but sophisticated attacks may still be possible.
    // For production, consider using vm2 or isolating in a separate process.
    // ============================================================
    debugWarn(
      `[ScriptExecutor] ENABLED (unsafe mode). Connector: ${connectorId}\n` +
      `WARNING: Script execution without vm2 sandbox is not fully secure!`
    )

    // Limited sandbox - no access to process, require, fs, etc.
    const sandbox = {
      input,
      connectorId,
      // Limited console - no info/debug that could leak sensitive data
      console: {
        log: (...args: unknown[]) => debugLog('[Script]', ...args),
        warn: (...args: unknown[]) => debugWarn('[Script]', ...args),
        error: (...args: unknown[]) => debugError('[Script]', ...args),
      },
      // Explicitly NO access to:
      // - process (env, exit, etc.)
      // - require/module (file system, network, etc.)
      // - globalThis (setTimeout, setInterval leak timers)
      result: undefined as unknown,
    }

    // Use Function constructor with strict mode
    // Note: This is NOT a proper sandbox - it only limits direct references
    const wrappedScript = `
      "use strict";
      const { input, connectorId, console, result } = this;
      ${config.script}
    `

    try {
      const fn = new Function(wrappedScript)
      const result = fn.call(sandbox)

      return sandbox.result ?? result
    } catch (err) {
      throw new Error(
        `[ScriptExecutor] Execution failed for connector ${connectorId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
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
