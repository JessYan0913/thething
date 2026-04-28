// ============================================================
// Conversations API
// ============================================================

import { Hono } from 'hono'
import { generateConversationTitle } from '@the-thing/core'
import { getServerDataStore } from '../runtime'

const app = new Hono()

// GET: List all conversations
app.get('/', async (c) => {
  try {
    const store = await getServerDataStore()
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

    const store = await getServerDataStore()
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

    const store = await getServerDataStore()
    store.conversationStore.updateConversationTitle(body.id, body.title)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Conversations API] PATCH error:', error)
    return c.json({ error: 'Failed to update conversation' }, 500)
  }
})

// DELETE: Delete a conversation
app.delete('/', async (c) => {
  try {
    const id = c.req.query('id')

    if (!id) {
      return c.json({ error: 'Missing conversation id' }, 400)
    }

    const store = await getServerDataStore()
    store.summaryStore.deleteSummariesByConversation(id)
    store.conversationStore.deleteConversation(id)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Conversations API] DELETE error:', error)
    return c.json({ error: 'Failed to delete conversation' }, 500)
  }
})

export default app