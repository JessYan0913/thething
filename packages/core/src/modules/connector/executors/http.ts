// ============================================================
// HTTP Executor - 执行 HTTP 请求
// ============================================================

import type {
  HttpExecutorConfig,
  ExecutorResult,
  ConnectorDefinition,
} from '../types';
import { TokenManager } from '../token-manager';
import { AuthManager } from '../auth/manager';

export interface HttpExecutorDeps {
  tokenManager: TokenManager
  getCredentials: (connectorId: string) => Promise<Record<string, string>>
}

export class HttpExecutor {
  private authManager = new AuthManager()

  constructor(
    private deps: HttpExecutorDeps
  ) {}

  /**
   * 执行 HTTP 请求
   */
  async execute(
    connectorId: string,
    connector: ConnectorDefinition,
    config: ConnectorDefinition,
    toolConfig: HttpExecutorConfig,
    input: Record<string, unknown>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()
    const timeoutMs = connector.tools.find(t => t.executor === 'http')?.timeout_ms || 10000
    const credentials = config.credentials || {}

    try {
      // 1. 获取认证信息
      const auth = await this.authManager.getAuth(connector.auth, credentials)

      // 2. 如果是自定义认证（微信/飞书），需要获取 token
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(auth.headers || {}),
      }

      if (connector.auth.type === 'custom' && connector.auth.config.token_url) {
        const token = await this.deps.tokenManager.getToken(connectorId, connector)
        // 微信/飞书使用 Bearer Token
        if (!headers['Authorization']) {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      // 3. 渲染 URL 和请求体
      const url = this.renderTemplate(toolConfig.url, input, credentials, tokenCache.get(connectorId))
      const body = toolConfig.body
        ? this.renderObject(toolConfig.body, input, credentials)
        : undefined

      // 4. 构建查询参数
      const queryParams = { ...(auth.query_params || {}), ...toolConfig.query_params }
      const renderedQueryParams = this.renderObject(queryParams, input, credentials)

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
      .replace(/\{\{timestamp\}\}/g, () => String(Date.now()))
      .replace(/\{\{iso_timestamp\}\}/g, () => now.toISOString())
      .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())
      .replace(/\{\{input\.([\w.]+)\}\}/g, (_, path) => {
        return stringifyTemplateValue(resolvePath(input, path))
      })
      .replace(/\{\{credentials\.([\w.]+)\}\}/g, (_, path) => {
        return stringifyTemplateValue(resolvePath(credentials, path))
      })
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
        // 特殊语法 $input.xxx - 直接引用输入值（保留原类型，如数组）
        const directRefMatch = value.match(/^\$input\.(\w+)$/)
        if (directRefMatch) {
          const inputKey = directRefMatch[1]
          result[key] = input[inputKey] ?? value
          continue
        }

        // 特殊语法 $json(input.xxx) - 将输入值序列化为 JSON 字符串
        // 用于飞书等 API 要求 content 字段是 JSON 字符串的场景
        const jsonMatch = value.match(/^\$json\(input\.(\w+)\)$/)
        if (jsonMatch) {
          const inputKey = jsonMatch[1]
          const inputVal = input[inputKey]
          if (typeof inputVal === 'object' && inputVal !== null) {
            result[key] = JSON.stringify(inputVal)
          } else if (typeof inputVal === 'string') {
            // 字符串需要包装成 JSON 格式 {"text": "..."}
            result[key] = JSON.stringify({ text: inputVal })
          } else {
            result[key] = JSON.stringify(inputVal)
          }
          continue
        }

        // 特殊语法 $jsonEscape(input.xxx) - JSON 转义字符串（用于嵌入 JSON 字符串中）
        const jsonEscapeMatch = value.match(/^\$jsonEscape\(input\.(\w+)\)$/)
        if (jsonEscapeMatch) {
          const inputKey = jsonEscapeMatch[1]
          const inputVal = input[inputKey]
          // JSON.stringify 会自动处理转义，然后去掉外层引号
          result[key] = JSON.stringify(String(inputVal ?? '')).slice(1, -1)
          continue
        }

        result[key] = this.renderTemplate(value, input, credentials)
      } else if (Array.isArray(value)) {
        // 处理数组：遍历每个元素进行渲染
        result[key] = value.map(item => {
          if (typeof item === 'string') {
            return this.renderTemplate(item, input, credentials)
          } else if (typeof item === 'object' && item !== null) {
            return this.renderObject(item as Record<string, unknown>, input, credentials)
          }
          return item
        })
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

function resolvePath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, source)
}

function stringifyTemplateValue(value: unknown): string {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value)
  }
  return String(value ?? '')
}
