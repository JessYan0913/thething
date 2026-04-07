import type { UIMessage } from "ai";
import {
  type CompactBoundaryMessage,
  type CompactMetadata,
  type CompactionType,
  SYSTEM_COMPACT_BOUNDARY_MARKER,
} from "./types";

export function createCompactBoundaryMessage(
  compactType: CompactionType,
  preCompactTokenCount: number,
  lastUserMessageId: string,
  preservedMessageIds: string[] = [],
  summaryMessageId: string = ""
): CompactBoundaryMessage {
  const metadata: CompactMetadata = {
    compactType,
    preCompactTokenCount,
    lastUserMessageUuid: lastUserMessageId,
  };

  if (preservedMessageIds.length > 0 || summaryMessageId) {
    metadata.preservedSegment = {
      summaryMessageUuid: summaryMessageId,
      preservedMessageUuids: preservedMessageIds,
    };
  }

  return {
    id: `boundary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: JSON.stringify({
          type: SYSTEM_COMPACT_BOUNDARY_MARKER,
          metadata,
        }),
      },
    ],
  };
}

export function isCompactBoundaryMessage(message: UIMessage): boolean {
  if (message.role !== "system") return false;

  for (const part of message.parts) {
    if (part.type === "text") {
      try {
        const parsed = JSON.parse(part.text);
        if (parsed?.type === SYSTEM_COMPACT_BOUNDARY_MARKER) {
          return true;
        }
      } catch {
        // Not JSON, not a boundary message
      }
    }
  }

  return false;
}

export function parseCompactBoundaryMetadata(
  message: UIMessage
): CompactMetadata | null {
  if (!isCompactBoundaryMessage(message)) return null;

  for (const part of message.parts) {
    if (part.type === "text") {
      try {
        const parsed = JSON.parse(part.text);
        return parsed?.metadata as CompactMetadata;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function getMessagesAfterCompactBoundary(
  messages: UIMessage[]
): UIMessage[] {
  let lastIndex = -1;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundaryMessage(messages[i])) {
      lastIndex = i;
      break;
    }
  }

  if (lastIndex >= 0) {
    return messages.slice(lastIndex + 1);
  }

  return messages;
}

export function getLastBoundaryMessage(messages: UIMessage[]): CompactBoundaryMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundaryMessage(messages[i])) {
      return messages[i] as CompactBoundaryMessage;
    }
  }
  return null;
}

export function hasCompactBoundary(messages: UIMessage[]): boolean {
  return messages.some((msg) => isCompactBoundaryMessage(msg));
}

export function stripCompactBoundaries(messages: UIMessage[]): UIMessage[] {
  return messages.filter((msg) => !isCompactBoundaryMessage(msg));
}
