// ============================================================
// Webhook 配置加载器 - 从 Connector YAML 配置动态加载 Webhook 配置
// ============================================================

import { getConnectorRegistry } from './init'
import type { ConnectorDefinition } from './types'

/**
 * Webhook 配置接口
 */
export interface WebhookConfigLoaded {
  connectorId: string
  connectorType: string
  enabled: boolean
  webhookPath: string
  handler: string
  credentials: Record<string, string>
}

/**
 * Webhook 配置缓存
 */
let webhookConfigs: Map<string, WebhookConfigLoaded> | null = null

/**
 * 加载所有 Connector 的 Webhook 配置
 */
export async function loadWebhookConfigs(): Promise<Map<string, WebhookConfigLoaded>> {
  if (webhookConfigs) {
    return webhookConfigs
  }

  webhookConfigs = new Map()
  const registry = await getConnectorRegistry()
  const connectorIds = registry.getConnectorIds()

  for (const connectorId of connectorIds) {
    const connector = registry.getDefinition(connectorId)

    if (!connector || !connector.enabled || !connector.inbound?.enabled) {
      continue
    }

    const config: WebhookConfigLoaded = {
      connectorId,
      connectorType: connector.inbound.handler,
      enabled: connector.inbound.enabled,
      webhookPath: connector.inbound.webhook_path,
      handler: connector.inbound.handler,
      credentials: connector.credentials || {},
    }

    webhookConfigs.set(connectorId, config)
    console.log('[WebhookConfig] Loaded:', connectorId, 'handler:', config.handler)
  }

  return webhookConfigs
}

/**
 * 获取指定 Connector 的 Webhook 配置
 */
export async function getWebhookConfig(connectorId: string): Promise<WebhookConfigLoaded | null> {
  const configs = await loadWebhookConfigs()
  return configs.get(connectorId) || null
}

/**
 * 根据 handler 类型获取配置
 * handler 类型: wecom | feishu | test-service
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
 * 获取企业微信 Webhook 配置
 */
export async function getWecomWebhookConfig(): Promise<{
  token: string
  encodingAesKey: string
  appId: string
  subtype: 'wecom'
} | null> {
  const config = await getWebhookConfigByHandler('wecom')

  if (!config) {
    // 回退到环境变量
    return {
      token: process.env.WECOM_TOKEN || '',
      encodingAesKey: process.env.WECOM_ENCODING_AES_KEY || '',
      appId: process.env.WECOM_CORP_ID || '',
      subtype: 'wecom',
    }
  }

  return {
    token: config.credentials.token || process.env.WECOM_TOKEN || '',
    encodingAesKey: config.credentials.encoding_aes_key || process.env.WECOM_ENCODING_AES_KEY || '',
    appId: config.credentials.corp_id || process.env.WECOM_CORP_ID || '',
    subtype: 'wecom',
  }
}

/**
 * 获取微信公众号 Webhook 配置
 */
export async function getWechatMpWebhookConfig(): Promise<{
  token: string
  encodingAesKey: string
  appId: string
  subtype: 'wechat-mp'
} | null> {
  const config = await getWebhookConfig('wechat-mp')

  if (!config) {
    // 回退到环境变量
    return {
      token: process.env.WECHAT_MP_TOKEN || '',
      encodingAesKey: process.env.WECHAT_MP_ENCODING_AES_KEY || '',
      appId: process.env.WECHAT_MP_APP_ID || '',
      subtype: 'wechat-mp',
    }
  }

  return {
    token: config.credentials.token || process.env.WECHAT_MP_TOKEN || '',
    encodingAesKey: config.credentials.encoding_aes_key || process.env.WECHAT_MP_ENCODING_AES_KEY || '',
    appId: config.credentials.app_id || process.env.WECHAT_MP_APP_ID || '',
    subtype: 'wechat-mp',
  }
}

/**
 * 获取飞书 Webhook 配置
 */
export async function getFeishuWebhookConfig(): Promise<{
  encryptKey: string
  verificationToken: string
} | null> {
  const config = await getWebhookConfigByHandler('feishu')

  if (!config) {
    // 回退到环境变量
    return {
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    }
  }

  return {
    encryptKey: config.credentials.encrypt_key || process.env.FEISHU_ENCRYPT_KEY || '',
    verificationToken: config.credentials.verification_token || process.env.FEISHU_VERIFICATION_TOKEN || '',
  }
}

/**
 * 获取测试服务 Webhook 配置
 */
export async function getTestServiceWebhookConfig(): Promise<Record<string, string>> {
  const config = await getWebhookConfigByHandler('test-service')

  if (!config) {
    return {}
  }

  return config.credentials
}

/**
 * 刷新 Webhook 配置（重新从 YAML 加载）
 */
export async function refreshWebhookConfigs(): Promise<void> {
  webhookConfigs = null
  await loadWebhookConfigs()
  console.log('[WebhookConfig] Refreshed')
}