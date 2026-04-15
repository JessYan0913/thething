import type { UIMessage } from "ai";

const CHARS_PER_TOKEN_AVG = 3.5;
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_AVG);
}

export function estimateMessageTokens(message: UIMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') {
      tokens += estimateTextTokens(content);
    }
    return tokens;
  }

  for (const part of message.parts) {
    if (part.type === "text") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type === "reasoning") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
      const toolPart = part as Record<string, unknown>;
      const output = toolPart.output as Record<string, unknown> | undefined;
      if (output) {
        const outputJson = JSON.stringify(output);
        tokens += estimateTextTokens(outputJson);
      }
      const input = toolPart.input as Record<string, unknown> | undefined;
      if (input) {
        const inputJson = JSON.stringify(input);
        tokens += estimateTextTokens(inputJson);
      }
    }
  }

  return tokens;
}

export function estimateMessagesTokens(messages: UIMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function extractMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    return typeof content === 'string' ? content : '';
  }
  return message.parts
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => (p.type === "text" || p.type === "reasoning" ? p.text : ""))
    .join("\n");
}

export function hasTextBlocks(message: UIMessage): boolean {
  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    return typeof content === 'string' && content.trim().length > 0;
  }
  return message.parts.some((p) => p.type === "text" && p.text.trim().length > 0);
}

export function stripImagesFromMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: (msg.parts || []).map((part) => {
      if ((part as Record<string, unknown>).type === "file" || (part as Record<string, unknown>).type === "image") {
        return { type: "text" as const, text: "[image]" };
      }
      return part;
    }),
  }));
}
