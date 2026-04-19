import type { UIMessage } from "ai";
import { COMPACT_TOKEN_THRESHOLD, type CompactionResult } from "./types";
import { estimateMessagesTokens } from "./token-counter";
import { microCompactMessages } from "./micro-compact";
import { trySessionMemoryCompact } from "./session-memory-compact";
import { getMessagesAfterCompactBoundary } from "./boundary";
import { tryPtlDegradation } from "./ptl-degradation";
import { autoCompactIfNeeded, recordCompactSuccess } from "./auto-compact";
import { getSummaryByConversation } from "../chat-store";

export async function compactMessagesIfNeeded(
  messages: UIMessage[],
  conversationId: string,
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  // 检查是否需要自动压缩
  const shouldAutoCompact = await autoCompactIfNeeded(messages, conversationId);
  if (!shouldAutoCompact) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  const tokenCount = estimateMessagesTokens(messages);

  if (tokenCount < COMPACT_TOKEN_THRESHOLD) {
    return { messages, executed: false, tokensFreed: 0 };
  }

  const messagesAfterBoundary = getMessagesAfterCompactBoundary(messages);
  const tokensAfterBoundary = estimateMessagesTokens(messagesAfterBoundary);

  if (tokensAfterBoundary < COMPACT_TOKEN_THRESHOLD * 0.5) {
    const summaryMessage = messages.find(
      (m) =>
        m.role === "system" &&
        m.parts.some(
          (p) =>
            p.type === "text" &&
            p.text.includes("[Previous conversation summary]"),
        ),
    );

    if (summaryMessage) {
      return {
        messages: [summaryMessage, ...messagesAfterBoundary],
        executed: false,
        tokensFreed: 0,
      };
    }
  }

  // Fast path 1: use existing DB summary (no LLM call, instant)
  try {
    const sessionMemoryResult = await trySessionMemoryCompact(
      messagesAfterBoundary,
      conversationId,
    );

    if (sessionMemoryResult) {
      console.log(
        `[Compaction] Session Memory Compact: freed ${sessionMemoryResult.tokensFreed} tokens`,
      );
      recordCompactSuccess(conversationId);
      return {
        messages: sessionMemoryResult.messages,
        executed: true,
        tokensFreed: sessionMemoryResult.tokensFreed,
      };
    }
  } catch (error) {
    console.error("[Compaction] Session Memory Compact failed:", error);
  }

  // Fast path 2: micro-compact (no LLM call)
  const microResult = microCompactMessages(messagesAfterBoundary);

  if (microResult.executed) {
    const tokensAfterMicro = estimateMessagesTokens(microResult.messages);
    console.log(
      `[Compaction] MicroCompact: freed ${microResult.tokensFreed} tokens, remaining: ${tokensAfterMicro}`,
    );

    if (tokensAfterMicro < COMPACT_TOKEN_THRESHOLD) {
      recordCompactSuccess(conversationId);
      return {
        messages: microResult.messages,
        executed: true,
        tokensFreed: microResult.tokensFreed,
      };
    }
  }

  // Fast path 3: PTL emergency hard-truncation (no LLM call)
  const ptlResult = tryPtlDegradation(microResult.messages);
  if (ptlResult.executed) {
    console.log(
      `[Compaction] PTL Degradation applied: freed ${ptlResult.tokensFreed} tokens`,
    );
    // Inject existing DB summary to restore context lost by truncation
    const storedSummary = getSummaryByConversation(conversationId);
    if (storedSummary) {
      const summaryMessage: UIMessage = {
        id: `summary-${Date.now()}`,
        role: "system",
        parts: [
          {
            type: "text",
            text: `[Previous conversation summary]\n${storedSummary.summary}\n\n[End of summary]`,
          },
        ],
      };
      return {
        messages: [summaryMessage, ...ptlResult.messages],
        executed: true,
        tokensFreed: ptlResult.tokensFreed,
      };
    }
    recordCompactSuccess(conversationId);
    return {
      messages: ptlResult.messages,
      executed: true,
      tokensFreed: ptlResult.tokensFreed,
    };
  }

  // All fast paths exhausted — LLM summary will be generated async after this response
  console.warn(
    `[Compaction] No fast-path compaction succeeded for ${conversationId}. ` +
      `LLM summary will be generated in background after this response.`,
  );
  return {
    messages: microResult.messages,
    executed: microResult.executed,
    tokensFreed: microResult.tokensFreed,
  };
}

export async function compactMessagesWithCustomInstructions(
  messages: UIMessage[],
  conversationId: string,
  customInstructions: string,
): Promise<CompactionResult> {
  const { compactWithCustomInstructions } = await import("./api-compact");
  return compactWithCustomInstructions(
    messages,
    conversationId,
    customInstructions,
  );
}

export { estimateMessagesTokens } from "./token-counter";

export { microCompactMessages } from "./micro-compact";

export { trySessionMemoryCompact } from "./session-memory-compact";

export { compactViaAPI } from "./api-compact";

export {
  createCompactBoundaryMessage,
  isCompactBoundaryMessage,
  parseCompactBoundaryMetadata,
  getMessagesAfterCompactBoundary,
  getLastBoundaryMessage,
  hasCompactBoundary,
  stripCompactBoundaries,
} from "./boundary";

export {
  runCompactInBackground,
  isCompactInProgress,
  getQueueSize,
} from "./background-queue";

export {
  reinjectAfterCompact,
  POST_COMPACT_CONFIG,
  type ReinjectContext,
} from "./post-compact-reinject";

export { tryPtlDegradation } from "./ptl-degradation";

export {
  registerCompactHook,
  unregisterCompactHook,
  executeCompactHooks,
  getRegisteredHooks,
  type CompactHookPhase,
  type CompactHookContext,
  type CompactHookResult,
} from "./hooks";

export {
  COMPACT_TOKEN_THRESHOLD,
  DEFAULT_SESSION_MEMORY_CONFIG,
  DEFAULT_MICRO_COMPACT_CONFIG,
  DEFAULT_POST_COMPACT_CONFIG,
} from "./types";

export {
  shouldTriggerAutoCompact,
  autoCompactIfNeeded,
  recordCompactFailure,
  recordCompactSuccess,
  getAutoCompactStatus,
} from "./auto-compact";

export type {
  CompactionResult,
  CompactMetadata,
  CompactBoundaryMessage,
  CompactionType,
  SessionMemoryCompactConfig,
  MicroCompactConfig,
  PostCompactConfig,
} from "./types";
