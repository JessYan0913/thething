// ============================================================
// Token 管理器 - 处理需要刷新的 Token（如微信/飞书的 2h token）
// ============================================================

import type { ConnectorManifest } from './types';

interface CachedToken {
  token: string
  expires_at: number  // 毫秒时间戳
}

interface RefreshPromise {
  promise: Promise<CachedToken>
}

export class TokenManager {
  private tokenCache = new Map<string, CachedToken>()
  private refreshingPromises = new Map<string, RefreshPromise>()

  // 默认提前 5 分钟刷新
  private readonly REFRESH_AHEAD_MS = 5 * 60 * 1000

  constructor(
    private getCredentials: (connectorId: string) => Promise<Record<string, string>>
  ) {}

  /**
   * 获取 Token，自动处理缓存和刷新
   */
  async getToken(
    connectorId: string,
    manifest: ConnectorManifest
  ): Promise<string> {
    const cacheKey = connectorId
    const cached = this.tokenCache.get(cacheKey)

    // 检查缓存是否有效（提前 5 分钟刷新）
    if (cached && cached.expires_at > Date.now() + this.REFRESH_AHEAD_MS) {
      return cached.token
    }

    // 如果正在刷新，等待刷新完成
    if (this.refreshingPromises.has(cacheKey)) {
      return (await this.refreshingPromises.get(cacheKey)!.promise).token
    }

    // 开始刷新
    return this.refreshToken(connectorId, manifest, cacheKey)
  }

  /**
   * 强制刷新 Token
   */
  async forceRefresh(connectorId: string, manifest: ConnectorManifest): Promise<string> {
    const cacheKey = connectorId
    this.tokenCache.delete(cacheKey)
    return this.refreshToken(connectorId, manifest, cacheKey)
  }

  /**
   * 刷新 Token
   */
  private async refreshToken(
    connectorId: string,
    manifest: ConnectorManifest,
    cacheKey: string
  ): Promise<string> {
    // 防止并发刷新
    if (this.refreshingPromises.has(cacheKey)) {
      return (await this.refreshingPromises.get(cacheKey)!.promise).token
    }

    const refreshPromise = this.doRefresh(connectorId, manifest)

    this.refreshingPromises.set(cacheKey, { promise: refreshPromise })

    try {
      const result = await refreshPromise
      this.tokenCache.set(cacheKey, result)
      return result.token
    } finally {
      this.refreshingPromises.delete(cacheKey)
    }
  }

  /**
   * 执行实际的 Token 刷新
   */
  private async doRefresh(
    connectorId: string,
    manifest: ConnectorManifest
  ): Promise<CachedToken> {
    const authConfig = manifest.auth.config

    if (!authConfig.token_url) {
      throw new Error(`Connector ${connectorId} has no token_url configured`)
    }

    const credentials = await this.getCredentials(connectorId)

    // 渲染模板（替换 {{credentials.xxx}}）
    const renderedBody = this.renderTemplate(authConfig.token_body || {}, credentials)
    const renderedParams = this.renderTemplate(authConfig.token_params || {}, credentials)

    // 构建 URL
    let url = authConfig.token_url
    if (authConfig.token_method !== 'POST' && Object.keys(renderedParams).length > 0) {
      const searchParams = new URLSearchParams(renderedParams as Record<string, string>)
      url += (url.includes('?') ? '&' : '?') + searchParams.toString()
    }

    const options: RequestInit = {
      method: authConfig.token_method || (renderedBody && Object.keys(renderedBody).length > 0 ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
      },
    }

    if (options.method === 'POST' && renderedBody) {
      options.body = JSON.stringify(renderedBody)
    }

    console.log(`[TokenManager] Refreshing token for ${connectorId} from ${url}`)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    const tokenField = authConfig.token_field || 'access_token'
    const expiresInField = authConfig.expires_in_field || 'expires_in'

    const token = data[tokenField]
    if (!token) {
      throw new Error(`Token field '${tokenField}' not found in response`)
    }

    // 飞书的过期时间是秒，微信的也是
    const expiresIn = (data[expiresInField] || 7200) as number
    const expiresAt = Date.now() + expiresIn * 1000

    console.log(`[TokenManager] Token refreshed for ${connectorId}, expires in ${expiresIn}s`)

    return { token, expires_at: expiresAt }
  }

  /**
   * 模板渲染：替换 {{credentials.xxx}} 或 {{input.xxx}}
   */
  private renderTemplate(
    obj: Record<string, string>,
    credentials: Record<string, string>
  ): Record<string, string> {
    const result: Record<string, string> = {}

    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.renderString(String(value), credentials)
    }

    return result
  }

  private renderString(str: string, credentials: Record<string, string>): string {
    return str.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, _type, field) => {
      if (_type === 'credentials') {
        return credentials[field] || ''
      }
      return str
    }).replace(/\{\{(\w+)\}\}/g, (_, field) => {
      return credentials[field] || ''
    })
  }

  /**
   * 清除指定 Connector 的缓存
   */
  invalidate(connectorId: string): void {
    this.tokenCache.delete(connectorId)
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.tokenCache.clear()
  }
}
