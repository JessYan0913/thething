import type { HighWaterMark } from './types';
import { TASK_ID_PREFIX } from './types';

/**
 * HighWaterMark implementation for generating unique task IDs
 * 
 * Uses a monotonically increasing counter to ensure unique IDs
 * even across distributed systems or multiple instances.
 */
export class HighWaterMarkImpl implements HighWaterMark {
  private value: number;

  constructor(initialValue: number = 1) {
    this.value = initialValue;
  }

  /**
   * Get the next unique ID and increment the counter
   */
  next(): string {
    const id = `${TASK_ID_PREFIX}${this.value}`;
    this.value++;
    return id;
  }

  /**
   * Get the current value without incrementing
   */
  current(): number {
    return this.value;
  }

  /**
   * Reset to a specific value
   * Useful for testing or recovering from persisted state
   */
  reset(value: number): void {
    if (value < 0) {
      throw new Error('HighWaterMark value cannot be negative');
    }
    this.value = value;
  }
}

/**
 * Parse a task ID to extract its numeric value
 */
export function parseTaskId(id: string): number | null {
  if (!id.startsWith(TASK_ID_PREFIX)) {
    return null;
  }
  const numStr = id.slice(TASK_ID_PREFIX.length);
  const num = parseInt(numStr, 10);
  return isNaN(num) ? null : num;
}

/**
 * Create a new HighWaterMark from an array of existing IDs
 * Useful for initializing from persisted state
 */
export function createHighWaterMarkFromIds(ids: string[]): HighWaterMarkImpl {
  let maxValue = 0;
  
  for (const id of ids) {
    const parsed = parseTaskId(id);
    if (parsed !== null && parsed > maxValue) {
      maxValue = parsed;
    }
  }
  
  // Start from the next value after the max
  return new HighWaterMarkImpl(maxValue + 1);
}

/**
 * Global HighWaterMark instance for task ID generation
 * This ensures unique IDs across the entire application
 */
let globalHighWaterMark: HighWaterMarkImpl | null = null;

export function getGlobalHighWaterMark(): HighWaterMarkImpl {
  if (!globalHighWaterMark) {
    globalHighWaterMark = new HighWaterMarkImpl(1);
  }
  return globalHighWaterMark;
}

export function setGlobalHighWaterMark(hwm: HighWaterMarkImpl): void {
  globalHighWaterMark = hwm;
}

/**
 * Reset the global HighWaterMark (mainly for testing)
 */
export function resetGlobalHighWaterMark(): void {
  globalHighWaterMark = new HighWaterMarkImpl(1);
}
