import type { ConnectorRegistry } from '../../registry'
import type { OutboundMessage, ReplyAddress, RespondResult } from '../types'

export interface ResponderOptions {
  registry: ConnectorRegistry
}

export class ConnectorResponder {
  constructor(private readonly options: ResponderOptions) {}

  async respond(address: ReplyAddress, message: OutboundMessage): Promise<RespondResult> {
    const connector = this.options.registry.getDefinition(address.connectorId)
    const replyConfig = connector?.inbound?.reply
    if (replyConfig) {
      const result = await this.options.registry.callTool({
        connectorId: address.connectorId,
        toolName: replyConfig.tool,
        input: renderReplyInput(replyConfig.input, {
          replyAddress: address,
          message,
        }) as Record<string, unknown>,
      })

      return {
        success: result.success,
        result: result.result,
        error: result.error,
      }
    }

    return {
      success: false,
      error: `No reply mapping for connector: ${address.connectorId}`,
    }
  }
}

interface ReplyRenderContext {
  replyAddress: ReplyAddress
  message: OutboundMessage
}

function renderReplyInput(value: unknown, context: ReplyRenderContext): unknown {
  if (typeof value === 'string') {
    return renderReplyString(value, context)
  }

  if (Array.isArray(value)) {
    return value.map(item => renderReplyInput(item, context))
  }

  if (value && typeof value === 'object') {
    const rendered: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const nextValue = renderReplyInput(child, context)
      if (nextValue !== undefined) {
        rendered[key] = nextValue
      }
    }
    return rendered
  }

  return value
}

function renderReplyString(template: string, context: ReplyRenderContext): unknown {
  if (template.startsWith('$') && !template.includes(' ')) {
    const direct = resolveReplyPath(template.slice(1), context)
    if (direct !== undefined) return direct
  }

  return template.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const value = resolveReplyPath(path, context)
    return value === undefined || value === null ? '' : String(value)
  })
}

function resolveReplyPath(path: string, context: ReplyRenderContext): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = context

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}
