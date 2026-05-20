export interface InboundPostProcess {
  run(): Promise<void>
}

