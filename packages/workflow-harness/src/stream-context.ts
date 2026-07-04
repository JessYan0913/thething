// ============================================================
// Stream Context Tracking
// ============================================================
// Tracks "open" UI message parts across slice boundaries.
// When a slice times out mid-stream, some parts may be open
// (e.g., text-start written but no text-end). The next slice
// replays these as prelude chunks to maintain stream consistency.

import type { UIMessageChunk } from 'ai';
import type { StreamContext, SerializedChunk } from './types';

// ============================================================
// Chunk Tracking
// ============================================================

/**
 * Update stream context based on an emitted chunk.
 * Tracks text-start/text-end, reasoning-start/reasoning-end,
 * and tool-input-start/tool-input-end pairs.
 */
export function trackChunk(chunk: UIMessageChunk, ctx: StreamContext): void {
  const type = (chunk as { type: string }).type;

  switch (type) {
    case 'text-start': {
      const c = chunk as unknown as { type: 'text-start'; id: string; [key: string]: unknown };
      if (!ctx.activeTextParts) ctx.activeTextParts = {};
      ctx.activeTextParts[c.id] = serializeChunk(c);
      break;
    }
    case 'text-end': {
      const c = chunk as unknown as { type: 'text-end'; id: string };
      if (ctx.activeTextParts) {
        delete ctx.activeTextParts[c.id];
        if (Object.keys(ctx.activeTextParts).length === 0) {
          delete ctx.activeTextParts;
        }
      }
      break;
    }
    case 'reasoning-start': {
      const c = chunk as unknown as { type: 'reasoning-start'; id: string; [key: string]: unknown };
      if (!ctx.activeReasoningParts) ctx.activeReasoningParts = {};
      ctx.activeReasoningParts[c.id] = serializeChunk(c);
      break;
    }
    case 'reasoning-end': {
      const c = chunk as unknown as { type: 'reasoning-end'; id: string };
      if (ctx.activeReasoningParts) {
        delete ctx.activeReasoningParts[c.id];
        if (Object.keys(ctx.activeReasoningParts).length === 0) {
          delete ctx.activeReasoningParts;
        }
      }
      break;
    }
    case 'tool-input-start': {
      const c = chunk as unknown as { type: 'tool-input-start'; toolCallId: string; [key: string]: unknown };
      if (!ctx.pendingToolInputs) ctx.pendingToolInputs = {};
      ctx.pendingToolInputs[c.toolCallId] = serializeChunk(c);
      break;
    }
    case 'tool-input-end': {
      const c = chunk as unknown as { type: 'tool-input-end'; toolCallId: string };
      if (ctx.pendingToolInputs) {
        delete ctx.pendingToolInputs[c.toolCallId];
        if (Object.keys(ctx.pendingToolInputs).length === 0) {
          delete ctx.pendingToolInputs;
        }
      }
      break;
    }
  }
}

// ============================================================
// Prelude Writing
// ============================================================

/**
 * Write prelude chunks for any open parts from a previous slice.
 * This ensures the UI stream has matching start/end pairs.
 *
 * Must be called before writing new chunks in a continuation slice.
 */
export function writePrelude(
  ctx: StreamContext,
  writer: WritableStreamDefaultWriter<UIMessageChunk>,
): void {
  // Replay text-start chunks
  if (ctx.activeTextParts) {
    for (const chunk of Object.values(ctx.activeTextParts)) {
      writer.write(deserializeChunk(chunk) as unknown as UIMessageChunk);
    }
  }
  // Replay reasoning-start chunks
  if (ctx.activeReasoningParts) {
    for (const chunk of Object.values(ctx.activeReasoningParts)) {
      writer.write(deserializeChunk(chunk) as unknown as UIMessageChunk);
    }
  }
  // Replay tool-input-start chunks
  if (ctx.pendingToolInputs) {
    for (const chunk of Object.values(ctx.pendingToolInputs)) {
      writer.write(deserializeChunk(chunk) as unknown as UIMessageChunk);
    }
  }
}

// ============================================================
// Close Open Parts
// ============================================================

/**
 * Generate closing chunks for all open parts.
 * Called when a slice times out to ensure clean state.
 * Mutates the context to clear open parts.
 */
export function closeOpenParts(ctx: StreamContext): UIMessageChunk[] {
  const closing: UIMessageChunk[] = [];

  if (ctx.activeTextParts) {
    for (const [id] of Object.entries(ctx.activeTextParts)) {
      closing.push({ type: 'text-end', id } as unknown as UIMessageChunk);
    }
    delete ctx.activeTextParts;
  }

  if (ctx.activeReasoningParts) {
    for (const [id] of Object.entries(ctx.activeReasoningParts)) {
      closing.push({ type: 'reasoning-end', id } as unknown as UIMessageChunk);
    }
    delete ctx.activeReasoningParts;
  }

  if (ctx.pendingToolInputs) {
    for (const [toolCallId] of Object.entries(ctx.pendingToolInputs)) {
      closing.push({ type: 'tool-input-end', toolCallId } as unknown as UIMessageChunk);
    }
    delete ctx.pendingToolInputs;
  }

  return closing;
}

// ============================================================
// Serialization
// ============================================================

export function serialize(ctx: StreamContext): string {
  return JSON.stringify(ctx);
}

export function deserialize(json: string): StreamContext {
  try {
    return JSON.parse(json) as StreamContext;
  } catch {
    return {};
  }
}

// ============================================================
// Internal Helpers
// ============================================================

function serializeChunk(chunk: Record<string, unknown>): SerializedChunk {
  return { ...chunk } as SerializedChunk;
}

function deserializeChunk(chunk: SerializedChunk): Record<string, unknown> {
  return { ...chunk };
}
