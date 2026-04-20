// ============================================================
// Conversation Title Generator
// ============================================================

import { generateText } from "ai";
import type { UIMessage } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getDefaultModelProvider } from "../model-provider";

/**
 * Generate a concise title for a conversation using the LLM.
 * Accepts an optional model override; otherwise uses the default provider.
 * Runs asynchronously so it never blocks the main response stream.
 */
export async function generateConversationTitle(
  messages: UIMessage[],
  model?: LanguageModelV3,
  delayMs?: number,
): Promise<string> {
  const firstUserMessage = messages.find((m) => m.role === "user");
  const firstAssistantMessage = messages.find((m) => m.role === "assistant");

  // Fallback: extract first meaningful text from user message
  const fallbackTitle = (firstUserMessage
    ? firstUserMessage.parts
        .filter((p) => p.type === "text")
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim()
        .slice(0, 50)
    : "New Conversation") || "New Conversation";

  try {
    // 延迟 1 秒再调用 API，避免与主聊天请求同时触发 DashScope 限速
    // 标题生成优先于记忆提取（3秒），错开 API 调用时间
    const delay = delayMs ?? 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    const userText = firstUserMessage?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

    const assistantText = firstAssistantMessage?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();

    if (!userText) return fallbackTitle;

    const titleModel = model || getDefaultModelProvider()(process.env.DASHSCOPE_MODEL || "qwen-max");

    const { text } = await generateText({
      model: titleModel,
      system:
        "你是一个对话标题生成助手。请根据用户的首条消息和AI的回复，生成一个简洁、准确的对话标题。",
      prompt: `用户消息: ${userText.slice(0, 300)}\n${
        assistantText ? `AI回复: ${assistantText.slice(0, 300)}` : ""
      }\n\n要求:\n- 不超过15个字符\n- 准确反映对话核心主题\n- 不要使用引号、书名号等特殊符号\n- 只输出标题文本本身，不要任何其他内容`,
      maxOutputTokens: 50,
      temperature: 0.3,
    });

    const title = text.trim();
    if (!title) return fallbackTitle;

    // Clean up: remove common quote/bracket chars, limit length
    const cleaned = title.replace(/^["'《（(【\s]+|[”）)】\s]+$/g, "").trim();
    return cleaned.slice(0, 15) || fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}