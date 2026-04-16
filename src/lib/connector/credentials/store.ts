// ============================================================
// 凭证加密存储模块 - AES-256-GCM 加密敏感凭证
// ============================================================

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface EncryptedCredential {
  id: string
  connector_id: string
  encrypted_data: string  // Base64 编码的加密数据
  iv: string              // Base64 编码的初始化向量
  auth_tag: string        // Base64 编码的认证标签（GCM 模式）
  created_at: number
  updated_at: number
  version: number
}

export interface CredentialData {
  [key: string]: string  // 凭证键值对
}

export interface CredentialStoreOptions {
  encryptionKey?: string  // 加密密钥（32 字节）
  storagePath?: string    // 存储文件路径
  useEnvFallback?: boolean  // 是否使用环境变量作为后备
}

const DEFAULT_STORAGE_PATH = path.join(process.cwd(), '.connector-credentials.json')
const DEFAULT_USE_ENV_FALLBACK = true

/**
 * 凭证加密存储器
 * 使用 AES-256-GCM 加密算法，提供认证加密
 */
export class CredentialStore {
  private encryptionKey: Buffer
  private storagePath: string
  private useEnvFallback: boolean
  private credentials: Map<string, EncryptedCredential> = new Map()
  private initialized = false

  constructor(options?: CredentialStoreOptions) {
    // 加密密钥：32 字节（256 位）
    const key = options?.encryptionKey || process.env.CONNECTOR_ENCRYPTION_KEY || ''
    if (key.length < 32) {
      // 如果密钥不足 32 字节，使用派生密钥
      this.encryptionKey = crypto.createHash('sha256').update(key).digest()
    } else {
      this.encryptionKey = Buffer.from(key.substring(0, 32), 'utf-8')
    }

    this.storagePath = options?.storagePath || DEFAULT_STORAGE_PATH
    this.useEnvFallback = options?.useEnvFallback ?? DEFAULT_USE_ENV_FALLBACK
  }

  /**
   * 初始化：从存储文件加载凭证
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (fs.existsSync(this.storagePath)) {
      try {
        const content = fs.readFileSync(this.storagePath, 'utf-8')
        const data = JSON.parse(content) as EncryptedCredential[]

        for (const cred of data) {
          this.credentials.set(cred.id, cred)
        }

        console.log('[CredentialStore] Loaded', this.credentials.size, 'credentials')
      } catch (error) {
        console.error('[CredentialStore] Failed to load credentials:', error)
      }
    }

    this.initialized = true
  }

  /**
   * 存储凭证（加密后保存）
   */
  async set(connectorId: string, data: CredentialData): Promise<string> {
    await this.initialize()

    const id = `cred-${connectorId}`
    const now = Date.now()

    // 加密数据
    const { encrypted, iv, authTag } = this.encrypt(data)

    const credential: EncryptedCredential = {
      id,
      connector_id: connectorId,
      encrypted_data: encrypted,
      iv,
      auth_tag: authTag,
      created_at: this.credentials.get(id)?.created_at || now,
      updated_at: now,
      version: 1,
    }

    this.credentials.set(id, credential)

    // 写入存储文件
    await this.persist()

    console.log('[CredentialStore] Credential stored:', connectorId)

    return id
  }

  /**
   * 获取凭证（解密后返回）
   */
  async get(connectorId: string): Promise<CredentialData | null> {
    await this.initialize()

    const id = `cred-${connectorId}`
    const credential = this.credentials.get(id)

    if (credential) {
      try {
        return this.decrypt(credential)
      } catch (error) {
        console.error('[CredentialStore] Decryption failed:', connectorId, error)
        return null
      }
    }

    // 后备：从环境变量读取
    if (this.useEnvFallback) {
      return this.getFromEnv(connectorId)
    }

    return null
  }

  /**
   * 删除凭证
   */
  async delete(connectorId: string): Promise<boolean> {
    await this.initialize()

    const id = `cred-${connectorId}`
    const existed = this.credentials.delete(id)

    if (existed) {
      await this.persist()
      console.log('[CredentialStore] Credential deleted:', connectorId)
    }

    return existed
  }

  /**
   * 列出所有已存储的 Connector ID
   */
  async list(): Promise<string[]> {
    await this.initialize()
    return Array.from(this.credentials.values()).map(c => c.connector_id)
  }

  /**
   * 加密凭证数据
   */
  private encrypt(data: CredentialData): {
    encrypted: string
    iv: string
    authTag: string
  } {
    // 生成随机 IV（12 字节，GCM 模式推荐）
    const iv = crypto.randomBytes(12)

    // 创建加密器
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv)

    // 加密
    const json = JSON.stringify(data)
    const encrypted = Buffer.concat([
      cipher.update(json, 'utf-8'),
      cipher.final(),
    ])

    // 获取认证标签
    const authTag = cipher.getAuthTag()

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    }
  }

  /**
   * 解密凭证数据
   */
  private decrypt(credential: EncryptedCredential): CredentialData {
    const iv = Buffer.from(credential.iv, 'base64')
    const authTag = Buffer.from(credential.auth_tag, 'base64')
    const encrypted = Buffer.from(credential.encrypted_data, 'base64')

    // 创建解密器
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv)
    decipher.setAuthTag(authTag)

    // 解密
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    return JSON.parse(decrypted.toString('utf-8'))
  }

  /**
   * 从环境变量读取凭证
   */
  private getFromEnv(connectorId: string): CredentialData | null {
    // 构建环境变量前缀
    const prefix = connectorId.toUpperCase().replace(/-/g, '_')

    // 尝试读取常见凭证字段
    const fields = ['API_KEY', 'API_TOKEN', 'APP_ID', 'APP_SECRET', 'CORP_ID', 'CORP_SECRET', 'TOKEN', 'BEARER_TOKEN']
    const data: CredentialData = {}

    for (const field of fields) {
      const envKey = `${prefix}_${field}`
      const value = process.env[envKey]
      if (value) {
        // 转换为小写键名（如 API_KEY → api_key）
        data[field.toLowerCase()] = value
      }
    }

    // 尝试读取整体凭证 JSON
    const jsonEnvKey = `${prefix}_CREDENTIALS`
    const jsonValue = process.env[jsonEnvKey]
    if (jsonValue) {
      try {
        const jsonData = JSON.parse(jsonValue) as CredentialData
        Object.assign(data, jsonData)
      } catch {
        // 忽略解析错误
      }
    }

    if (Object.keys(data).length === 0) {
      return null
    }

    return data
  }

  /**
   * 持久化到存储文件
   */
  private async persist(): Promise<void> {
    const data = Array.from(this.credentials.values())

    // 确保目录存在
    const dir = path.dirname(this.storagePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 写入文件
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  /**
   * 生成新的加密密钥（用于初始化）
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * 清除所有凭证
   */
  async clear(): Promise<void> {
    this.credentials.clear()
    await this.persist()
    console.log('[CredentialStore] All credentials cleared')
  }

  /**
   * 获取存储统计
   */
  getStats(): {
    total: number
    connectors: string[]
  } {
    return {
      total: this.credentials.size,
      connectors: Array.from(this.credentials.values()).map(c => c.connector_id),
    }
  }
}

// 单例导出
export const credentialStore = new CredentialStore()

/**
 * 使用示例：
 *
 * ```typescript
 * import { credentialStore } from '@/lib/connector/credentials'
 *
 * // 初始化
 * await credentialStore.initialize()
 *
 * // 存储凭证
 * await credentialStore.set('wecom', {
 *   corp_id: 'xxx',
 *   corp_secret: 'xxx',
 *   agent_id: 'xxx',
 * })
 *
 * // 获取凭证
 * const creds = await credentialStore.get('wecom')
 * console.log(creds?.corp_id)
 *
 * // 删除凭证
 * await credentialStore.delete('wecom')
 *
 * // 环境变量后备示例
 * // 设置环境变量：
 * // WECOM_CORP_ID=xxx
 * // WECOM_CORP_SECRET=xxx
 * // 或 WECOM_CREDENTIALS={"corp_id":"xxx","corp_secret":"xxx"}
 * ```
 */