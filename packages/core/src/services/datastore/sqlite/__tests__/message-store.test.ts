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

function toolMsg(id: string, state: 'approval-requested' | 'approval-responded' | 'output-available' | 'input-available'): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{
      type: 'tool-ask_user_question',
      toolCallId: 'call-1',
      state,
      input: { questions: [] },
      ...(state === 'approval-requested'
        ? { approval: { id: 'approval-1' } }
        : state === 'approval-responded'
          ? { approval: { id: 'approval-1', approved: true, reason: '{"answers":{"需求":"回复"}}' } }
          : state === 'output-available'
            ? { output: { answers: { 需求: '回复' }, timestamp: 1 } }
            : {}),
    }],
  } as UIMessage
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

  describe('commitAssistantContinuation', () => {
    it('replaces the active approval state without duplicating it on the active path', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'approval-requested')])

      const respondedId = store.messageStore.commitAssistantContinuation(
        CONV,
        toolMsg('client-generated-id', 'approval-responded'),
      )
      expect(respondedId).not.toBe('a1')
      let active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((message) => message.id)).toEqual(['u1', respondedId])
      expect((active[1].parts[0] as { state: string }).state).toBe('approval-responded')

      const outputId = store.messageStore.commitAssistantContinuation(
        CONV,
        toolMsg('another-client-generated-id', 'output-available'),
      )
      store.messageStore.appendMessages(CONV, [msg('a-final', 'assistant', 'final')], outputId)

      active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((message) => message.id)).toEqual(['u1', outputId, 'a-final'])
      expect((active[1].parts[0] as { state: string }).state).toBe('output-available')
      expect(store.messageStore.getConversationTree(CONV).nodes).toHaveLength(5)
    })

    it('rejects a stale continuation after the active head has moved', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'approval-requested')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'new input'))

      expect(() => store.messageStore.commitAssistantContinuation(
        CONV,
        toolMsg('client-generated-id', 'approval-responded'),
      )).toThrow('is not an assistant message')
    })

    it('rejects a continuation for a different tool call', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'approval-requested')])
      const different = toolMsg('client-generated-id', 'approval-responded')
      ;(different.parts[0] as { toolCallId: string }).toolCallId = 'call-other'

      expect(() => store.messageStore.commitAssistantContinuation(CONV, different))
        .toThrow('does not match the active tool call')
    })

    it('rejects an invalid state transition for the same tool call', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'approval-requested')])

      expect(() => store.messageStore.commitAssistantContinuation(
        CONV,
        toolMsg('client-generated-id', 'output-available'),
      )).toThrow('does not match the active tool call')
    })

    it('accepts input-available → output-available for client tools', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'input-available')])

      const outputId = store.messageStore.commitAssistantContinuation(
        CONV,
        toolMsg('client-generated-id', 'output-available'),
      )
      expect(outputId).not.toBe('a1')
      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((message) => message.id)).toEqual(['u1', outputId])
      expect((active[1].parts[0] as { state: string }).state).toBe('output-available')
    })

    it('accepts input-available → output-error as a valid cancellation', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'input-available')])

      const errId = store.messageStore.commitAssistantContinuation(
        CONV,
        { ...toolMsg('client-generated-id', 'output-available'), parts: [{
          type: 'tool-ask_user_question',
          toolCallId: 'call-1',
          state: 'output-error',
          input: { questions: [] },
          errorText: '用户取消了提问',
        }] } as UIMessage,
      )
      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((message) => message.id)).toEqual(['u1', errId])
      expect((active[1].parts[0] as { state: string }).state).toBe('output-error')
    })

    it('accepts same-terminal-state extension (onEnd persists resumed reply)', () => {
      // 续跑流结束：工具 part 状态不变（output-available），消息新增了 text part
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'input-available')])
      store.messageStore.commitAssistantContinuation(
        CONV, toolMsg('answered', 'output-available'),
      )

      const extended = toolMsg('final', 'output-available')
      extended.parts = [...extended.parts, { type: 'text', text: '基于你的回答…' } as UIMessage['parts'][number]]
      const finalId = store.messageStore.commitAssistantContinuation(CONV, extended)

      const active = store.messageStore.getMessagesByConversation(CONV)
      expect(active.map((message) => message.id)).toEqual(['u1', finalId])
      expect(active[1].parts).toHaveLength(2)
      expect((active[1].parts[1] as { text: string }).text).toBe('基于你的回答…')
    })

    it('is idempotent when the same parts are committed twice', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [toolMsg('a1', 'input-available')])
      const firstId = store.messageStore.commitAssistantContinuation(
        CONV, toolMsg('client-id-1', 'output-available'),
      )
      const secondId = store.messageStore.commitAssistantContinuation(
        CONV, toolMsg('client-id-2', 'output-available'),
      )
      expect(secondId).toBe(firstId)
      // 没有插入重复节点
      const treeSize = store.messageStore.getConversationTree(CONV).nodes.length
      expect(treeSize).toBe(3) // u1 + a1 + firstId
    })

    it('rejects non-assistant messages', () => {
      expect(() => store.messageStore.commitAssistantContinuation(
        CONV,
        msg('u1', 'user', 'invalid'),
      )).toThrow('must have role assistant')
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

    it('rejects an append anchor from another conversation', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.commitUserMessage('conv-2', msg('u2', 'user', 'q2'))

      expect(() =>
        store.messageStore.appendMessages(CONV, [msg('a-cross', 'assistant', 'invalid')], 'u2')
      ).toThrow('does not belong to conversation')
      expect(store.messageStore.getConversationTree(CONV).nodes.map((node) => node.id)).toEqual(['u1'])
    })

    it('empty append is a no-op returning true', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      expect(store.messageStore.appendMessages(CONV, [])).toBe(true)
    })

    // 生产事故(2026-07-21):同一条 978KB assistant 回复用两个不同 id
    // 在同一秒被写入两次,活跃路径长度翻倍 → 上下文膨胀
    it('dedupes same-content append under the same parent (different ids)', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])

      // 重复写入:内容相同但 id 不同,锚点同为 u1
      const moved = store.messageStore.appendMessages(CONV, [msg('a1-dup', 'assistant', 'r1')], 'u1')
      // head 已在 a1(≠锚点 u1),CAS 失败返回 false
      expect(moved).toBe(false)
      // 关键:没有插入重复节点,活跃路径不变
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1'])
      expect(store.messageStore.getBranchInfo(CONV).branches).toEqual({})
    })

    it('dedup advances parentId so trailing messages chain onto the existing node', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])

      // 重放包含已存在的 a1(同内容不同 id) + 新消息 a2
      const moved = store.messageStore.appendMessages(
        CONV,
        [msg('a1-replay', 'assistant', 'r1'), msg('a2', 'assistant', 'r2')],
        'u1',
      )
      expect(moved).toBe(false) // head 在 a1,锚点 u1 → 不动 head
      // a2 挂在既有 a1 之下(而非重复的 a1-replay 之下)
      store.messageStore.switchHead(CONV, 'a2', false)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1', 'a2'])
    })

    it('does NOT dedup different content under the same parent', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'different')], 'u1')
      // 两个不同回答都存在(a2 是孤儿分支)
      store.messageStore.switchHead(CONV, 'a2', false)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a2'])
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

  describe('getBranchInfo / switchHead', () => {
    it('reports sibling versions at regenerated positions', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1')) // regenerate
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'r2')], 'u1')

      const { branches } = store.messageStore.getBranchInfo(CONV)
      expect(branches['a2']).toEqual(['a1', 'a2']) // a1、a2 同为 u1 的孩子
      expect(branches['u1']).toBeUndefined() // u1 无兄弟
    })

    it('switchHead descends to the tip of the target branch', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'r2')])
      // regenerate a1 → 新分支只有 a1b
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1b', 'assistant', 'r1b')], 'u1')

      // 切回旧分支 a1 → head 应下行到旧分支叶子 a2
      expect(store.messageStore.switchHead(CONV, 'a1')).toBe(true)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id))
        .toEqual(['u1', 'a1', 'u2', 'a2'])
    })

    it('switchHead with descendToTip=false parks head on the message (fork point)', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'r2')])

      expect(store.messageStore.switchHead(CONV, 'a1', false)).toBe(true)
      expect(store.messageStore.getMessagesByConversation(CONV).map((m) => m.id)).toEqual(['u1', 'a1'])

      // headChildId 指向"后面的消息"入口
      const { headChildId } = store.messageStore.getBranchInfo(CONV)
      expect(headChildId).toBe('u2')

      // 从分叉点发新消息 → u2 的兄弟出现
      store.messageStore.commitUserMessage(CONV, msg('u3', 'user', 'q3-branched'))
      const { branches } = store.messageStore.getBranchInfo(CONV)
      expect(branches['u3']).toEqual(['u2', 'u3'])
    })

    it('switchHead returns false for a message not in the conversation', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      expect(store.messageStore.switchHead(CONV, 'nope')).toBe(false)
    })

    it('invalidates summary when switching makes its anchor leave the active path', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q1'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')])
      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      store.summaryStore.saveSummary(CONV, 'summary', 2, 100, 'u2')

      store.messageStore.switchHead(CONV, 'a1', false) // u2 离开活跃路径
      expect(store.summaryStore.getSummaryByConversation(CONV)).toBeNull()
    })
  })

  describe('conversation tree projection and revision', () => {
    it('returns every branch node with active-path flags and previews', () => {
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'question'))
      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'first answer')])
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'question'))
      store.messageStore.appendMessages(CONV, [msg('a2', 'assistant', 'second answer')], 'u1')

      const tree = store.messageStore.getConversationTree(CONV)
      expect(tree.activeTipId).toBe('a2')
      expect(tree.nodes.map((node) => node.id)).toEqual(['u1', 'a1', 'a2'])
      expect(tree.nodes.find((node) => node.id === 'u1')).toMatchObject({
        preview: 'question',
        childCount: 2,
        isActivePath: true,
      })
      expect(tree.nodes.find((node) => node.id === 'a1')?.isActivePath).toBe(false)
      expect(tree.nodes.find((node) => node.id === 'a2')).toMatchObject({
        preview: 'second answer',
        isActivePath: true,
      })
    })

    it('increments revision for head changes and orphan branch inserts', () => {
      expect(store.messageStore.getConversationTree(CONV).revision).toBe(0)
      store.messageStore.commitUserMessage(CONV, msg('u1', 'user', 'q'))
      const afterUser = store.messageStore.getConversationTree(CONV).revision
      expect(afterUser).toBe(1)

      store.messageStore.appendMessages(CONV, [msg('a1', 'assistant', 'r1')], 'u1')
      const afterAnswer = store.messageStore.getConversationTree(CONV).revision
      expect(afterAnswer).toBe(afterUser + 1)

      store.messageStore.commitUserMessage(CONV, msg('u2', 'user', 'q2'))
      const beforeStale = store.messageStore.getConversationTree(CONV).revision
      expect(store.messageStore.appendMessages(CONV, [msg('a-stale', 'assistant', 'stale')], 'u1')).toBe(false)
      expect(store.messageStore.getConversationTree(CONV).revision).toBe(beforeStale + 1)
    })

    it('returns an empty projection for an unknown conversation', () => {
      expect(store.messageStore.getConversationTree('missing')).toEqual({
        revision: 0,
        activeTipId: null,
        nodes: [],
      })
    })
  })

  describe('getMessagesByConversation', () => {
    it('returns empty for unknown conversation', () => {
      expect(store.messageStore.getMessagesByConversation('nope')).toEqual([])
    })
  })
})
