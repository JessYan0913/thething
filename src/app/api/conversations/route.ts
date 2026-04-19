import {
  generateConversationTitle,
  getMessagesByConversation,
  saveMessages,
  updateConversationTitle,
  listConversations,
  createConversation,
  deleteConversation,
} from "@thething/core";

// GET: List all conversations
export async function GET() {
  try {
    const conversations = listConversations();
    return Response.json({ conversations });
  } catch (error) {
    console.error('[Conversations API] GET error:', error);
    return Response.json(
      { error: 'Failed to load conversations' },
      { status: 500 }
    );
  }
}

// POST: Create a new conversation
export async function POST(req: Request) {
  try {
    const { id, title }: { id?: string; title?: string } = await req.json();

    if (!id) {
      return Response.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const conversation = createConversation(id, title);
    return Response.json({ conversation });
  } catch (error) {
    console.error('[Conversations API] POST error:', error);
    return Response.json(
      { error: 'Failed to create conversation' },
      { status: 500 }
    );
  }
}

// PATCH: Update conversation title
export async function PATCH(req: Request) {
  try {
    const { id, title }: { id: string; title: string } = await req.json();

    if (!id || !title) {
      return Response.json(
        { error: "Missing id or title" },
        { status: 400 }
      );
    }

    updateConversationTitle(id, title);
    return Response.json({ success: true });
  } catch (error) {
    console.error('[Conversations API] PATCH error:', error);
    return Response.json(
      { error: 'Failed to update conversation' },
      { status: 500 }
    );
  }
}

// DELETE: Delete a conversation
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Missing conversation id" }, { status: 400 });
    }

    deleteConversation(id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('[Conversations API] DELETE error:', error);
    return Response.json(
      { error: 'Failed to delete conversation' },
      { status: 500 }
    );
  }
}