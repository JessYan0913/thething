import { generateText, type UIMessage } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { DEFAULT_SESSION_MEMORY_CONFIG } from "../../config/defaults";
import {
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
import { getGlobalDataStore } from "../../foundation/datastore";

// 检查 model 参数是否提供
function requireModel(model?: LanguageModelV3): LanguageModelV3 {
  if (!model) {
    throw new Error("[Compaction] Model parameter is required. Application layer must provide a LanguageModelV3 instance.");
  }
  return model;
}

async function saveSummarySafe(
  conversationId: string,
  summary: string,
  lastOrder: number,
  tokenCount: number
) {
  try {
    getGlobalDataStore().summaryStore.saveSummary(conversationId, summary, lastOrder, tokenCount);
  } catch {
    console.error("[Compaction] Failed to save summary (store not ready)");
  }
}

const COMPACT_SUMMARY_PROMPT = `你是一个对话摘要助手。请用简洁的语言总结对话，捕捉关键信息和价值。

核心要求：
1. 长度：200-500字
2. 视角：第三人称客观记录（"用户询问了X，助手回答了Y，随后讨论深入到Z"）
3. 内容平衡：既要记录用户的问题，也要记录助手的关键回复和结论

必须包含的要素：
- 用户的核心问题是什么
- 助手提供了什么关键信息或建议
- 对话如何演进（从A话题转到B话题）
- 最终讨论的焦点是什么

增量摘要处理：
- 如果输入包含【历史摘要】和【新增对话】，请整合两者
- 保留历史摘要的核心信息，补充新对话的关键内容
- 用"随后"、"接着"、"进一步"等词衔接历史和新内容
- 确保整体摘要连贯、完整，体现对话的完整演进过程

避免的错误：
❌ 只列出用户的提问，不记录助手的回复
❌ 复制粘贴大段原文、代码、搜索结果
❌ 用"这是一个很好的问题"等空话
❌ 增量摘要时丢弃历史内容，只总结新对话

正确示例（首次摘要）：
"用户询问如何实现 Agent 的 todo 功能。助手通过检索提供了包含 schema 设计、内存存储、工作流集成的四步方案。用户随后要求更详细的生产级实现细节，助手补充了错误处理和并发控制的建议。"

正确示例（增量摘要）：
"用户询问富豪榜信息，助手提供了2026年中国和全球排名数据。随后对话深入到富豪发迹史，助手总结了第一性原理、长期主义等5条启发。接着用户表达30+年龄的自我怀疑，助手分析了'无法忍受现状'的驱动力价值，并提供财务诊断建议。最终用户提出能源行业Agent开发的职业瓶颈问题。"

请直接输出摘要，不要任何前缀或解释。`;

async function calculateMessagesToKeepIndex(
  messages: UIMessage[],
  config = DEFAULT_SESSION_MEMORY_CONFIG
): Promise<number> {
  let totalTokens = 0;
  let textBlockMessageCount = 0;
  let startIndex = messages.length - 1;

  for (let i = messages.length - 2; i >= 1; i--) {
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

const MAX_SUMMARY_LENGTH = 3000;

function generateFallbackSummary(messages: UIMessage[]): string {
  const userMessages = messages.filter((m) => m.role === "user");

  // 提取最近的用户问题和助手回复
  const recentPairs: string[] = [];
  for (let i = Math.max(0, messages.length - 10); i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const userText = extractMessageText(msg).substring(0, 150);
      // 查找下一条助手回复
      const nextAssistant = messages.slice(i + 1).find(m => m.role === "assistant");
      if (nextAssistant) {
        const assistantText = extractMessageText(nextAssistant).substring(0, 200);
        recentPairs.push(`用户询问${userText}，助手回复${assistantText}`);
      } else {
        recentPairs.push(`用户询问${userText}`);
      }
    }
  }

  if (recentPairs.length > 0) {
    return recentPairs.slice(-3).join("。") + "。";
  }

  // 完全降级：只列出话题
  const topicHints = userMessages
    .slice(-5)
    .map((m) => extractMessageText(m).substring(0, 60))
    .join("; ")
    .replace(/\n/g, " ");

  return `对话涵盖以下话题：${topicHints}`;
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

async function getExistingSummarySafe(conversationId: string): Promise<string | null> {
  try {
    const summary = getGlobalDataStore().summaryStore.getSummaryByConversation(conversationId);
    return summary?.summary || null;
  } catch {
    return null;
  }
}

export async function compactViaAPI(
  messages: UIMessage[],
  conversationId: string,
  model?: LanguageModelV3
): Promise<CompactionResult> {
  const preCompactTokenCount = await estimateMessagesTokens(messages);

  const microResult = await microCompactMessages(messages);
  const messagesForCompact = microResult.messages;

  const keepFromIndex = await calculateMessagesToKeepIndex(messagesForCompact);
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

  // 获取已有摘要，实现增量更新
  const existingSummary = await getExistingSummarySafe(conversationId);

  let promptWithContext: string;
  if (existingSummary) {
    // 增量摘要：包含历史摘要 + 新对话
    promptWithContext = `【历史摘要】\n${existingSummary}\n\n【新增对话】\n${conversationText}`;
    if (contextHint) {
      promptWithContext += `\n\n[NOTE: The conversation continues with the following messages]\n[Do not summarize these - they are preserved in full]\n[Use them only to understand what topic the discussion shifted to]\n${contextHint}`;
    }
    console.log(`[Compaction] Incremental summary: appending to existing summary (${existingSummary.length} chars)`);
  } else {
    // 首次摘要：只有新对话
    promptWithContext = contextHint
      ? `${conversationText}\n\n[NOTE: The conversation continues with the following messages]\n[Do not summarize these - they are preserved in full]\n[Use them only to understand what topic the discussion shifted to]\n${contextHint}`
      : conversationText;
    console.log(`[Compaction] First-time summary: no existing summary found`);
  }

  let summary = "";
  try {
    const result = await generateText({
      model: requireModel(model),
      system: COMPACT_SUMMARY_PROMPT,
      prompt: promptWithContext,
      maxOutputTokens: 800,
      temperature: 0.1,
    });
    summary = result.text;

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
  const postCompactTokens = await estimateMessagesTokens(resultMessages);
  const tokensFreed = preCompactTokenCount - postCompactTokens;

  // startIndex is the first message to keep; messages before it were summarized.
  // Since saveMessages stores order as the 0-based array index, startIndex-1
  // is the correct lastMessageOrder for the boundary lookup in trySessionMemoryCompact.
  const lastSummarizedOrder = startIndex - 1;

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
  customInstructions: string,
  model?: LanguageModelV3
): Promise<CompactionResult> {
  const preCompactTokenCount = await estimateMessagesTokens(messages);

  const microResult = await microCompactMessages(messages);
  const messagesForCompact = microResult.messages;

  const keepFromIndex = await calculateMessagesToKeepIndex(messagesForCompact);
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
    const result = await generateText({
      model: requireModel(model),
      system: `${COMPACT_SUMMARY_PROMPT}\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`,
      prompt: promptWithContext,
      maxOutputTokens: 800,
      temperature: 0.1,
    });
    summary = result.text;

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
  const postCompactTokens = await estimateMessagesTokens(resultMessages);
  const tokensFreed = preCompactTokenCount - postCompactTokens;

  const lastSummarizedOrder = startIndex - 1;

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
