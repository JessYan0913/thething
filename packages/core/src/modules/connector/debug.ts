// ============================================================
// Debug Log Utility - Only logs when DEBUG env is set
// ============================================================

import { logger, isDebugEnabled } from '../../primitives/logger'

let connectorDebugEnabled = false

export function setConnectorDebugEnabled(enabled: boolean): void {
  connectorDebugEnabled = enabled
}

/**
 * Debug log - only outputs when DEBUG environment variable is set
 */
export function debugLog(...args: unknown[]): void {
  if (connectorDebugEnabled || isDebugEnabled()) {
    logger.debug('Connector', args.map(a => String(a)).join(' '))
  }
}

/**
 * Debug warn - only outputs when DEBUG environment variable is set
 */
export function debugWarn(...args: unknown[]): void {
  if (connectorDebugEnabled || isDebugEnabled()) {
    logger.warn('Connector', args.map(a => String(a)).join(' '))
  }
}

/**
 * Debug error - always outputs errors
 */
export function debugError(...args: unknown[]): void {
  logger.error('Connector', args.map(a => String(a)).join(' '))
}
