import type { UIMessage } from "ai";

/**
 * Compact Hook mechanism.
 * Allows registering custom handlers that run before and after compaction
 * to inject preservation markers, validate context, or restore critical data.
 *
 * Reference: CCB Pre-compact / Post-compact / Session Start Hooks
 */

export type CompactHookPhase = "pre-compact" | "post-compact" | "session-start";

export interface CompactHookContext {
  conversationId: string;
  messages: UIMessage[];
  phase: CompactHookPhase;
  /** Only available in post-compact phase */
  result?: {
    executed: boolean;
    tokensFreed: number;
    type: string | null;
    messages: UIMessage[];
  };
}

export interface CompactHookResult {
  /** Override messages (post-compact only) */
  messages?: UIMessage[];
  /** Markers that should be preserved during compaction */
  preserveMarkers?: string[];
}

type CompactHookHandler = (context: CompactHookContext) => Promise<CompactHookResult>;

const hooks = new Map<string, CompactHookHandler>();

/**
 * Register a hook that runs during compaction.
 * Hooks execute in registration order.
 */
export function registerCompactHook(name: string, handler: CompactHookHandler): void {
  hooks.set(name, handler);
  console.log(`[Compact Hook] Registered: "${name}"`);
}

/**
 * Unregister a hook by name.
 */
export function unregisterCompactHook(name: string): void {
  hooks.delete(name);
}

/**
 * Execute all registered hooks for the given phase.
 * Results are merged — later hooks can override earlier ones.
 */
export async function executeCompactHooks(
  context: CompactHookContext
): Promise<CompactHookResult> {
  const result: CompactHookResult = {};

  for (const [name, handler] of hooks) {
    try {
      const hookResult = await handler(context);

      if (hookResult.messages) {
        result.messages = hookResult.messages;
      }
      if (hookResult.preserveMarkers) {
        result.preserveMarkers = [
          ...(result.preserveMarkers || []),
          ...hookResult.preserveMarkers,
        ];
      }

      console.log(`[Compact Hook] "${name}" (${context.phase}) completed`);
    } catch (error) {
      console.error(`[Compact Hook] "${name}" (${context.phase}) failed:`, error);
    }
  }

  return result;
}

/**
 * Get all registered hook names.
 */
export function getRegisteredHooks(): string[] {
  return Array.from(hooks.keys());
}
