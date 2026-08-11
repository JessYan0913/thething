import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ chatId: string; branchId: string }> }
) {
  try {
    const { chatId: conversationId, branchId } = await params;
    const update = await request.json() as {
      name?: string | null;
      status?: 'candidate' | 'active' | 'archived';
      isPinned?: boolean;
    };
    const rt = await getServerRuntime();
    const existing = rt.dataStore.branchStore.getBranch(branchId);
    if (!existing || existing.conversationId !== conversationId) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }
    const branch = rt.dataStore.branchStore.updateBranch(branchId, update);
    return NextResponse.json({
      success: true,
      branch,
      projection: rt.dataStore.branchStore.getProjection(conversationId, { includeTree: true }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update branch';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ chatId: string; branchId: string }> }
) {
  try {
    const { chatId: conversationId, branchId } = await params;
    const rt = await getServerRuntime();
    const existing = rt.dataStore.branchStore.getBranch(branchId);
    if (!existing || existing.conversationId !== conversationId) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }
    rt.dataStore.branchStore.deleteBranch(branchId);
    return NextResponse.json({
      success: true,
      projection: rt.dataStore.branchStore.getProjection(conversationId, { includeTree: true }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete branch';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
