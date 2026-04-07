import { generateText, type UIMessage, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
  type CompactBoundaryMessage,
  type CompactionResult,
  SYSTEM_COMPACT_BOUNDARY_MARKER,
} from "./types";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  hasTextBlocks,
  extractMessageText,
  stripImagesFromMessages,
} from "./token-counter";
import { microCompactMessages } from "./micro-compact";
async function saveSummarySafe(
  conversationId: string,
  summary: string,
  lastOrder: number,
  tokenCount: number
) {
  try {
    const { saveSummary } = await import("@/lib/chat-store");
    saveSummary(conversationId, summary, lastOrder, tokenCount);
  } catch {
    console.error("[Compaction] Failed to save summary (store not ready)");
  }
}

const dashscope = createOpenAICompatible({
  name: "dashscope",
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

const COMPACT_SUMMARY_PROMPT = `You are a session logger, not a content reproducer. Summarize this conversation in 5-8 short sentences.

CRITICAL — YOUR SUMMARY MUST:
1. Be under 200 words — SHORT and CONCISE
2. Describe what the user asked and how the conversation TOPIC EVOLVED
3. NEVER copy or include any code, tables, search results, or detailed explanations from the conversation
4. NEVER write as if you are answering the user's question
5. Write FROM A THIRD-PARTY perspective: "The user asked about X, then shifted to Y..."
6. Focus on describing the FLOW of the conversation, not reproducing its contents

WRONG (this is copying content, NOT summarizing):
- "Here is the Agent Todo implementation with 4 steps: Step 1 defines schema with fields id, parent_task_id..."
- Copying a web search result with URLs and highlights

RIGHT (this is a session log):
- "User asked how to implement todo in agents. Assistant researched and provided a 4-step approach covering schema design, memory storage, and workflow integration. User requested more detail on production-level implementation."

SUMMARY FORMAT:
1. **Initial request**: What user first wanted
2. **Topic changes**: How conversation evolved (use "then", "later", "subsequently")
3. **Actions taken**: What assistant did (searched, explained, provided patterns) — WITHOUT reproducing content
4. **Current state**: What user is working on right now
5. **Next steps**: What user expects

ONLY output the summary text. Nothing else.`;

function calculateMessagesToKeepIndex(
  messages: UIMessage[],
  config = DEFAULT_SESSION_MEMORY_CONFIG
): number {
  let totalTokens = 0;
  let textBlockMessageCount = 0;
  let startIndex = messages.length - 1;

  for (let i = messages.length - 2; i >= 1; i--) {
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

  return startIndex;
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

function preserveToolPairs(
  messages: UIMessage[],
  startIndex: number
): number {
  let adjustedStart = startIndex;

  // Step 1: Handle tool_use/tool_result pairs
  for (let i = messages.length - 1; i >= startIndex; i--) {
    for (const part of messages[i].parts) {
      if (part.type === "dynamic-tool") {
        const toolCallId = (part as { toolCallId?: string }).toolCallId;
        if (toolCallId) {
          const toolUseIndex = findToolUseIndex(messages.slice(0, startIndex), toolCallId);
          if (toolUseIndex >= 0 && toolUseIndex < adjustedStart) {
            adjustedStart = toolUseIndex;
          }
        }
      }
    }
  }

  // Step 2: Handle thinking blocks that share message.id with kept assistant messages
  const messageIdsInKeptRange = new Set<string>();
  for (let i = adjustedStart; i < messages.length; i++) {
    const msg = messages[i] as unknown as Record<string, unknown>;
    if (messages[i].role === "assistant" && typeof msg.id === "string") {
      messageIdsInKeptRange.add(msg.id);
    }
  }

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

const COMPACT_API_TIMEOUT = 15000; // 15 seconds timeout

async function generateTextWithTimeout(options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}): Promise<string> {
  return Promise.race([
    generateText(options).then((r) => r.text),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Compact API timeout")), COMPACT_API_TIMEOUT)
    ),
  ]);
}

function createContextHint(messages: UIMessage[], maxMessages: number = 2): string {
  const previewMessages = messages.slice(0, maxMessages);
  return previewMessages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      const text = extractMessageText(msg);
      const truncated = text.length > 80 ? text.substring(0, 80) + "..." : text;
      return `${role}: ${truncated}`;
    })
    .join("\n");
}

const MAX_SUMMARY_LENGTH = 1500;

function generateFallbackSummary(messages: UIMessage[]): string {
  const userMessages = messages.filter((m) => m.role === "user");

  const topicHints = userMessages
    .slice(-5)
    .map((m) => extractMessageText(m).substring(0, 60))
    .join("; ")
    .replace(/\n/g, " ");

  return `Conversation covered these topics: ${topicHints}`;
}

function validateSummaryQuality(summary: string, messagesToSummarize: UIMessage[]): boolean {
  if (!summary || summary.length < 10) return false;

  if (summary.length > MAX_SUMMARY_LENGTH) {
    console.warn(
      `[Compaction] Summary too long (${summary.length} chars > ${MAX_SUMMARY_LENGTH}), likely copying content instead of summarizing`
    );
    return false;
  }

  const userMessages = messagesToSummarize.filter((m) => m.role === "user");
  if (userMessages.length === 0) return true;

  const lastUserMessage = userMessages[userMessages.length - 1];
  const lastUserText = extractMessageText(lastUserMessage);

  if (lastUserText.length < 5) return true;

  const summaryLower = summary.toLowerCase();
  const keyPhrases = lastUserText
    .substring(0, 30)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const matchCount = keyPhrases.filter((phrase) => summaryLower.includes(phrase)).length;

  return matchCount >= 1 || summaryLower.includes("topic") || summaryLower.includes("then") || summaryLower.includes("later");
}

export async function compactViaAPI(
  messages: UIMessage[],
  conversationId: string
): Promise<CompactionResult> {
  const preCompactTokenCount = estimateMessagesTokens(messages);

  const microResult = microCompactMessages(messages);
  const messagesForCompact = microResult.messages;

  const keepFromIndex = calculateMessagesToKeepIndex(messagesForCompact);
  const startIndex = preserveToolPairs(messagesForCompact, keepFromIndex);

  const messagesToSummarize = messagesForCompact.slice(0, startIndex);
  const messagesToKeep = messagesForCompact.slice(startIndex);

  if (messagesToSummarize.length < 3) {
    return {
      messages,
      executed: false,
      type: null,
      tokensFreed: 0,
    };
  }

  const strippedMessages = stripImagesFromMessages(messagesToSummarize);

  const conversationText = strippedMessages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      const text = extractMessageText(msg);
      return `${role}: ${text}`;
    })
    .join("\n\n");

  const contextHint = messagesToKeep.length > 0
    ? createContextHint(messagesToKeep)
    : "";

  const promptWithContext = contextHint
    ? `${conversationText}\n\n[NOTE: The conversation continues with the following messages]\n[Do not summarize these - they are preserved in full]\n[Use them only to understand what topic the discussion shifted to]\n${contextHint}`
    : conversationText;

  let summary = "";
  try {
    summary = await generateTextWithTimeout({
      model: dashscope(process.env.DASHSCOPE_MODEL!),
      system: COMPACT_SUMMARY_PROMPT,
      prompt: promptWithContext,
      maxOutputTokens: 400,
      temperature: 0.1,
    });

    if (!validateSummaryQuality(summary, messagesToSummarize)) {
      summary = generateFallbackSummary(messagesToSummarize);
      console.warn(
        "[Compaction] Summary quality validation failed, replaced with generated fallback"
      );
    }
  } catch (error) {
    console.error("[Compaction] API summary generation failed:", error);
    summary = generateFallbackSummary(messagesToSummarize);
  }

  const summaryMessage: UIMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: `[Previous conversation summary]\n${summary}\n\n[End of summary]`,
      },
    ],
  };

  const lastUserMessage = messagesToKeep.findLast((m) => m.role === "user");
  const lastUserMessageId = lastUserMessage?.id || "";

  const preservedSegment = messagesToKeep.length > 0 ? {
    headUuid: messagesToKeep[0].id,
    anchorUuid: summaryMessage.id,
    tailUuid: messagesToKeep[messagesToKeep.length - 1].id,
  } : undefined;

  const boundaryMessage: CompactBoundaryMessage = {
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

  const resultMessages = [summaryMessage, boundaryMessage, ...messagesToKeep];
  const postCompactTokens = estimateMessagesTokens(resultMessages);
  const tokensFreed = preCompactTokenCount - postCompactTokens;

  const lastSummarizedOrder = (messagesToSummarize[messagesToSummarize.length - 1] as unknown as { order?: number })?.order ?? 0;

  try {
    await saveSummarySafe(conversationId, summary, lastSummarizedOrder, preCompactTokenCount);
  } catch (error) {
    console.error("[Compaction] Failed to save summary:", error);
  }

  return {
    messages: resultMessages,
    executed: true,
    type: "auto",
    tokensFreed,
    boundaryMessage,
    summary,
  };
}

export async function compactWithCustomInstructions(
  messages: UIMessage[],
  conversationId: string,
  customInstructions: string
): Promise<CompactionResult> {
  const preCompactTokenCount = estimateMessagesTokens(messages);

  const microResult = microCompactMessages(messages);
  const messagesForCompact = microResult.messages;

  const keepFromIndex = calculateMessagesToKeepIndex(messagesForCompact);
  const startIndex = preserveToolPairs(messagesForCompact, keepFromIndex);

  const messagesToSummarize = messagesForCompact.slice(0, startIndex);
  const messagesToKeep = messagesForCompact.slice(startIndex);

  if (messagesToSummarize.length < 3) {
    return {
      messages,
      executed: false,
      type: null,
      tokensFreed: 0,
    };
  }

  const strippedMessages = stripImagesFromMessages(messagesToSummarize);

  const conversationText = strippedMessages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      const text = extractMessageText(msg);
      return `${role}: ${text}`;
    })
    .join("\n\n");

  const contextHint = messagesToKeep.length > 0
    ? createContextHint(messagesToKeep)
    : "";

  const promptWithContext = contextHint
    ? `${conversationText}\n\n[NOTE: The conversation continues with the following messages]\n[Do not summarize these - they are preserved in full]\n[Use them only to understand what topic the discussion shifted to]\n${contextHint}`
    : conversationText;

  let summary = "";
  try {
    summary = await generateTextWithTimeout({
      model: dashscope(process.env.DASHSCOPE_MODEL!),
      system: `${COMPACT_SUMMARY_PROMPT}\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`,
      prompt: promptWithContext,
      maxOutputTokens: 400,
      temperature: 0.1,
    });

    if (!validateSummaryQuality(summary, messagesToSummarize)) {
      summary = generateFallbackSummary(messagesToSummarize);
      console.warn(
        "[Compaction] Summary quality validation failed, replaced with generated fallback"
      );
    }
  } catch (error) {
    console.error("[Compaction] Custom compact failed:", error);
    summary = generateFallbackSummary(messagesToSummarize);
  }

  const summaryMessage: UIMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: `[Previous conversation summary]\n${summary}\n\n[End of summary]`,
      },
    ],
  };

  const lastUserMessage = messagesToKeep.findLast((m) => m.role === "user");
  const lastUserMessageId = lastUserMessage?.id || "";

  const preservedSegment = messagesToKeep.length > 0 ? {
    headUuid: messagesToKeep[0].id,
    anchorUuid: summaryMessage.id,
    tailUuid: messagesToKeep[messagesToKeep.length - 1].id,
  } : undefined;

  const boundaryMessage: CompactBoundaryMessage = {
    id: `boundary-${Date.now()}`,
    role: "system",
    parts: [
      {
        type: "text",
        text: JSON.stringify({
          type: SYSTEM_COMPACT_BOUNDARY_MARKER,
          metadata: {
            compactType: "manual" as const,
            preCompactTokenCount,
            lastUserMessageUuid: lastUserMessageId,
            preservedSegment,
          },
        }),
      },
    ],
  };

  const resultMessages = [summaryMessage, boundaryMessage, ...messagesToKeep];
  const postCompactTokens = estimateMessagesTokens(resultMessages);
  const tokensFreed = preCompactTokenCount - postCompactTokens;

  const lastSummarizedOrder = (messagesToSummarize[messagesToSummarize.length - 1] as unknown as { order?: number })?.order ?? 0;

  try {
    await saveSummarySafe(conversationId, summary, lastSummarizedOrder, preCompactTokenCount);
  } catch (error) {
    console.error("[Compaction] Failed to save summary:", error);
  }

  return {
    messages: resultMessages,
    executed: true,
    type: "manual",
    tokensFreed,
    boundaryMessage,
    summary,
  };
}
