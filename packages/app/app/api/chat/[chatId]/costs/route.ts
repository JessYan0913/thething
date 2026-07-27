// ============================================================
// GET /api/chat/[chatId]/costs
// ============================================================
// 返回对话的 token 统计(输入/输出/缓存 token + 成本)。
// 数据来自 chat_costs 表,由 CostTracker.persistToDB 在 finalize 时写入。

import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const rt = await getServerRuntime();
    const cost = rt.dataStore.costStore.getCostByConversation(chatId);

    if (!cost) {
      return NextResponse.json({
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        totalCostUsd: 0,
        model: null,
      });
    }

    return NextResponse.json(cost);
  } catch (error) {
    console.error('[Costs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cost data' },
      { status: 500 }
    );
  }
}
