import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET: 获取所有待审批的 conversation 列表
 * 用于 Desktop 应用重启后恢复审批状态
 */
export async function GET(request: Request) {
  try {
    const rt = await getServerRuntime();
    const store = rt.dataStore;
    
    // 获取所有有挂起状态的 conversation
    const conversationIds = store.suspendedStateStore.getConversationsWithSuspendedStates();
    
    const pendingApprovals = [];
    
    for (const conversationId of conversationIds) {
      try {
        // 获取挂起的状态
        const suspendedState = store.suspendedStateStore.getSuspendedState(conversationId);
        if (!suspendedState) continue;
        
        // 解析状态
        const state = JSON.parse(suspendedState.state);
        
        // 检查是否过期
        if (new Date(suspendedState.expiresAt) <= new Date()) {
          store.suspendedStateStore.clearSuspendedState(conversationId);
          continue;
        }
        
        pendingApprovals.push({
          conversationId,
          approvals: state.pendingApprovals || [],
          createdAt: suspendedState.createdAt,
          expiresAt: suspendedState.expiresAt,
        });
      } catch (e) {
        console.error(`[Pending Approvals] Failed to process conversation ${conversationId}:`, e);
        // 清理损坏的状态
        store.suspendedStateStore.clearSuspendedState(conversationId);
      }
    }
    
    return NextResponse.json({ pendingApprovals });
  } catch (error) {
    console.error('[Pending Approvals] GET error:', error);
    return NextResponse.json({ pendingApprovals: [] }, { status: 500 });
  }
}
