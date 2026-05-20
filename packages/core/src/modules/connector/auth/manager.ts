// ============================================================
// Auth 管理器 - 处理各种认证方式
// ============================================================

import type { AuthConfig } from '../types';

export interface AuthResult {
  headers?: Record<string, string>
  query_params?: Record<string, string>
  body?: Record<string, unknown>
}

export class AuthManager {
  /**
   * 根据 Connector 配置生成认证信息
   */
  async getAuth(
    manifest: AuthConfig,
    credentials: Record<string, string>
  ): Promise<AuthResult> {
    switch (manifest.type) {
      case 'none':
        return {}

      case 'api_key': {
        const header = manifest.config.header
        const queryParam = manifest.config.query_param
        const result: AuthResult = {}

        if (header) {
          result.headers = { [header]: credentials.api_key || '' }
        }
        if (queryParam) {
          result.query_params = { [queryParam]: credentials.api_key || '' }
        }
        return result
      }

      case 'bearer':
        return {
          headers: {
            Authorization: `Bearer ${credentials.bearer_token || manifest.config.bearer_token || ''}`,
          },
        }

      case 'custom':
        // Custom 类型由 TokenManager 处理，这里返回空
        return {}

      default:
        return {}
    }
  }

  /**
   * 验证 credentials 是否包含必要字段
   */
  validateCredentials(manifest: AuthConfig, credentials: Record<string, string>): void {
    switch (manifest.type) {
      case 'api_key':
        if (!credentials.api_key) {
          throw new Error(`Connector ${manifest} requires 'api_key' credential`)
        }
        break

      case 'bearer':
        if (!credentials.bearer_token && !manifest.config.bearer_token) {
          throw new Error(`Connector requires 'bearer_token' credential or config`)
        }
        break

      case 'custom':
        // 微信/飞书等特殊认证由 TokenManager 处理
        break

      case 'none':
        break
    }
  }
}
