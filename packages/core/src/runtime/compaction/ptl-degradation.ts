import type { UIMessage } from "ai";
import { estimateMessagesTokens, estimateMessageTokens } from "./token-counter";
import { microCompactMessages } from "./micro-compact";

/**
 * PTL (Prompt Too Long) Emergency Degradation.
 * When compaction still leaves the prompt over the token limit,
 * this provides an emergency degradation path:
 *   1. Micro-compact as first attempt
 *   2. Hard truncation as last resort
 *
 * Reference: CCB reactive compact + truncateHeadForPTLRetry
 */

const PTL_RETRY_THRESHOLD = 30_000;
const PTL_HARD_TRUNCATE_TARGET = 20_000;

export async function tryPtlDegradation(
  messages: UIMessage[]
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  const currentTokens = await estimateMessagesTokens(messages);

  if (currentTokens < PTL_RETRY_THRESHOLD) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  console.warn(
    `[PTL Degradation] Prompt too long (${currentTokens} tokens), attempting emergency degradation`
  );

  // Step 1: Try micro-compact first (fast, no API call)
  const microResult = await microCompactMessages(messages);
  const afterMicro = await estimateMessagesTokens(microResult.messages);

  if (afterMicro < PTL_RETRY_THRESHOLD) {
    console.log(
      `[PTL Degradation] Micro-compact resolved the issue: ${currentTokens} → ${afterMicro} tokens`
    );
    return microResult;
  }

  // Step 2: Hard truncation (last resort)
  console.warn(
    `[PTL Degradation] Micro-compact insufficient (${afterMicro} tokens), falling back to hard truncation`
  );
  return hardTruncateToTarget(messages, PTL_HARD_TRUNCATE_TARGET);
}

/**
 * Hard truncate messages from the head, preserving the most recent context.
 * Always preserves the first system message and the last user message pair.
 */
async function hardTruncateToTarget(
  messages: UIMessage[],
  targetTokens: number
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  const preTokens = await estimateMessagesTokens(messages);

  // Always preserve the first system instruction message
  const firstSystemMsg = messages.find((m) => m.role === "system" && m.parts.some((p) => p.type === "text" && !isBoundaryText(p.text)));

  // Work backwards from the end to find how many recent messages fit in the budget
  let totalTokens = 0;
  let startIndex = messages.length - 1;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = await estimateMessageTokens(msg);
    totalTokens += msgTokens;

    if (totalTokens >= targetTokens) {
      startIndex = i + 1;
      break;
    }
    startIndex = i;
  }

  // Adjust to include the first system message if not already included
  if (firstSystemMsg) {
    const sysIdx = messages.indexOf(firstSystemMsg);
    if (sysIdx < startIndex) {
      startIndex = sysIdx;
    }
  }

  // Don't truncate to less than 3 messages
  if (messages.length - startIndex < 3) {
    startIndex = Math.max(0, messages.length - 3);
  }

  const truncated = messages.slice(startIndex);
  const postTokens = await estimateMessagesTokens(truncated);
  const tokensFreed = preTokens - postTokens;

  console.log(
    `[PTL Hard Truncate] ${messages.length} → ${truncated.length} messages, freed ${tokensFreed} tokens, remaining: ${postTokens}`
  );

  return { messages: truncated, executed: true, tokensFreed };
}

function isBoundaryText(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed?.type === "SYSTEM_COMPACT_BOUNDARY";
  } catch {
    return false;
  }
}