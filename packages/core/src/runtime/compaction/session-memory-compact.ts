import type { UIMessage } from "ai";
import type { DataStore } from "../../foundation/datastore/types";
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
} from "../../config/defaults";
import {
  type SessionMemoryCompactConfig,
  type CompactBoundaryMessage,
  SYSTEM_COMPACT_BOUNDARY_MARKER,
  type StoredSummary,
} from "./types";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  hasTextBlocks,
} from "./token-counter";

export function shouldUseSessionMemoryCompaction(): boolean {
  return true;
}

function getSummaryByConversation(conversationId: string, dataStore: DataStore): StoredSummary | null {
  try {
    return dataStore.summaryStore.getSummaryByConversation(conversationId);
  } catch {
    return null;
  }
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

async function calculateMessagesToKeepIndex(
  messages: UIMessage[],
  lastSummarizedIndex: number,
  config: SessionMemoryCompactConfig = DEFAULT_SESSION_MEMORY_CONFIG
): Promise<number> {
  let startIndex = lastSummarizedIndex + 1;
  let totalTokens = 0;
  let textBlockMessageCount = 0;

  const floor = 1;

  for (let i = startIndex - 1; i >= floor; i--) {
    const msg = messages[i];
    totalTokens += await estimateMessageTokens(msg);
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
  config: Partial<SessionMemoryCompactConfig> = {},
  dataStore: DataStore,
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

  const summary = getSummaryByConversation(conversationId, dataStore);
  if (!summary) return null;

  // lastMessageOrder is stored as the 0-based array index of the last summarized message
  // (set by api-compact.ts as startIndex - 1). Since saveMessages re-numbers messages
  // from 0 on every save, the order equals the array index directly.
  const lastSummarizedIndex = summary.lastMessageOrder;

  if (lastSummarizedIndex < 0 || lastSummarizedIndex >= messages.length - 1) return null;

  const keepFromIndex = await calculateMessagesToKeepIndex(
    messages,
    lastSummarizedIndex,
    resolvedConfig
  );

  if (keepFromIndex >= messages.length - 2) return null;

  const preCompactTokens = await estimateMessagesTokens(messages);

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

  const postCompactTokens = await estimateMessagesTokens(preservedMessages);
  const tokensFreed = preCompactTokens - postCompactTokens;

  const minEffectiveTokensFreed = Math.floor(preCompactTokens * 0.1);
  if (tokensFreed < minEffectiveTokensFreed) {
    return null;
  }

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