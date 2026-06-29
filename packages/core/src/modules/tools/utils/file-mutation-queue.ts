/**
 * File mutation queue — serializes writes to the same file path.
 *
 * Prevents concurrent tool calls from conflicting on the same file by
 * ensuring mutations to a given absolute path run sequentially.
 */

const mutationQueues = new Map<string, Promise<unknown>>();

/**
 * Run an async mutation within a per-file serialization queue.
 * Each call for the same `absolutePath` waits for the previous one to settle.
 */
export async function withFileMutationQueue<T>(
  absolutePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = mutationQueues.get(absolutePath) ?? Promise.resolve();

  const next = existing
    .then(() => fn(), () => fn()) // run regardless of prior failure
    .finally(() => {
      // Clean up if this is the last entry in the queue
      if (mutationQueues.get(absolutePath) === next) {
        mutationQueues.delete(absolutePath);
      }
    });

  mutationQueues.set(absolutePath, next);
  return next;
}

/** Clear all pending mutation queues (e.g., on session end) */
export function clearMutationQueues(): void {
  mutationQueues.clear();
}
