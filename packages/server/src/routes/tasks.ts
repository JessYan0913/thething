// ============================================================
// Tasks API
// ============================================================

import { Hono } from 'hono'
import { getGlobalTaskStore } from '@thething/core'

const app = new Hono()

app.get('/', (c) => {
  try {
    const conversationId = c.req.query('conversationId')

    const store = getGlobalTaskStore()
    const tasks = conversationId
      ? store.getTasksByConversation(conversationId)
      : store.getAllTasks()

    const tasksByStatus = {
      pending: tasks.filter(t => t.status === 'pending'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      completed: tasks.filter(t => t.status === 'completed'),
      failed: tasks.filter(t => t.status === 'failed'),
      cancelled: tasks.filter(t => t.status === 'cancelled'),
    }

    return c.json({
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
    })
  } catch (error) {
    console.error('[Tasks API] GET error:', error)
    return c.json({ error: 'Failed to get tasks' }, 500)
  }
})

app.post('/', async (c) => {
  try {
    const store = getGlobalTaskStore()
    const body = await c.req.json<{ action: string; [key: string]: unknown }>()
    const { action, ...params } = body

    switch (action) {
      case 'claim': {
        const { taskId, agentId } = params as { taskId: string; agentId: string }
        const result = store.claimTask(taskId, agentId)
        return c.json(result)
      }

      case 'update': {
        const { taskId, ...updates } = params as { taskId: string; [key: string]: unknown }
        const task = store.updateTask({ id: taskId, ...updates })
        if (!task) {
          return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ success: true, task })
      }

      case 'complete': {
        const { taskId, result } = params as { taskId: string; result?: string }
        const task = store.updateTask({
          id: taskId,
          status: 'completed',
          metadata: { result },
          activeForm: null,
        })
        if (!task) {
          return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ success: true, task })
      }

      case 'stop': {
        const { taskId, reason } = params as { taskId: string; reason: string }
        const task = store.updateTask({
          id: taskId,
          status: 'cancelled',
          metadata: { stopReason: reason },
          activeForm: null,
        })
        if (!task) {
          return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ success: true, task })
      }

      case 'delete': {
        const { taskId } = params as { taskId: string }
        const deleted = store.deleteTask(taskId)
        return c.json({ success: deleted })
      }

      default:
        return c.json({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    console.error('[Tasks API] POST error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to process task action' },
      500
    )
  }
})

export default app