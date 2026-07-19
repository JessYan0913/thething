// ============================================================
// Connector 注册表 - 管理所有 Connector 的定义存储和工具调用
// ============================================================

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type {
  ConnectorDefinition,
  ToolCallResponse,
  ConnectorToolCall,
  ToolDefinition,
} from './types'
import type { ConnectorFrontmatter } from './loader'
import { ConnectorFrontmatterSchema } from './loader'
import { ConnectorToolExecutor } from './executor'
import { logger } from '../../primitives/logger'
import { resolveConnectorVars } from './var-resolver'
import { AuditLogger } from './audit-logger'

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDefinition>()
  private executor: ConnectorToolExecutor
  private auditLogger: AuditLogger | null = null

  constructor(
    private configDir: string,
  ) {
    this.executor = new ConnectorToolExecutor(this.getCredentials.bind(this))
  }

  setAuditLogger(auditLogger: AuditLogger): void {
    this.auditLogger = auditLogger
  }

  async initialize(): Promise<void> {
    logger.debug('ConnectorRegistry', `Initializing with configDir: ${this.configDir}`)

    if (!fs.existsSync(this.configDir)) {
      logger.warn('ConnectorRegistry', `Config directory not found: ${this.configDir}`)
      return
    }

    const yamlFiles = fs.readdirSync(this.configDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(f => path.join(this.configDir, f))

    logger.debug('ConnectorRegistry', `Found ${yamlFiles.length} YAML files: ${yamlFiles.map(f => path.basename(f)).join(', ')}`)

    for (const yamlPath of yamlFiles) {
      try {
        await this.loadConnector(yamlPath)
      } catch (error) {
        logger.error('ConnectorRegistry', `Failed to load ${yamlPath}:`, error)
      }
    }

    logger.debug('ConnectorRegistry', `Initialized ${this.connectors.size} connectors: ${[...this.connectors.keys()].join(', ')}`)
  }

  initializeFromDefinitions(defs: ConnectorFrontmatter[]): void {
    this.connectors.clear()
    for (const def of defs) {
      const connector = def as unknown as ConnectorDefinition
      this.connectors.set(connector.id, connector)
    }
    logger.debug('ConnectorRegistry', `Initialized from snapshot: ${this.connectors.size} connectors: ${[...this.connectors.keys()].join(', ')}`)
  }

  /**
   * 合并 connector 定义到注册表（不清除已有定义）。
   *
   * 与 initializeFromDefinitions 的区别：只添加/覆盖同 ID 的定义，
   * 不删除已有的、本次未传入的 connector。
   * 用途：createContext 用项目级 layout 加载 connector 时，
   * 不会清掉 bootstrap 阶段从全局目录加载的 connector（如飞书 WS）。
   */
  mergeFromDefinitions(defs: ConnectorFrontmatter[]): void {
    for (const def of defs) {
      const connector = def as unknown as ConnectorDefinition
      this.connectors.set(connector.id, connector)
    }
    logger.debug('ConnectorRegistry', `Merged from snapshot: ${this.connectors.size} connectors: ${[...this.connectors.keys()].join(', ')}`)
  }

  async loadConnector(yamlPath: string): Promise<void> {
    const content = fs.readFileSync(yamlPath, 'utf-8')
    const raw = yaml.load(content) as Record<string, unknown>
    const processed = resolveConnectorVars(raw)

    // 与 loader-internal 路径同等强度的 Zod 校验，拒绝半损坏定义
    const parsed = ConnectorFrontmatterSchema.safeParse(processed)
    if (!parsed.success) {
      throw new Error(`Invalid connector definition in ${yamlPath}: ${parsed.error.message}`)
    }

    const connector = parsed.data as unknown as ConnectorDefinition

    this.connectors.set(connector.id, connector)
    logger.debug('ConnectorRegistry', `Loaded connector: ${connector.id} (${connector.name} v${connector.version})`)
  }

  /**
   * 获取连接器的变量值（作为 credentials 的统一来源）。
   * YAML 中的变量在加载时已通过 ${{ var_name }} 解析替换，
   * 剩下的原始变量值直接作为运行时凭证使用。
   */
  private async getCredentials(connectorId: string): Promise<Record<string, string>> {
    const connector = this.connectors.get(connectorId)
    return connector?.variables || {}
  }

  getDefinition(connectorId: string): ConnectorDefinition | undefined {
    return this.connectors.get(connectorId)
  }

  getConnectorIds(): string[] {
    return Array.from(this.connectors.keys())
  }

  getEnabledConnectors(): ConnectorDefinition[] {
    return Array.from(this.connectors.values()).filter(c => c.enabled)
  }

  getTools(connectorId: string): ToolDefinition[] {
    const connector = this.connectors.get(connectorId)
    return connector?.tools || []
  }

  async callTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    const { connectorId, toolName, input } = request

    const connector = this.connectors.get(connectorId)

    if (!connector) {
      return { success: false, error: `Connector not found: ${connectorId}` }
    }

    if (!connector.enabled) {
      return { success: false, error: `Connector disabled: ${connectorId}` }
    }

    const toolDef = connector.tools.find(t => t.name === toolName)
    if (!toolDef) {
      return { success: false, error: `Tool not found: ${toolName} in connector ${connectorId}` }
    }

    const response = await this.executor.execute(connector, toolDef, input)
    const durationMs = response.metadata?.durationMs
    this.auditLogger?.logToolCall(
      connectorId,
      toolName,
      response.success ? 'success' : 'failure',
      response.success ? 'OK' : (response.error ?? 'Unknown error'),
      typeof durationMs === 'number' ? durationMs : undefined,
    )
    return response
  }

  async invokeTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    return this.callTool(request)
  }

  /**
   * 获取连接器的 access_token（用于直接调用 API）
   */
  async getToken(connectorId: string): Promise<string | null> {
    const connector = this.connectors.get(connectorId)
    if (!connector || !connector.enabled || connector.auth.type !== 'custom' || !connector.auth.config.token_url) {
      return null
    }
    return this.executor.getToken(connectorId, connector)
  }

  dispose(): void {
    this.connectors.clear()
    this.executor.dispose()
  }
}
