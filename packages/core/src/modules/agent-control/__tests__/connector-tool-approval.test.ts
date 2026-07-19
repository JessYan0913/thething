import { describe, expect, it } from 'vitest'
import { catchAllApproval, type ApprovalRuntimeContext } from '../tool-approval'
import type { PermissionRule } from '../../permissions/types'

function makeCtx(overrides?: Partial<ApprovalRuntimeContext>): ApprovalRuntimeContext {
  return {
    turnCount: 1,
    projectRoot: '/tmp/project',
    permissionRules: [],
    costTracker: {
      isOverBudget: false,
      totalCost: 0,
      getSummary: () => ({ remainingBudget: 10, totalCostUsd: 0, maxBudgetUsd: 10, budgetUsagePercent: 0 }),
    },
    denialTracker: {
      getDenialCount: () => 0,
      isToolExceeded: () => false,
    },
    approvalMode: 'smart',
    connectorToolNames: new Set(['feishu_send_message', 'feishu_delete_reaction']),
    ...overrides,
  }
}

function callApproval(toolName: string, input: unknown, ctx: ApprovalRuntimeContext) {
  return catchAllApproval({
    toolCall: { toolName, args: input },
    tools: {},
    toolsContext: {},
    runtimeContext: ctx,
    messages: [],
  })
}

function rule(toolName: string, behavior: 'allow' | 'ask' | 'deny', pattern?: string): PermissionRule {
  return { id: `rule-${toolName}`, toolName, pattern, behavior, createdAt: Date.now(), source: 'user' }
}

describe('connector tool approval', () => {
  it('requires user approval for connector tools by default', async () => {
    const result = await callApproval('feishu_send_message', { text: 'hi' }, makeCtx())
    expect(result).toBe('user-approval')
  })

  it('auto-approves connector tools with allow rule', async () => {
    const ctx = makeCtx({ permissionRules: [rule('feishu_send_message', 'allow')] })
    const result = await callApproval('feishu_send_message', { text: 'hi' }, ctx)
    expect(result).toBe('approved')
  })

  it('denies connector tools with deny rule', async () => {
    const ctx = makeCtx({ permissionRules: [rule('feishu_send_message', 'deny')] })
    const result = await callApproval('feishu_send_message', { text: 'hi' }, ctx)
    expect(result).toBe('denied')
  })

  it('matches connector tool family with prefix wildcard rule', async () => {
    const ctx = makeCtx({ permissionRules: [rule('feishu_*', 'allow')] })
    expect(await callApproval('feishu_send_message', {}, ctx)).toBe('approved')
    expect(await callApproval('feishu_delete_reaction', {}, ctx)).toBe('approved')
  })

  it('ignores unknown tools (not connector, not builtin)', async () => {
    const result = await callApproval('some_unknown_tool', {}, makeCtx())
    expect(result).toBeUndefined()
  })

  it('approves connector tools in full-trust mode', async () => {
    const ctx = makeCtx({ approvalMode: 'full-trust' })
    const result = await callApproval('feishu_send_message', {}, ctx)
    expect(result).toBe('approved')
  })
})
