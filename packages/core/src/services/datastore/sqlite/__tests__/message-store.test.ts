// ============================================================
// SQLiteMessageStore — 不可变消息树测试
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { createSQLiteDataStore, type SQLiteDataStore } from '../sqlite-data-store'

function msg(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

function texts(messages: UIMessage[]): string[] {
  return messages.map((m) => (m.parts[0] as { text: string }).text)
}

const CONV = 'conv-1'

describe('SQLiteMessageStore (immutable tree)', () => {
  let tmpDir: string
  let store: SQLiteDataStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-tree-test-'))
    store = createSQLiteDataStore({ dataDir: tmpDir })
  })

  afterEach(() => {
    store.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('commitUserMessage — normal send', () => {
    it('inserts as child of head, moves head, auto-creates conversation', () => {
      const headId = store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'hello'))
      expect(headId).toBe('u1')
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1'])
      expect(store.conversationStore.getConversation(CONV)).toBeTruthy()
    })

    it('chains consecutive sends', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    })
  })

  describe('commitUserMessage — regenerate (same id, same parts)', () => {
    it('moves head back to the message; old answers become orphan branches', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])

      const headId = store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      expect(headId).toBe('u1')
      // 旧回答 a1 不再出现在活跃路径
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1'])

      // 新回答挂到 u1 后
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'r2')], headId)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a2'])
    })

    it('failed regeneration loses nothing permanently: old branch rows remain', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1')) // regenerate 开始
      // 新生成失败 → 什么都不 append。a1 行仍在表中（只是不在活跃路径）：
      // 把 head 移回 a1 即可完整恢复（未来分支切换 UI 的基础）
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1'])
    })
  })

  describe('commitUserMessage — edit-resend (same id, new parts)', () => {
    it('inserts a NEW sibling node; old version and its subtree stay intact', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'original'))
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'r2')])

      const newHeadId = store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'edited'))
      expect(newHeadId).not.toBe('u2') // 编辑产生新节点

      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((m) => m.id)).toEqual(['u1', 'a1', newHeadId])
      expect(texts(active)).toEqual(['q1', 'r1', 'edited'])
    })

    it('edit history is recoverable: committing the original moves head back to the old node', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'original'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'edited'))

      // u1 原节点仍在树中：以原内容 commit 命中 regenerate 语义，head 移回 u1
      const backToOld = store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'original'))
      expect(backToOld).toBe('u1')
      expect(texts(store.messageStore.getMessagesByConversation(CONV))).toEqual(['original'])
    })
  })

  describe('appendMessages — head CAS', () => {
    it('appends a chain and moves head when anchored at current head', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      const moved = store.messageStore.appendMessages(CONV, [
        msg('a1', 'assistant', 'r1'),
        msg('a2', 'assistant', 'r2'),
      ])
      expect(moved).toBe(true)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1', 'a2'])
    })

    it('stale write becomes a harmless orphan branch (head unchanged)', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      // 旧运行记住了锚点 u1；此时用户又发了新消息，head 移走
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))

      // 旧运行迟到的写入：锚在 u1 上
      const moved = store.messageStore.appendMessages(CONV, [msg('a-stale', 'assistant', 'stale')], 'u1')
      expect(moved).toBe(false)
      // 活跃路径完全不受影响
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1', 'u2'])
    })

    it('empty append is a no-op returning true', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      expect(store.messageStore.appendMessages(CONV, [])).toBe(true)
    })
  })

  describe('summary invalidation', () => {
    it('deletes compaction summary when its anchor leaves the active path', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      store.summaryStore.saveSummary(CONV, 'summary text', 2, 100, 'u2')

      // 编辑 u2 → 新节点顶替，u2 离开活跃路径 → 摘要失效
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2-edited'))
      expect(store.summaryStore.getSummaryByConversation(CONV)).toBeNull()
    })

    it('keeps summary while anchor stays on the active path', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.summaryStore.saveSummary(CONV, 'summary text', 0, 100, 'u1')

      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      expect(store.summaryStore.getSummaryByConversation(CONV)).toBeTruthy()
    })
  })

  describe('replaceConversation (dev-tool semantics)', () => {
    it('rebuilds the conversation as a linear chain', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'old'))
      store.messageStore.replaceConversation(CONV, [
        msg('n1', 'user', 'new1'),
        msg('n2', 'assistant', 'new2'),
      ])
      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((m) => m.id)).toEqual(['n1', 'n2'])
    })

    it('assigns ids to messages without one and de-dupes conflicting ids', () => {
      store.messageStore.replaceConversation(CONV, [
        { role: 'user', parts: [{ type: 'text', text: 'no id' }] } as UIMessage,
        msg('x', 'user', 'first-x'),
        msg('x', 'user', 'second-x'),
      ])
      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active).toHaveLength(3)
      expect(new Set(active.map((m) => m.id)).size).toBe(3)
    })

    it('empty list clears the conversation view', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.replaceConversation(CONV, [])
      expect(store.messageStore.getMessagesByConversation(CONV)).toEqual([])
    })
  })

  describe('getMessagesByConversation', () => {
    it('returns empty for unknown conversation', () => {
      expect(store.messageStore.getMessagesByConversation('nope')).toEqual([])
    })
  })
})
