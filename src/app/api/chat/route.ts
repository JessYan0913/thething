import { ToolLoopAgent, createAgentUIStreamResponse, UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { saveMessages, getMessagesByConversation } from '@/lib/chat-store';

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
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversationId');

  if (!conversationId) {
    return Response.json({ error: 'Missing conversationId' }, { status: 400 });
  }

  const messages = getMessagesByConversation(conversationId);
  return Response.json({ messages });
}

// POST: Process chat message and stream response
export async function POST(req: Request) {
  const { messages, conversationId }: { messages: UIMessage[]; conversationId: string } = await req.json();

  return createAgentUIStreamResponse({
    agent: chatAgent,
    uiMessages: messages,
    headers: {
      'X-Conversation-Id': conversationId,
    },
    // Save messages to SQLite after streaming completes
    onFinish: async ({ messages: completedMessages }) => {
      saveMessages(conversationId, completedMessages);
    },
  });
}
