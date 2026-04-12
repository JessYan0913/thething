/**
 * Tasks API
 * 
 * Provides REST API for task management operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGlobalTaskStore } from '@/lib/tasks';
import type { Task } from '@/lib/tasks/types';

export async function GET() {
  try {
    const store = getGlobalTaskStore();
    const tasks = store.getAllTasks();

    // Group by status for easier consumption
    const tasksByStatus = {
      pending: tasks.filter(t => t.status === 'pending'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      completed: tasks.filter(t => t.status === 'completed'),
      failed: tasks.filter(t => t.status === 'failed'),
      cancelled: tasks.filter(t => t.status === 'cancelled'),
    };

    return NextResponse.json({
      tasks,
      tasksByStatus,
      total: tasks.length,
      stats: {
        pending: tasksByStatus.pending.length,
        in_progress: tasksByStatus.in_progress.length,
        completed: tasksByStatus.completed.length,
        failed: tasksByStatus.failed.length,
        cancelled: tasksByStatus.cancelled.length,
      },
    });
  } catch (error) {
    console.error('[Tasks API] GET error:', error);
    return NextResponse.json({ error: 'Failed to get tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const store = getGlobalTaskStore();
    const body = await request.json();
    const { action, ...params } = body;

    switch (action) {
      case 'claim': {
        const { taskId, agentId } = params;
        const result = store.claimTask(taskId, agentId);
        return NextResponse.json(result);
      }

      case 'update': {
        const { taskId, ...updates } = params;
        const task = store.updateTask({ id: taskId, ...updates });
        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, task });
      }

      case 'complete': {
        const { taskId, result } = params;
        const task = store.updateTask({
          id: taskId,
          status: 'completed',
          metadata: { result },
          activeForm: null,
        });
        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, task });
      }

      case 'stop': {
        const { taskId, reason } = params;
        const task = store.updateTask({
          id: taskId,
          status: 'cancelled',
          metadata: { stopReason: reason },
          activeForm: null,
        });
        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, task });
      }

      case 'delete': {
        const { taskId } = params;
        const deleted = store.deleteTask(taskId);
        return NextResponse.json({ success: deleted });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Tasks API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process task action' },
      { status: 500 }
    );
  }
}
