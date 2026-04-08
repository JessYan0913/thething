import { ToolLoopAgent, createAgentUIStreamResponse, UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  saveMessages,
  getMessagesByConversation,
  generateConversationTitle,
  updateConversationTitle,
} from "@/lib/chat-store";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { exaSearchTool } from "@/lib/tools/exa-search";
import {
  compactMessagesIfNeeded,
  estimateMessagesTokens,
} from "@/lib/compaction";
import { runCompactInBackground } from "@/lib/compaction/background-queue";

const dashscope = createOpenAICompatible({
  name: "dashscope",
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

export const maxDuration = 30;

// ============================================================================
// Agent Factory
// ============================================================================

/**
 * Creates a ToolLoopAgent with the current system prompt.
 * Uses the modular system prompt builder for dynamic assembly.
 */
async function createChatAgent(conversationMeta?: {
  messageCount: number;
  isNewConversation: boolean;
  conversationStartTime: number;
}) {
  // Build the complete system prompt using our modular system
  const { prompt, includedSections, estimatedTokens } = await buildSystemPrompt(
    {
      includeProjectContext: true, // Enable CLAUDE.md loading
      conversationMeta: conversationMeta ?? undefined,
    },
  );

  // Log for debugging - show full system prompt
  console.log("\n" + "=".repeat(80));
  console.log("[DEBUG] ========== FULL SYSTEM PROMPT ==========");
  console.log("=".repeat(80));
  console.log(prompt);
  console.log("=".repeat(80));
  console.log(`[DEBUG] Sections: ${includedSections.join(", ")}`);
  console.log(`[DEBUG] Estimated tokens: ~${estimatedTokens}`);
  console.log("=".repeat(80) + "\n");

  return new ToolLoopAgent({
    model: dashscope(process.env.DASHSCOPE_MODEL!),
    instructions: prompt,
    tools: {
      web_search: exaSearchTool,
    },
  });
}

// ============================================================================
// API Routes
// ============================================================================

// GET: Load messages for a conversation
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    if (!conversationId) {
      return Response.json(
        { error: "Missing conversationId" },
        { status: 400 },
      );
    }

    const messages = getMessagesByConversation(conversationId);
    return Response.json({ messages });
  } catch (error) {
    console.error("[Chat API] GET error:", error);
    return Response.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

// POST: Process chat message and stream response
export async function POST(req: Request) {
  try {
    const {
      message,
      conversationId,
    }: { message: UIMessage; conversationId: string } = await req.json();

    if (!conversationId) {
      return Response.json(
        { error: "Missing conversationId" },
        { status: 400 },
      );
    }

    // Load existing messages from DB and append the latest user message
    const existingMessages = getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;
    const messages: UIMessage[] = [...existingMessages, message];

    // Compact messages for LLM input (runtime only, does not affect database)
    const { messages: compactedMessages, executed: compactionExecuted } =
      await compactMessagesIfNeeded(messages, conversationId);

    const preCompactionTokens = estimateMessagesTokens(messages);
    const postCompactionTokens = estimateMessagesTokens(compactedMessages);
    console.log(
      `[Tokens] Pre: ${preCompactionTokens}, Post: ${postCompactionTokens}`,
    );
    console.log(
      `[LLM Input] ${compactedMessages.length} messages:\n` +
        compactedMessages
          .map((m, i) => {
            const part = m.parts[0];
            const text = part?.type === "text" ? part.text : `[${part?.type}]`;
            return `  [${i}] ${m.role}: ${text.replace(/\n/g, " ").slice(0, 60)}${text.length > 60 ? "…" : ""}`;
          })
          .join("\n"),
    );

    // Create agent with fresh system prompt (async)
    const chatAgent = await createChatAgent({
      messageCount: compactedMessages.length,
      isNewConversation: isFirstMessage,
      conversationStartTime: Date.now(),
    });

    return createAgentUIStreamResponse({
      agent: chatAgent,
      uiMessages: compactedMessages, // Use compacted messages for LLM
      headers: {
        "X-Conversation-Id": conversationId,
      },
      sendReasoning: true,
      // Save ORIGINAL messages to SQLite after streaming completes
      // CRITICAL: We save the original messages, not the compacted ones
      // Compaction is only for LLM context, not for database storage
      onFinish: async ({ messages: completedMessages }) => {
        try {
          // Merge original messages with new assistant response
          // completedMessages contains: compactedMessages + new assistant response
          // We need to reconstruct: original messages + new assistant response

          // Extract only the new assistant messages (after the compacted messages)
          const newAssistantMessages = completedMessages.slice(
            compactedMessages.length,
          );

          // Combine original messages with new assistant response
          const messagesToSave = [...messages, ...newAssistantMessages];

          console.log(
            `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
          );
          console.log(
            `[Storage] Compaction was ${compactionExecuted ? "executed" : "not executed"}, but database receives ORIGINAL messages`,
          );

          await saveMessages(conversationId, messagesToSave);

          // Generate AI title for new conversations
          if (isFirstMessage) {
            const title = await generateConversationTitle(completedMessages);
            updateConversationTitle(conversationId, title);
            console.log(`[Title Generated] ${conversationId}: ${title}`);
          }

          // Async update summary for next request (non-blocking).
          // Run AFTER saving so the summary covers the full turn including new assistant reply.
          runCompactInBackground(messagesToSave, conversationId);
        } catch (error) {
          console.error("[Chat API] onFinish error:", error);
        }
      },
    });
  } catch (error) {
    console.error("[Chat API] POST error:", error);
    return Response.json(
      { error: "Failed to process chat request" },
      { status: 500 },
    );
  }
}
