// ============================================================
// Todos API
// ============================================================

import { Hono } from 'hono'
import { getServerDataStore } from '../runtime'

const app = new Hono()

app.get('/', async (c) => {
  try {
    const conversationId = c.req.query('conversationId')

    const dataStore = await getServerDataStore()
    const store = dataStore.todoStore
    const todos = conversationId
      ? store.getTodosByConversation(conversationId)
      : store.getAllTodos()

    const todosByStatus = {
      pending: todos.filter(t => t.status === 'pending'),
      in_progress: todos.filter(t => t.status === 'in_progress'),
      completed: todos.filter(t => t.status === 'completed'),
      failed: todos.filter(t => t.status === 'failed'),
      cancelled: todos.filter(t => t.status === 'cancelled'),
    }

    return c.json({
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
    })
  } catch (error) {
    console.error('[Todos API] GET error:', error)
    return c.json({ error: 'Failed to get todos' }, 500)
  }
})

app.post('/', async (c) => {
  try {
    const dataStore = await getServerDataStore()
    const store = dataStore.todoStore
    const body = await c.req.json<{ action: string; [key: string]: unknown }>()
    const { action, ...params } = body

    switch (action) {
      case 'claim': {
        const { todoId, agentId } = params as { todoId: string; agentId: string }
        const result = store.claimTodo(todoId, agentId)
        return c.json(result)
      }

      case 'update': {
        const { todoId, ...updates } = params as { todoId: string; [key: string]: unknown }
        const todo = store.updateTodo({ id: todoId, ...updates })
        if (!todo) {
          return c.json({ error: 'Todo not found' }, 404)
        }
        return c.json({ success: true, todo })
      }

      case 'complete': {
        const { todoId, result } = params as { todoId: string; result?: string }
        const todo = store.updateTodo({
          id: todoId,
          status: 'completed',
          metadata: { result },
          activeForm: null,
        })
        if (!todo) {
          return c.json({ error: 'Todo not found' }, 404)
        }
        return c.json({ success: true, todo })
      }

      case 'stop': {
        const { todoId, reason } = params as { todoId: string; reason: string }
        const todo = store.updateTodo({
          id: todoId,
          status: 'cancelled',
          metadata: { stopReason: reason },
          activeForm: null,
        })
        if (!todo) {
          return c.json({ error: 'Todo not found' }, 404)
        }
        return c.json({ success: true, todo })
      }

      case 'delete': {
        const { todoId } = params as { todoId: string }
        const deleted = store.deleteTodo(todoId)
        return c.json({ success: deleted })
      }

      default:
        return c.json({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    console.error('[Todos API] POST error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to process todo action' },
      500
    )
  }
})

export default app