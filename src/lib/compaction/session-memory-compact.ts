import type { UIMessage } from "ai";
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
  type SessionMemoryCompactConfig,
  type CompactBoundaryMessage,
  SYSTEM_COMPACT_BOUNDARY_MARKER,
} from "./types";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  hasTextBlocks,
  extractMessageText,
} from "./token-counter";
import type { StoredSummary } from "./types";
import { getDb } from "@/lib/db";

function isFeatureEnabled(featureName: string): boolean {
  const envKey = `FEATURE_${featureName.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey] === "true" || process.env[envKey] === "1";
}

export function shouldUseSessionMemoryCompaction(): boolean {
  if (process.env.ENABLE_SM_COMPACT === "true") {
    return true;
  }
  if (process.env.DISABLE_SM_COMPACT === "true") {
    return false;
  }
  const sessionMemoryFlag = isFeatureEnabled("session_memory");
  const smCompactFlag = isFeatureEnabled("sm_compact");
  return sessionMemoryFlag && smCompactFlag;
}

function getSummaryByConversation(conversationId: string): StoredSummary | null {
  try {
    const db = getDb();
    const stmt = db.prepare(
      "SELECT * FROM summaries WHERE conversation_id = ? ORDER BY compacted_at DESC LIMIT 1"
    );
    const row = stmt.get(conversationId) as StoredSummary | undefined;
    return row || null;
  } catch {
    return null;
  }
}

function validateSummaryBoundary(
  summary: StoredSummary,
  messages: UIMessage[],
  expectedBoundaryIndex: number
): boolean {
  if (expectedBoundaryIndex < 0 || expectedBoundaryIndex >= messages.length) {
    console.warn(
      `[Compaction] Summary boundary index out of range: ${expectedBoundaryIndex}`
    );
    return false;
  }

  const boundaryMessage = messages[expectedBoundaryIndex];
  const boundaryText = extractMessageText(boundaryMessage);

  const summaryText = summary.summary.toLowerCase();
  const boundarySnippet = boundaryText.substring(0, 50).toLowerCase();

  const keyTerms = boundarySnippet
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["the", "and", "for", "with", "this", "that"].includes(w));

  const matchCount = keyTerms.filter((term) => summaryText.includes(term)).length;

  if (matchCount === 0 && keyTerms.length > 0) {
    console.warn(
      `[Compaction] Summary appears stale - no overlap with boundary message at index ${expectedBoundaryIndex}`
    );
    return false;
  }

  return true;
}

function findToolUseIndex(
  messages: UIMessage[],
  toolCallId: string
): number {
  for (let i = 0; i < messages.length; i++) {
    for (const part of messages[i].parts) {
      if (part.type === "dynamic-tool" && (part as { toolCallId?: string }).toolCallId === toolCallId) {
        return i;
      }
    }
  }
  return -1;
}

function extractToolResultIds(message: UIMessage): string[] {
  const ids: string[] = [];
  for (const part of message.parts) {
    if (part.type === "dynamic-tool") {
      const toolCallId = (part as { toolCallId?: string }).toolCallId;
      if (toolCallId) ids.push(toolCallId);
    }
  }
  return ids;
}

function preserveToolPairs(
  messages: UIMessage[],
  startIndex: number
): number {
  let adjustedStart = startIndex;

  // Step 1: Handle tool_use/tool_result pairs
  for (let i = startIndex; i < messages.length; i++) {
    const toolResultIds = extractToolResultIds(messages[i]);
    for (const toolCallId of toolResultIds) {
      const toolUseIndex = findToolUseIndex(messages, toolCallId);
      if (toolUseIndex >= 0 && toolUseIndex < adjustedStart) {
        adjustedStart = toolUseIndex;
      }
    }
  }

  // Step 2: Handle thinking blocks that share message.id with kept assistant messages
  // Streaming splits one assistant message into multiple records (thinking, tool_use, etc.)
  // Each has unique uuid but shares the same message.id
  const messageIdsInKeptRange = new Set<string>();
  for (let i = adjustedStart; i < messages.length; i++) {
    const msg = messages[i] as unknown as Record<string, unknown>;
    if (messages[i].role === "assistant" && typeof msg.id === "string") {
      messageIdsInKeptRange.add(msg.id);
    }
  }

  // Look backwards for assistant messages with the same message.id
  // These may contain thinking blocks that need to be merged
  for (let i = adjustedStart - 1; i >= 0; i--) {
    const msg = messages[i] as unknown as Record<string, unknown>;
    if (
      messages[i].role === "assistant" &&
      typeof msg.id === "string" &&
      messageIdsInKeptRange.has(msg.id)
    ) {
      adjustedStart = i;
    }
  }

  return adjustedStart;
}

function calculateMessagesToKeepIndex(
  messages: UIMessage[],
  lastSummarizedIndex: number,
  config: SessionMemoryCompactConfig = DEFAULT_SESSION_MEMORY_CONFIG
): number {
  let startIndex = lastSummarizedIndex + 1;
  let totalTokens = 0;
  let textBlockMessageCount = 0;

  const floor = 1;

  for (let i = startIndex - 1; i >= floor; i--) {
    const msg = messages[i];
    totalTokens += estimateMessageTokens(msg);
    if (hasTextBlocks(msg)) textBlockMessageCount++;

    startIndex = i;

    if (totalTokens >= config.maxTokens) break;
    if (
      totalTokens >= config.minTokens &&
      textBlockMessageCount >= config.minTextBlockMessages
    ) {
      break;
    }
  }

  startIndex = preserveToolPairs(messages, startIndex);

  return startIndex;
}

export async function trySessionMemoryCompact(
  messages: UIMessage[],
  conversationId: string,
  config: Partial<SessionMemoryCompactConfig> = {}
): Promise<{
  messages: UIMessage[];
  executed: boolean;
  tokensFreed: number;
  summaryInjected: boolean;
} | null> {
  if (!shouldUseSessionMemoryCompaction()) {
    return null;
  }

  const resolvedConfig = { ...DEFAULT_SESSION_MEMORY_CONFIG, ...config };

  const summary = getSummaryByConversation(conversationId);
  if (!summary) return null;

  const lastSummarizedOrder = summary.lastMessageOrder;
  let lastSummarizedIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as unknown as Record<string, unknown>;
    if (msg.order === lastSummarizedOrder) {
      lastSummarizedIndex = i;
      break;
    }
  }

  if (lastSummarizedIndex < 0) {
    let runningOrder = 0;
    for (let i = 0; i < messages.length; i++) {
      runningOrder++;
      if (runningOrder > lastSummarizedOrder) {
        lastSummarizedIndex = i - 1;
        break;
      }
    }
  }

  if (lastSummarizedIndex < 0) return null;

  if (!validateSummaryBoundary(summary, messages, lastSummarizedIndex)) {
    console.warn(
      "[Compaction] Summary boundary validation failed, falling back to full compaction"
    );
    return null;
  }

  const keepFromIndex = calculateMessagesToKeepIndex(
    messages,
    lastSummarizedIndex,
    resolvedConfig
  );

  if (keepFromIndex >= messages.length - 2) return null;

  const preCompactTokens = estimateMessagesTokens(messages);

  const preservedMessages = messages.slice(keepFromIndex);

  const summaryMessage: UIMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: `[Previous conversation summary]\n${summary.summary}\n\n[End of summary]`,
      },
    ],
  };

  const tokensFreed = preCompactTokens - estimateMessagesTokens(preservedMessages);

  return {
    messages: [summaryMessage, ...preservedMessages],
    executed: true,
    tokensFreed,
    summaryInjected: true,
  };
}

export function createSessionMemoryBoundary(
  preCompactTokenCount: number,
  lastUserMessageId: string,
  preservedMessages: UIMessage[],
  summaryId: string
): CompactBoundaryMessage {
  const preservedSegment = preservedMessages.length > 0 ? {
    headUuid: preservedMessages[0].id,
    anchorUuid: summaryId,
    tailUuid: preservedMessages[preservedMessages.length - 1].id,
  } : undefined;

  return {
    id: `boundary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: JSON.stringify({
          type: SYSTEM_COMPACT_BOUNDARY_MARKER,
          metadata: {
            compactType: "auto" as const,
            preCompactTokenCount,
            lastUserMessageUuid: lastUserMessageId,
            preservedSegment,
          },
        }),
      },
    ],
  };
}
