// ============================================================
// Debug Log Utility - Only logs when DEBUG env is set
// ============================================================

let connectorDebugEnabled = false

export function setConnectorDebugEnabled(enabled: boolean): void {
  connectorDebugEnabled = enabled
}

/**
 * Debug log - only outputs when DEBUG environment variable is set
 */
export function debugLog(...args: unknown[]): void {
  if (connectorDebugEnabled) {
    console.log(...args)
  }
}

/**
 * Debug warn - only outputs when DEBUG environment variable is set
 */
export function debugWarn(...args: unknown[]): void {
  if (connectorDebugEnabled) {
    console.warn(...args)
  }
}

/**
 * Debug error - always outputs errors
 */
export function debugError(...args: unknown[]): void {
  console.error(...args)
}
