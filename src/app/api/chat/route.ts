import { ToolLoopAgent, createAgentUIStreamResponse, UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { saveMessages, getMessagesByConversation, generateConversationTitle, updateConversationTitle } from '@/lib/chat-store';
import { buildSystemPrompt, AGENT_NAME } from '@/lib/system-prompt';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
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
}): Promise<ToolLoopAgent> {
  // Build the complete system prompt using our modular system
  const { prompt, includedSections, estimatedTokens } = await buildSystemPrompt({
    includeProjectContext: true,    // Enable CLAUDE.md loading
    includeTools: false,            // Disable tools for now (no tools implemented yet)
    conversationMeta: conversationMeta ?? undefined,
  });

  // Log for debugging - show full system prompt
  console.log('\n' + '='.repeat(80));
  console.log('[DEBUG] ========== FULL SYSTEM PROMPT ==========');
  console.log('='.repeat(80));
  console.log(prompt);
  console.log('='.repeat(80));
  console.log(`[DEBUG] Sections: ${includedSections.join(', ')}`);
  console.log(`[DEBUG] Estimated tokens: ~${estimatedTokens}`);
  console.log('='.repeat(80) + '\n');

  return new ToolLoopAgent({
    model: dashscope(process.env.DASHSCOPE_MODEL!),
    instructions: prompt,
  });
}

// ============================================================================
// API Routes
// ============================================================================

// GET: Load messages for a conversation
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const messages = getMessagesByConversation(conversationId);
    return Response.json({ messages });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return Response.json(
      { error: 'Failed to load messages' },
      { status: 500 }
    );
  }
}

// POST: Process chat message and stream response
export async function POST(req: Request) {
  try {
    const { messages, conversationId }: { messages: UIMessage[]; conversationId: string } = await req.json();

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    // Check if this is a new conversation (no messages before this request)
    const existingMessages = getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;

    // Get current message count for conversation meta
    const messageCount = existingMessages.length + messages.filter(m => m.role === 'user').length;

    // Create agent with fresh system prompt (async)
    const chatAgent = await createChatAgent({
      messageCount,
      isNewConversation: isFirstMessage,
      conversationStartTime: Date.now(),
    });

    return createAgentUIStreamResponse({
      agent: chatAgent,
      uiMessages: messages,
      headers: {
        'X-Conversation-Id': conversationId,
      },
      sendReasoning: true,
      // Save messages to SQLite after streaming completes
      onFinish: async ({ messages: completedMessages }) => {
        try {
          await saveMessages(conversationId, completedMessages);

          // Generate AI title for new conversations
          if (isFirstMessage) {
            const title = await generateConversationTitle(completedMessages);
            updateConversationTitle(conversationId, title);
            console.log(`[Title Generated] ${conversationId}: ${title}`);
          }
        } catch (error) {
          console.error('[Chat API] onFinish error:', error);
        }
      },
    });
  } catch (error) {
    console.error('[Chat API] POST error:', error);
    return Response.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
