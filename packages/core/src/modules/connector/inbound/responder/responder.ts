import type { ConnectorRegistry } from '../../registry'
import type { OutboundMessage, ReplyAddress, RespondResult } from '../types'
import { renderObject } from '../../template'

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
        input: renderObject(replyConfig.input, {
          replyAddress: address as unknown as Record<string, unknown>,
          message: message as unknown as Record<string, unknown>,
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
