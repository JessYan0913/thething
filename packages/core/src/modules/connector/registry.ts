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
import { ConnectorToolExecutor } from './executor'
import { logger } from '../../primitives/logger'

export interface ConnectorRegistryOptions {
  env?: Record<string, string | undefined>
}

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDefinition>()
  private executor: ConnectorToolExecutor

  constructor(
    private configDir: string,
    options?: ConnectorRegistryOptions,
  ) {
    this.executor = new ConnectorToolExecutor(this.getCredentials.bind(this))
    this.env = options?.env ?? {}
  }

  private env: Record<string, string | undefined>

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

  async loadConnector(yamlPath: string): Promise<void> {
    const content = fs.readFileSync(yamlPath, 'utf-8')
    const raw = yaml.load(content) as Record<string, unknown>
    const processed = this.replaceEnvVars(raw)

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

    if (!connector.id) {
      throw new Error(`Connector missing 'id' field in ${yamlPath}`)
    }

    this.connectors.set(connector.id, connector)
    logger.debug('ConnectorRegistry', `Loaded connector: ${connector.id} (${connector.name} v${connector.version})`)
  }

  private replaceEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replaceEnvVarInString(value)
      } else if (Array.isArray(value)) {
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
    const missingVars: string[] = []

    const result = str.replace(/\$\{(\w+)\}/g, (_, varName) => {
      const envValue = this.env[varName]
      if (envValue === undefined) {
        missingVars.push(varName)
        return ''
      }
      return envValue
    })

    if (missingVars.length > 0) {
      logger.warn(
        'ConnectorRegistry',
        `Missing environment variables for placeholder: ${missingVars.join(', ')}\n` +
        `Original string: "${str}" - replaced with empty string`
      )
    }

    return result
  }

  private async getCredentials(connectorId: string): Promise<Record<string, string>> {
    const connector = this.connectors.get(connectorId)
    return connector?.credentials || {}
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

    return this.executor.execute(connector, toolDef, input)
  }

  async invokeTool(request: ConnectorToolCall): Promise<ToolCallResponse> {
    return this.callTool(request)
  }

  dispose(): void {
    // No-op
  }
}
