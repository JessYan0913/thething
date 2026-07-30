// ============================================================
// Sanitize UIMessages - fix tool parts that would break API calls
// ============================================================
// When a tool call errors, the AI SDK stores `rawInput` (a string)
// instead of `input` (an object). convertToModelMessages falls back
// to rawInput, and the OpenAI-compatible provider then does
// JSON.stringify(stringInput) — producing double-serialized arguments
// that many providers (e.g. Ark / deepseek) reject with HTTP 400.
//
// This module sanitizes UIMessages before they reach the conversion
// step, ensuring every error-state tool part has a proper `input`
// object.

import type { UIMessage } from 'ai'
import { logger } from '../../primitives/logger'

/**
 * Detect whether a UIMessage part is a tool invocation part
 * (AI SDK v5+ uses type `tool-<toolName>`).
 */
function isToolUIPart(part: Record<string, unknown>): boolean {
  return typeof part.type === 'string' && part.type.startsWith('tool-')
}

/**
 * Sanitize UIMessages by fixing error-state tool parts whose `rawInput`
 * is a string instead of a parsed object. Parses `rawInput` back to an
 * object so that downstream JSON.stringify produces valid `arguments`.
 *
 * Also handles the edge case where `input` itself is a string (some
 * older stored messages may have this shape).
 */
export function sanitizeToolErrorInputs(messages: UIMessage[]): UIMessage[] {
  return messages.map(msg => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.parts)) return msg

    let changed = false
    const sanitizedParts = msg.parts.map(part => {
      const p = part as unknown as Record<string, unknown>
      if (!isToolUIPart(p) || p.state !== 'output-error') return part

      // Case 1: input is missing but rawInput exists (string)
      if (p.input == null && p.rawInput != null) {
        changed = true
        const rawInput = p.rawInput
        if (typeof rawInput === 'string') {
          try {
            const parsed = JSON.parse(rawInput)
            return { ...part, input: parsed } as typeof part
          } catch {
            // rawInput is not valid JSON — use a minimal fallback
            logger.warn(
              'sanitizeToolErrorInputs',
              `rawInput for ${p.type} (${p.toolCallId}) is not valid JSON, using empty object`,
            )
            return { ...part, input: {} } as typeof part
          }
        }
        // rawInput is already an object — use it directly
        return { ...part, input: rawInput } as typeof part
      }

      // Case 2: input is a string (double-serialization risk)
      if (typeof p.input === 'string') {
        changed = true
        try {
          const parsed = JSON.parse(p.input)
          return { ...part, input: parsed } as typeof part
        } catch {
          logger.warn(
            'sanitizeToolErrorInputs',
            `input string for ${p.type} (${p.toolCallId}) is not valid JSON, using empty object`,
          )
          return { ...part, input: {} } as typeof part
        }
      }

      return part
    })

    return changed ? { ...msg, parts: sanitizedParts } : msg
  })
}

// ============================================================
// Provider-level safety net: fixDoubleSerializedArguments
// ============================================================
// Even after UIMessage-level sanitization, a tool call can arrive
// at the provider with double-serialized `arguments` if:
//   - The error occurred during the CURRENT agent run (the tool
//     part hasn't been through DB load → sanitizeToolErrorInputs)
//   - Some other code path bypasses the UIMessage sanitization
//
// This function is used as `transformRequestBody` in
// createModelProvider, running on every API request as the
// last-mile guard before the HTTP call.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RequestBody = Record<string, any>

/**
 * Detect and fix double-serialized `arguments` in assistant tool_calls.
 *
 * A normal `arguments` value is `JSON.stringify(object)` → e.g. `'{"a":1}'`.
 * A double-serialized value is `JSON.stringify(JSON.stringify(object))` →
 * e.g. `'"{\\"a\\":1}"'`. When the provider sends this to the API, the
 * server parses `arguments` and gets a string instead of an object,
 * causing HTTP 400 on providers like Ark / deepseek.
 *
 * This function unwraps the outer string layer when detected.
 */
export function fixDoubleSerializedArguments(body: RequestBody): RequestBody {
  const messages = body.messages
  if (!Array.isArray(messages)) return body

  let changed = false
  const fixedMessages = messages.map((msg: Record<string, unknown>) => {
    if (msg.role !== 'assistant') return msg
    const toolCalls = msg.tool_calls
    if (!Array.isArray(toolCalls)) return msg

    let tcChanged = false
    const fixedToolCalls = toolCalls.map((tc: Record<string, unknown>) => {
      const fn = tc.function as Record<string, unknown> | undefined
      if (!fn || typeof fn.arguments !== 'string') return tc

      try {
        const parsed = JSON.parse(fn.arguments)
        // If parsed is still a string, it was double-serialized
        if (typeof parsed === 'string') {
          tcChanged = true
          try {
            const inner = JSON.parse(parsed)
            return { ...tc, function: { ...fn, arguments: JSON.stringify(inner) } }
          } catch {
            // Inner parse failed — use the outer-parsed string directly
            return { ...tc, function: { ...fn, arguments: parsed } }
          }
        }
      } catch {
        // Can't parse at all — leave as-is, let the API handle it
      }
      return tc
    })

    if (tcChanged) {
      changed = true
      return { ...msg, tool_calls: fixedToolCalls }
    }
    return msg
  })

  return changed ? { ...body, messages: fixedMessages } : body
}
