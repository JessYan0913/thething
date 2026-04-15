// ============================================================
// HTTP Executor - 执行 HTTP 请求
// ============================================================

import type {
  HttpExecutorConfig,
  ExecutorResult,
  ConnectorManifest,
  ConnectorConfig,
} from '../types';
import { TokenManager } from '../token-manager';
import { authManager } from '../auth/manager';

export interface HttpExecutorDeps {
  tokenManager: TokenManager
  getCredentials: (connectorId: string) => Promise<Record<string, string>>
}

export class HttpExecutor {
  constructor(
    private deps: HttpExecutorDeps
  ) {}

  /**
   * 执行 HTTP 请求
   */
  async execute(
    connectorId: string,
    manifest: ConnectorManifest,
    config: ConnectorConfig,
    toolConfig: HttpExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()
    const timeoutMs = manifest.tools.find(t => t.executor === 'http')?.timeout_ms || 10000

    try {
      // 1. 获取认证信息
      const auth = await authManager.getAuth(manifest.auth, config.credentials)

      // 2. 如果是自定义认证（微信/飞书），需要获取 token
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(auth.headers || {}),
      }

      if (manifest.auth.type === 'custom' && manifest.auth.config.token_url) {
        const token = await this.deps.tokenManager.getToken(connectorId, manifest)
        // 微信/飞书使用 Bearer Token
        if (!headers['Authorization']) {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      // 3. 渲染 URL 和请求体
      const url = this.renderTemplate(toolConfig.url, input, config.credentials, tokenCache.get(connectorId))
      const body = toolConfig.body
        ? this.renderObject(toolConfig.body, input, config.credentials)
        : undefined

      // 4. 构建查询参数
      const queryParams = { ...(auth.query_params || {}), ...toolConfig.query_params }
      const renderedQueryParams = this.renderObject(queryParams, input, config.credentials)

      // 5. 构建完整 URL
      let fullUrl = url
      if (Object.keys(renderedQueryParams).length > 0) {
        const searchParams = new URLSearchParams(
          renderedQueryParams as Record<string, string>
        )
        fullUrl += (url.includes('?') ? '&' : '?') + searchParams.toString()
      }

      // 6. 执行请求
      const response = await this.fetchWithTimeout(fullUrl, {
        method: toolConfig.method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }, timeoutMs)

      // 7. 解析响应
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
        return {
          success: false,
          error: `HTTP ${response.status}: ${JSON.stringify(data)}`,
          metadata: { duration_ms: Date.now() - startTime, status: response.status },
        }
      }

      return {
        success: true,
        data,
        metadata: { duration_ms: Date.now() - startTime, status: response.status },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { duration_ms: Date.now() - startTime },
      }
    }
  }

  private renderTemplate(
    str: string,
    input: Record<string, unknown>,
    credentials: Record<string, string>,
    token?: string
  ): string {
    const now = new Date()

    return str
      // 内置变量
      .replace(/\{\{timestamp\}\}/g, () => String(Date.now()))
      .replace(/\{\{iso_timestamp\}\}/g, () => now.toISOString())
      .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())

      // 输入变量
      .replace(/\{\{input\.(\w+)\}\}/g, (_, key) => {
        return String(input[key] ?? '')
      })

      // Credentials 变量
      .replace(/\{\{credentials\.(\w+)\}\}/g, (_, key) => {
        return credentials[key] || ''
      })

      // Token 变量
      .replace(/\{\{token\}\}/g, () => {
        return token || ''
      })
  }

  private renderObject(
    obj: Record<string, unknown>,
    input: Record<string, unknown>,
    credentials: Record<string, string>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.renderTemplate(value, input, credentials)
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.renderObject(value as Record<string, unknown>, input, credentials)
      } else {
        result[key] = value
      }
    }

    return result
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      return response
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

// 简单的 token 缓存（避免每次都重新获取）
const tokenCache = new Map<string, string>()

export function setTokenCache(connectorId: string, token: string): void {
  tokenCache.set(connectorId, token)
}
