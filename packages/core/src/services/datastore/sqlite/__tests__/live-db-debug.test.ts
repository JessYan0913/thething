import { describe, expect, it } from 'vitest'
import { createSQLiteDataStore } from '../sqlite-data-store'

describe('live db read debug', () => {
  it('reads conversations from copied live db', () => {
    const store = createSQLiteDataStore({ dataDir: '/tmp/dbg' })
    const db = (store as unknown as { db: { prepare(s: string): { all(...a: unknown[]): unknown[] } } }).db
    const convs = db.prepare("SELECT id, head_message_id FROM conversations WHERE head_message_id IS NOT NULL ORDER BY updated_at DESC LIMIT 8").all() as { id: string }[]
    for (const c of convs) {
      const msgs = store.messageStore.getMessagesByConversation(c.id)
      const bi = store.messageStore.getBranchInfo(c.id)
      console.log(c.id, 'messages:', msgs.length, 'branches:', Object.keys(bi.branches).length)
      expect(msgs.length).toBeGreaterThan(0)
    }
    store.close()
  })
})
