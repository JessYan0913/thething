import type { UIMessage } from "ai";
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  type MicroCompactConfig,
} from "./types";
import { estimateMessageTokens } from "./token-counter";

const CLEARED_MARKER = "[Old tool result content cleared]";

function isToolPart(part: UIMessage["parts"][number]): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function getToolOutputSize(part: UIMessage["parts"][number]): number {
  if (part.type === "dynamic-tool") {
    const output = (part as { output?: unknown }).output;
    if (output) return JSON.stringify(output).length;
  }
  return 0;
}

export function microCompactMessages(
  messages: UIMessage[],
  _config: Partial<MicroCompactConfig> = {}
): { messages: UIMessage[]; executed: boolean; tokensFreed: number } {
  const resolvedConfig = { ...DEFAULT_MICRO_COMPACT_CONFIG, ..._config };
  let tokensFreed = 0;
  let executed = false;

  const compactedMessages = messages.map((message) => {
    const newParts: UIMessage["parts"] = [];
    let messageChanged = false;

    for (const part of message.parts) {
      if (!isToolPart(part)) {
        newParts.push(part);
        continue;
      }

      const outputSize = getToolOutputSize(part);
      const outputTokens = Math.ceil(outputSize / 3.5);

      if (outputTokens > resolvedConfig.imageMaxTokenSize) {
        const oldTokens = estimateMessageTokens({
          ...message,
          parts: [part],
        } as unknown as UIMessage);
        tokensFreed += oldTokens;
        executed = true;
        messageChanged = true;
        newParts.push(createClearedToolPart(part));
      } else {
        newParts.push(part);
      }
    }

    if (messageChanged) {
      executed = true;
      return { ...message, parts: newParts };
    }

    return message;
  });

  return {
    messages: compactedMessages,
    executed,
    tokensFreed,
  };
}

function createClearedToolPart(
  originalPart: UIMessage["parts"][number]
): UIMessage["parts"][number] {
  if (originalPart.type === "dynamic-tool") {
    return {
      ...originalPart,
      output: CLEARED_MARKER,
    } as UIMessage["parts"][number];
  }
  return originalPart;
}

export function isCompactableTool(
  toolName: string,
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG
): boolean {
  return config.compactableTools.has(toolName);
}
