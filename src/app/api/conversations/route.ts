import {
  listConversations,
  createConversation,
  deleteConversation,
  updateConversationTitle,
} from "@/lib/chat-store";

// GET: List all conversations
export async function GET() {
  const conversations = listConversations();
  return Response.json({ conversations });
}

// POST: Create a new conversation
export async function POST(req: Request) {
  const { id, title }: { id?: string; title?: string } = await req.json();

  if (!id) {
    return Response.json({ error: "Missing conversation id" }, { status: 400 });
  }

  const conversation = createConversation(id, title);
  return Response.json({ conversation });
}

// PATCH: Update conversation title
export async function PATCH(req: Request) {
  const { id, title }: { id: string; title: string } = await req.json();

  if (!id || !title) {
    return Response.json(
      { error: "Missing id or title" },
      { status: 400 }
    );
  }

  updateConversationTitle(id, title);
  return Response.json({ success: true });
}

// DELETE: Delete a conversation
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing conversation id" }, { status: 400 });
  }

  deleteConversation(id);
  return Response.json({ success: true });
}
