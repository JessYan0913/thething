import { describe, expect, it } from 'vitest'
import { detectApprovalResponse } from '../approval-context'

describe('detectApprovalResponse (strict command matching)', () => {
  it('accepts exact approve commands', () => {
    for (const cmd of ['同意', '批准', 'y', 'yes', 'OK', 'Approve', '  同意  ', '同意。']) {
      const result = detectApprovalResponse(cmd)
      expect(result.isApprove, `"${cmd}" should approve`).toBe(true)
      expect(result.isDeny).toBe(false)
    }
  })

  it('accepts exact deny commands', () => {
    for (const cmd of ['拒绝', '不同意', '取消', 'n', 'no', 'Deny']) {
      const result = detectApprovalResponse(cmd)
      expect(result.isDeny, `"${cmd}" should deny`).toBe(true)
      expect(result.isApprove).toBe(false)
    }
  })

  it('does not match substrings in natural language', () => {
    for (const text of [
      '好的，不要删了',
      '我觉得可以先看看',
      '行程安排一下',
      '这个方案不行吧，换一个',
      'ok let me think about it',
      '没问题的话就继续',
    ]) {
      const result = detectApprovalResponse(text)
      expect(result.isApprovalResponse, `"${text}" should NOT be an approval response`).toBe(false)
    }
  })

  it('treats ambiguous single keywords not in command set as normal messages', () => {
    for (const text of ['好', '行', '可以', '没问题', '是的']) {
      expect(detectApprovalResponse(text).isApprovalResponse).toBe(false)
    }
  })
})
