import type {
  AdapterInput,
  ConnectorInboundConfig,
  InboundAcceptResult,
  InboundEvent,
} from '../types'

export interface ProtocolAdapter {
  readonly protocol: string
  verify(input: AdapterInput, config: ConnectorInboundConfig): Promise<boolean>
  decrypt?(input: AdapterInput, config: ConnectorInboundConfig): Promise<AdapterInput>
  parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent>
  challenge?(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundAcceptResult | null>
}

