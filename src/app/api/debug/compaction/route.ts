export const dynamic = "force-dynamic";

import { estimateMessagesTokens } from "@/lib/compaction";
import { getMessagesByConversation } from "@/lib/chat-store";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    if (!conversationId) {
      return Response.json(
        { error: "Missing conversationId" },
        { status: 400 }
      );
    }

    const messages = getMessagesByConversation(conversationId);
    const tokenCount = estimateMessagesTokens(messages);

    const db = getDb();
    const summary = db.prepare(
      "SELECT * FROM summaries WHERE conversation_id = ? ORDER BY compacted_at DESC LIMIT 1"
    ).get(conversationId) as Record<string, unknown> | undefined;

    const boundaryMessages = messages.filter(m => {
      if (m.role !== "system") return false;
      return m.parts.some(p =>
        p.type === "text" && p.text.includes("SYSTEM_COMPACT_BOUNDARY")
      );
    });

    return Response.json({
      conversationId,
      messageCount: messages.length,
      estimatedTokens: tokenCount,
      compactThreshold: 60000,
      wouldTriggerCompaction: tokenCount > 60000,
      hasSummary: !!summary,
      summary: summary ? {
        compactedAt: summary?.compacted_at,
        preCompactTokens: summary?.pre_compact_token_count,
        lastMessageOrder: summary?.last_message_order,
        summaryPreview: (summary?.summary as string)?.slice(0, 200),
      } : null,
      boundaryMessageCount: boundaryMessages.length,
    });
  } catch (error) {
    console.error("[Debug] Error:", error);
    return Response.json({ error: "Failed to get debug info" }, { status: 500 });
  }
}
