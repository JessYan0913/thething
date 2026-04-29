// ============================================================
// Debug API
// ============================================================

import { Hono } from 'hono'
import { estimateMessagesTokens, SQLiteDataStore } from '@the-thing/core'
import { getServerDataStore } from '../runtime'

const app = new Hono()

app.get('/compaction', async (c) => {
  try {
    const conversationId = c.req.query('conversationId')

    if (!conversationId) {
      return c.json({ error: 'Missing conversationId' }, 400)
    }

    const store = await getServerDataStore()
    const messages = store.messageStore.getMessagesByConversation(conversationId)
    const tokenCount = await estimateMessagesTokens(messages)

    const summary = store.summaryStore.getSummaryByConversation(conversationId)

    const boundaryMessages = messages.filter(m => {
      if (m.role !== 'system') return false
      return m.parts.some(p =>
        p.type === 'text' && p.text.includes('SYSTEM_COMPACT_BOUNDARY')
      )
    })

    return c.json({
      conversationId,
      messageCount: messages.length,
      estimatedTokens: tokenCount,
      compactThreshold: 60000,
      wouldTriggerCompaction: tokenCount > 60000,
      hasSummary: !!summary,
      summary: summary ? {
        compactedAt: summary.compactedAt,
        preCompactTokens: summary.preCompactTokenCount,
        lastMessageOrder: summary.lastMessageOrder,
        summaryPreview: summary.summary.slice(0, 200),
      } : null,
      boundaryMessageCount: boundaryMessages.length,
    })
  } catch (error) {
    console.error('[Debug] Error:', error)
    return c.json({ error: 'Failed to get debug info' }, 500)
  }
})

export default app