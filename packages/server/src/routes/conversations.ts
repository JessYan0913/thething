// ============================================================
// Conversations API
// ============================================================

import { Hono } from 'hono'
import {
  generateConversationTitle,
  getGlobalDataStore,
} from '@thething/core'

const app = new Hono()

// GET: List all conversations
app.get('/', (c) => {
  try {
    const store = getGlobalDataStore()
    const conversations = store.conversationStore.listConversations()
    return c.json({ conversations })
  } catch (error) {
    console.error('[Conversations API] GET error:', error)
    return c.json({ error: 'Failed to load conversations' }, 500)
  }
})

// POST: Create a new conversation
app.post('/', async (c) => {
  try {
    const body = await c.req.json<{ id?: string; title?: string }>()

    if (!body.id) {
      return c.json({ error: 'Missing conversation id' }, 400)
    }

    const store = getGlobalDataStore()
    const conversation = store.conversationStore.createConversation(body.id, body.title)
    return c.json({ conversation })
  } catch (error) {
    console.error('[Conversations API] POST error:', error)
    return c.json({ error: 'Failed to create conversation' }, 500)
  }
})

// PATCH: Update conversation title
app.patch('/', async (c) => {
  try {
    const body = await c.req.json<{ id: string; title: string }>()

    if (!body.id || !body.title) {
      return c.json({ error: 'Missing id or title' }, 400)
    }

    const store = getGlobalDataStore()
    store.conversationStore.updateConversationTitle(body.id, body.title)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Conversations API] PATCH error:', error)
    return c.json({ error: 'Failed to update conversation' }, 500)
  }
})

// DELETE: Delete a conversation
app.delete('/', (c) => {
  try {
    const id = c.req.query('id')

    if (!id) {
      return c.json({ error: 'Missing conversation id' }, 400)
    }

    const store = getGlobalDataStore()
    store.summaryStore.deleteSummariesByConversation(id)
    store.conversationStore.deleteConversation(id)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Conversations API] DELETE error:', error)
    return c.json({ error: 'Failed to delete conversation' }, 500)
  }
})

export default app