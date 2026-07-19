// ============================================================
// Connector Tool Executor
// ============================================================
// 合并了 AuthManager、TokenManager、HttpExecutor 的职责：
// - 认证解析（API key / Bearer / Custom token）
// - Token 缓存与自动刷新（微信/飞书 2h token）
// - HTTP 执行 + Mock 分发

import type {
  ConnectorDefinition,
  ToolDefinition,
  ToolCallResponse,
  HttpExecutorConfig,
  MockExecutorConfig,
  AuthConfig,
} from './types'
import type { TemplateContext } from './template'
import { renderTemplate, renderObject } from './template'
import { logger } from '../../primitives/logger'

interface CachedToken {
  token: string
  expiresAt: number
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}

/**
 * 校验渲染后的 URL 域名是否在 connector 声明的 allowed_domains 白名单内。
 * 未声明白名单时不限制（向后兼容），但 LLM input 插值进 URL 的 connector
 * 建议声明白名单以防 SSRF。
 */
function validateUrlAgainstAllowlist(url: string, connector: ConnectorDefinition): void {
  const allowedDomains = connector.allowed_domains
  if (!allowedDomains || allowedDomains.length === 0) return

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    throw new Error(`Invalid URL after template rendering: ${truncate(url, 200)}`)
  }

  const allowed = allowedDomains.some(domain =>
    hostname === domain || hostname.endsWith(`.${domain}`)
  )
  if (!allowed) {
    throw new Error(`URL domain '${hostname}' is not in allowed_domains [${allowedDomains.join(', ')}]`)
  }
}

export class ConnectorToolExecutor {
  private tokenCache = new Map<string, CachedToken>()
  private refreshingPromises = new Map<string, Promise<CachedToken>>()

  private readonly REFRESH_AHEAD_MS = 5 * 60 * 1000

  constructor(
    private getCredentials: (connectorId: string) => Promise<Record<string, string>>,
  ) {}

  dispose(): void {
    this.tokenCache.clear()
    this.refreshingPromises.clear()
  }

  async execute(
    connector: ConnectorDefinition,
    toolDef: ToolDefinition,
    input: Record<string, unknown>,
  ): Promise<ToolCallResponse> {
    const startTime = Date.now()

    try {
      let result: unknown

      switch (toolDef.executor) {
        case 'http':
          result = await this.executeHttp(connector, toolDef, input)
          break

        case 'mock': {
          const { MockExecutor } = await import('./executors/mock')
          const execResult = await new MockExecutor().execute(
            toolDef.executor_config as MockExecutorConfig,
            input,
          )
          if (!execResult.success) {
            throw new Error(execResult.error ?? 'Mock execution failed')
          }
          result = execResult.data
          break
        }

        default:
          throw new Error(`Unsupported executor type: ${toolDef.executor}`)
      }

      return {
        success: true,
        result,
        metadata: { durationMs: Date.now() - startTime, connectorId: connector.id, toolName: toolDef.name },
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('ConnectorExecutor', `${connector.id}.${toolDef.name} failed:`, errorMsg)

      return {
        success: false,
        error: errorMsg,
        metadata: { durationMs: Date.now() - startTime, connectorId: connector.id, toolName: toolDef.name },
      }
    }
  }

  // ---- HTTP execution ----

  private async executeHttp(
    connector: ConnectorDefinition,
    toolDef: ToolDefinition,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const toolConfig = toolDef.executor_config as HttpExecutorConfig
    const timeoutMs = toolDef.timeout_ms || 10000
    const credentials = connector.variables || {}

    const authHeaders = this.resolveAuth(connector.auth, credentials)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeaders,
    }

    let token: string | undefined
    if (connector.auth.type === 'custom' && connector.auth.config.token_url) {
      token = await this.getToken(connector.id, connector)
      if (!headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }

    const ctx: TemplateContext = { input, credentials, token }

    if (toolConfig.headers) {
      const renderedHeaders = renderObject(toolConfig.headers, ctx) as Record<string, string>
      Object.assign(headers, renderedHeaders)
    }

    const url = renderTemplate(toolConfig.url, ctx)
    validateUrlAgainstAllowlist(url, connector)
    const body = toolConfig.body
      ? renderObject(toolConfig.body, ctx) as Record<string, unknown>
      : undefined

    const queryParams = { ...toolConfig.query_params }
    if (connector.auth.type === 'api_key' && connector.auth.config.query_param) {
      queryParams[connector.auth.config.query_param] = credentials.api_key || ''
    }
    const renderedQueryParams = renderObject(queryParams, ctx) as Record<string, string>

    let fullUrl = url
    if (Object.keys(renderedQueryParams).length > 0) {
      const searchParams = new URLSearchParams(renderedQueryParams)
      fullUrl += (url.includes('?') ? '&' : '?') + searchParams.toString()
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(fullUrl, {
        method: toolConfig.method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const contentType = response.headers.get('content-type') || ''
      let data: unknown

      if (contentType.includes('application/json')) {
        data = await response.json()
      } else if (contentType.includes('text/')) {
        data = { text: await response.text() }
      } else {
        data = { raw: await response.text() }
      }

      if (!response.ok) {
        // 401 时清除 token 缓存，下次调用立即重刷（token 可能已被上游吊销）
        if (response.status === 401 && token) {
          this.tokenCache.delete(connector.id)
        }
        throw new Error(`HTTP ${response.status}: ${truncate(JSON.stringify(data), 500)}`)
      }

      return data
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  // ---- Auth resolution (was AuthManager) ----

  private resolveAuth(auth: AuthConfig, credentials: Record<string, string>): Record<string, string> {
    switch (auth.type) {
      case 'api_key':
        return auth.config.header
          ? { [auth.config.header]: credentials.api_key || '' }
          : {}

      case 'bearer':
        return {
          Authorization: `Bearer ${credentials.bearer_token || auth.config.token || ''}`,
        }

      case 'custom':
      case 'none':
      default:
        return {}
    }
  }

  // ---- Token management (was TokenManager) ----

  async getToken(connectorId: string, manifest: ConnectorDefinition): Promise<string> {
    const cached = this.tokenCache.get(connectorId)
    if (cached && cached.expiresAt > Date.now() + this.REFRESH_AHEAD_MS) {
      return cached.token
    }

    const existing = this.refreshingPromises.get(connectorId)
    if (existing) {
      return (await existing).token
    }

    return this.refreshToken(connectorId, manifest)
  }

  private async refreshToken(connectorId: string, manifest: ConnectorDefinition): Promise<string> {
    const existing = this.refreshingPromises.get(connectorId)
    if (existing) {
      return (await existing).token
    }

    const promise = this.doRefreshToken(connectorId, manifest)
    this.refreshingPromises.set(connectorId, promise)

    try {
      const result = await promise
      this.tokenCache.set(connectorId, result)
      return result.token
    } finally {
      this.refreshingPromises.delete(connectorId)
    }
  }

  /**
   * 刷新 access_token。
   *
   * 双重渲染说明：
   *   token_body/token_params 中的值经过两次渲染管道：
   *   1. YAML 加载时 — `${{ var_name }}` 被 resolveConnectorVars 解析为字面值
   *   2. 运行时（此处）— `${path}` 被 renderObject 解析（模板上下文含 credentials/variables）
   *   两者语法不冲突，叠加使用是安全的。如果未来调整渲染顺序或覆盖规则，
   *   需要确认此处拿到的是 resolve 后的字面值，而非未解析的 ${{ }} 引用。
   */
  private async doRefreshToken(connectorId: string, manifest: ConnectorDefinition): Promise<CachedToken> {
    const authConfig = manifest.auth.config
    if (!authConfig.token_url) {
      throw new Error(`Connector ${connectorId} has no token_url configured`)
    }

    const credentials = await this.getCredentials(connectorId)
    const renderedBody = renderObject(authConfig.token_body || {}, { credentials }) as Record<string, string>
    const renderedParams = renderObject(authConfig.token_params || {}, { credentials }) as Record<string, string>

    let url = authConfig.token_url
    if (authConfig.token_method !== 'POST' && Object.keys(renderedParams).length > 0) {
      const searchParams = new URLSearchParams(renderedParams)
      url += (url.includes('?') ? '&' : '?') + searchParams.toString()
    }

    const options: RequestInit = {
      method: authConfig.token_method || (Object.keys(renderedBody).length > 0 ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
    }

    if (options.method === 'POST') {
      options.body = JSON.stringify(renderedBody)
    }

    logger.debug('ConnectorExecutor', `Refreshing token for ${connectorId} from ${url}`)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as Record<string, unknown>
    const tokenField = authConfig.token_field || 'access_token'
    const expiresInField = authConfig.expires_in_field || 'expires_in'

    const token = data[tokenField] as string
    if (!token) {
      throw new Error(`Token field '${tokenField}' not found in response`)
    }

    const expiresIn = (data[expiresInField] as number) || 7200

    logger.debug('ConnectorExecutor', `Token refreshed for ${connectorId}, expires in ${expiresIn}s`)

    return { token, expiresAt: Date.now() + expiresIn * 1000 }
  }
}
