import type { UIMessage } from "ai";
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  type MicroCompactConfig,
} from "./types";
import { estimateMessageTokens } from "./token-counter";

const CLEARED_MARKER = "[Old tool result content cleared]";

export function evaluateTimeBasedTrigger(
  messages: UIMessage[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG
): { gapMinutes: number } | null {
  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  if (!lastAssistant) {
    return null;
  }

  const msgWithTimestamp = lastAssistant as unknown as Record<string, unknown>;
  const timestamp = msgWithTimestamp.timestamp as string | number | undefined;
  if (!timestamp) {
    return null;
  }

  const lastTime = new Date(timestamp).getTime();
  const gapMinutes = (Date.now() - lastTime) / 60_000;

  if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
    return null;
  }

  return { gapMinutes };
}

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

export async function microCompactMessages(
  messages: UIMessage[],
  _config: Partial<MicroCompactConfig> = {}
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number }> {
  const resolvedConfig = { ...DEFAULT_MICRO_COMPACT_CONFIG, ..._config };

  // Try time-based microcompact first
  const timeBasedResult = await maybeTimeBasedMicrocompact(messages, resolvedConfig);
  if (timeBasedResult) {
    return timeBasedResult;
  }

  // Fall through to legacy logic
  let tokensFreed = 0;
  let executed = false;

  const compactedMessages = messages.map(async (message) => {
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
        const oldTokens = await estimateMessageTokens({
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

  const resolvedMessages = await Promise.all(compactedMessages);

  return {
    messages: resolvedMessages,
    executed,
    tokensFreed,
  };
}

async function maybeTimeBasedMicrocompact(
  messages: UIMessage[],
  config: MicroCompactConfig
): Promise<{ messages: UIMessage[]; executed: boolean; tokensFreed: number } | null> {
  const trigger = evaluateTimeBasedTrigger(messages, config);
  if (!trigger) {
    return null;
  }

  const { gapMinutes } = trigger;
  const compactableIds = collectCompactableToolIds(messages, config.compactableTools);

  const keepRecent = Math.max(1, config.keepRecent);
  const keepSet = new Set(compactableIds.slice(-keepRecent));
  const clearSet = new Set(compactableIds.filter((id) => !keepSet.has(id)));

  if (clearSet.size === 0) {
    return null;
  }

  let tokensSaved = 0;
  const result: UIMessage[] = await Promise.all(messages.map(async (message) => {
    if (message.role !== "user" || !Array.isArray(message.parts)) {
      return message;
    }

    let touched = false;
    const newParts = message.parts.map(async (part) => {
      const p = part as unknown as Record<string, unknown>;
      if (
        p.type === "tool_result" &&
        clearSet.has((p.tool_use_id as string) || "") &&
        getToolOutputText(part) !== CLEARED_MARKER
      ) {
        tokensSaved += await estimateMessageTokens({ ...message, parts: [part] } as unknown as UIMessage);
        touched = true;
        return { ...part, content: CLEARED_MARKER } as unknown as UIMessage["parts"][number];
      }
      return part;
    });

    const resolvedParts = await Promise.all(newParts);
    if (!touched) return message;
    return { ...message, parts: resolvedParts };
  }));

  if (tokensSaved === 0) {
    return null;
  }

  console.log(
    `[Time-Based MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, ` +
    `cleared ${clearSet.size} tool results (~${tokensSaved} tokens), kept last ${keepSet.size}`
  );

  return { messages: result, executed: true, tokensFreed: tokensSaved };
}

function collectCompactableToolIds(messages: UIMessage[], compactableTools: Set<string> = DEFAULT_MICRO_COMPACT_CONFIG.compactableTools): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        const p = part as unknown as Record<string, unknown>;
        if (
          p.type === "tool_use" &&
          compactableTools.has(
            (p.name as string) || ""
          )
        ) {
          ids.push((p.id as string) || "");
        }
      }
    }
  }
  return ids;
}

function getToolOutputText(part: UIMessage["parts"][number]): string {
  const p = part as unknown as Record<string, unknown>;
  if (p.type === "tool_result") {
    const content = p.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
  }
  return "";
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
