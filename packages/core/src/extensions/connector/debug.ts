// ============================================================
// Debug Log Utility - Only logs when DEBUG env is set
// ============================================================

/**
 * Debug log - only outputs when DEBUG environment variable is set
 */
export function debugLog(...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.log(...args)
  }
}

/**
 * Debug warn - only outputs when DEBUG environment variable is set
 */
export function debugWarn(...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.warn(...args)
  }
}

/**
 * Debug error - always outputs errors
 */
export function debugError(...args: unknown[]): void {
  console.error(...args)
}