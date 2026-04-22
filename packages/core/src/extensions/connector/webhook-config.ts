// ============================================================
// Webhook 配置加载器 - 通用动态加载，无需为每个 Connector 编写专门函数
// ============================================================

import { getConnectorRegistry } from './init'

/**
 * Webhook 配置接口（统一格式）
 */
export interface WebhookConfigLoaded {
  connectorId: string
  handler: string
  enabled: boolean
  credentials: Record<string, string>
}

/**
 * 微信系配置（企业微信/公众号/客服共用）
 */
export interface WechatWebhookConfig {
  token: string
  encodingAesKey: string
  appId: string
  subtype: 'wecom' | 'wechat-mp' | 'wechat-kf'
}

/**
 * 飞书配置
 */
export interface FeishuWebhookConfig {
  encryptKey: string
  verificationToken: string
}

/**
 * 配置缓存
 */
let webhookConfigsCache: Map<string, WebhookConfigLoaded> | null = null

/**
 * 加载所有 Webhook 配置
 */
export async function loadWebhookConfigs(): Promise<Map<string, WebhookConfigLoaded>> {
  if (webhookConfigsCache) {
    return webhookConfigsCache
  }

  webhookConfigsCache = new Map()
  const registry = await getConnectorRegistry()
  const connectorIds = registry.getConnectorIds()

  for (const connectorId of connectorIds) {
    const connector = registry.getDefinition(connectorId)

    if (!connector || !connector.enabled || !connector.inbound?.enabled) {
      continue
    }

    const config: WebhookConfigLoaded = {
      connectorId,
      handler: connector.inbound.handler,
      enabled: connector.inbound.enabled,
      credentials: connector.credentials || {},
    }

    webhookConfigsCache.set(connectorId, config)
    console.log('[WebhookConfig] Loaded:', connectorId, 'handler:', config.handler)
  }

  return webhookConfigsCache
}

/**
 * 根据 Connector ID 获取配置
 */
export async function getWebhookConfig(connectorId: string): Promise<WebhookConfigLoaded | null> {
  const configs = await loadWebhookConfigs()
  return configs.get(connectorId) || null
}

/**
 * 根据 Handler 类型获取配置
 * handler: wecom | feishu | test-service | custom
 */
export async function getWebhookConfigByHandler(handler: string): Promise<WebhookConfigLoaded | null> {
  const configs = await loadWebhookConfigs()

  for (const config of configs.values()) {
    if (config.handler === handler) {
      return config
    }
  }

  return null
}

/**
 * 根据请求路径自动匹配配置
 * 例如: /api/connector/webhooks/wecom → handler: wecom
 */
export async function getWebhookConfigByPath(path: string): Promise<WebhookConfigLoaded | null> {
  // 从路径提取 handler 类型
  const match = path.match(/\/webhooks\/([^\/]+)/)
  if (!match) {
    return null
  }

  const handlerFromPath = match[1]

  // 先尝试精确匹配 handler
  const configByHandler = await getWebhookConfigByHandler(handlerFromPath)
  if (configByHandler) {
    return configByHandler
  }

  // 再尝试 connector_id 匹配
  const configById = await getWebhookConfig(handlerFromPath)
  if (configById) {
    return configById
  }

  return null
}

/**
 * 构建微信系 Webhook 配置（通用）
 * 支持: wecom, wechat-mp, wechat-kf
 */
export async function buildWechatWebhookConfig(
  connectorIdOrHandler: string,
  subtype: 'wecom' | 'wechat-mp' | 'wechat-kf'
): Promise<WechatWebhookConfig> {
  // 尝试获取配置
  let config = await getWebhookConfig(connectorIdOrHandler)
  if (!config) {
    config = await getWebhookConfigByHandler(connectorIdOrHandler)
  }

  // 凭证字段映射（不同 connector 的字段名可能不同）
  const credentialMappings: Record<string, Record<string, string>> = {
    wecom: {
      token: 'token',
      encodingAesKey: 'encoding_aes_key',
      appId: 'corp_id',
    },
    'wechat-mp': {
      token: 'token',
      encodingAesKey: 'encoding_aes_key',
      appId: 'app_id',
    },
    'wechat-kf': {
      token: 'token',
      encodingAesKey: 'encoding_aes_key',
      appId: 'app_id',
    },
  }

  const mapping = credentialMappings[subtype] || credentialMappings.wecom

  // 环境变量回退映射
  const envMappings: Record<string, Record<string, string>> = {
    wecom: {
      token: 'WECOM_TOKEN',
      encodingAesKey: 'WECOM_ENCODING_AES_KEY',
      appId: 'WECOM_CORP_ID',
    },
    'wechat-mp': {
      token: 'WECHAT_MP_TOKEN',
      encodingAesKey: 'WECHAT_MP_ENCODING_AES_KEY',
      appId: 'WECHAT_MP_APP_ID',
    },
    'wechat-kf': {
      token: 'WECHAT_KF_TOKEN',
      encodingAesKey: 'WECHAT_KF_ENCODING_AES_KEY',
      appId: 'WECHAT_KF_APP_ID',
    },
  }

  const envMapping = envMappings[subtype] || envMappings.wecom

  return {
    token: config?.credentials[mapping.token] || process.env[envMapping.token] || '',
    encodingAesKey: config?.credentials[mapping.encodingAesKey] || process.env[envMapping.encodingAesKey] || '',
    appId: config?.credentials[mapping.appId] || process.env[envMapping.appId] || '',
    subtype,
  }
}

/**
 * 构建飞书 Webhook 配置（通用）
 */
export async function buildFeishuWebhookConfig(
  connectorIdOrHandler: string = 'feishu'
): Promise<FeishuWebhookConfig> {
  let config = await getWebhookConfig(connectorIdOrHandler)
  if (!config) {
    config = await getWebhookConfigByHandler(connectorIdOrHandler)
  }

  return {
    encryptKey: config?.credentials.encrypt_key || process.env.FEISHU_ENCRYPT_KEY || '',
    verificationToken: config?.credentials.verification_token || process.env.FEISHU_VERIFICATION_TOKEN || '',
  }
}

/**
 * 构建通用 Webhook 配置
 * 用于自定义 handler 或测试服务
 */
export async function buildGenericWebhookConfig(
  connectorIdOrHandler: string
): Promise<Record<string, string>> {
  let config = await getWebhookConfig(connectorIdOrHandler)
  if (!config) {
    config = await getWebhookConfigByHandler(connectorIdOrHandler)
  }

  return config?.credentials || {}
}

/**
 * 刷新配置缓存
 */
export async function refreshWebhookConfigs(): Promise<void> {
  webhookConfigsCache = null
  await loadWebhookConfigs()
  console.log('[WebhookConfig] Refreshed')
}

/**
 * 获取所有已加载的 Webhook Connector 信息
 */
export async function getWebhookConnectorsInfo(): Promise<Array<{
  connectorId: string
  handler: string
  webhookPath: string
}>> {
  const registry = await getConnectorRegistry()
  const result: Array<{ connectorId: string; handler: string; webhookPath: string }> = []

  for (const connectorId of registry.getConnectorIds()) {
    const connector = registry.getDefinition(connectorId)
    if (connector?.inbound?.enabled) {
      result.push({
        connectorId,
        handler: connector.inbound.handler,
        webhookPath: connector.inbound.webhook_path,
      })
    }
  }

  return result
}