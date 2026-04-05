import { ToolLoopAgent, createAgentUIStreamResponse, UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { saveMessages, getMessagesByConversation, generateConversationTitle, updateConversationTitle } from '@/lib/chat-store';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

const chatAgent = new ToolLoopAgent({
  model: dashscope(process.env.DASHSCOPE_MODEL!),
  instructions: 'You are a helpful assistant.',
});

export const maxDuration = 30;

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

    return createAgentUIStreamResponse({
      agent: chatAgent,
      uiMessages: messages,
      headers: {
        'X-Conversation-Id': conversationId,
      },
      // Save messages to SQLite after streaming completes
      onFinish: async ({ messages: completedMessages }) => {
        try {
          await saveMessages(conversationId, completedMessages);

          // Generate AI title for new conversations (async, non-blocking)
          if (isFirstMessage) {
            generateConversationTitle(completedMessages)
              .then((title) => {
                updateConversationTitle(conversationId, title);
                console.log(`[Title Generated] ${conversationId}: ${title}`);
              })
              .catch((err) => {
                console.error(`[Title Generation Failed] ${conversationId}:`, err);
              });
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
