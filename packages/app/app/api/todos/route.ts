import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    const rt = await getServerRuntime();
    const store = rt.dataStore.todoStore;
    const todos = conversationId
      ? store.getTodosByConversation(conversationId)
      : store.getAllTodos();

    const todosByStatus = {
      pending: todos.filter(t => t.status === 'pending'),
      in_progress: todos.filter(t => t.status === 'in_progress'),
      completed: todos.filter(t => t.status === 'completed'),
      failed: todos.filter(t => t.status === 'failed'),
      cancelled: todos.filter(t => t.status === 'cancelled'),
    };

    return NextResponse.json({
      todos,
      todosByStatus,
      total: todos.length,
      stats: {
        pending: todosByStatus.pending.length,
        in_progress: todosByStatus.in_progress.length,
        completed: todosByStatus.completed.length,
        failed: todosByStatus.failed.length,
        cancelled: todosByStatus.cancelled.length,
      },
    });
  } catch (error) {
    console.error('[Todos API] GET error:', error);
    return NextResponse.json({ error: 'Failed to get todos' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json<{ action: string; [key: string]: unknown }>();
    const { action, ...params } = body;

    const rt = await getServerRuntime();
    const store = rt.dataStore.todoStore;

    switch (action) {
      case 'claim': {
        const { todoId, agentId } = params as { todoId: string; agentId: string };
        const result = store.claimTodo(todoId, agentId);
        return NextResponse.json(result);
      }

      case 'update': {
        const { todoId, ...updates } = params as { todoId: string; [key: string]: unknown };
        const todo = store.updateTodo({ id: todoId, ...updates });
        if (!todo) {
          return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, todo });
      }

      case 'complete': {
        const { todoId, result } = params as { todoId: string; result?: string };
        const todo = store.updateTodo({
          id: todoId,
          status: 'completed',
          metadata: { result },
          activeForm: null,
        });
        if (!todo) {
          return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, todo });
      }

      case 'stop': {
        const { todoId, reason } = params as { todoId: string; reason: string };
        const todo = store.updateTodo({
          id: todoId,
          status: 'cancelled',
          metadata: { stopReason: reason },
          activeForm: null,
        });
        if (!todo) {
          return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, todo });
      }

      case 'delete': {
        const { todoId } = params as { todoId: string };
        const deleted = store.deleteTodo(todoId);
        return NextResponse.json({ success: deleted });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Todos API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process todo action' },
      { status: 500 }
    );
  }
}
