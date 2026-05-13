import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage, UIMessage } from 'ai'
import type { AppContext } from '../../../../api/app'
import type { DataStore } from '../../../../foundation/datastore/types'
import type { ConnectorRegistry } from '../../registry'
import type { InboundEvent } from '../types'
import { AgentInboundHandler } from '../agent-handler'
import { clearAllSuspendedStates, getSuspendedState } from '../../approval-context'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  checkPermissionRules: vi.fn(),
  extractMemoriesInBackground: vi.fn(),
  generateConversationTitle: vi.fn(),
}))

vi.mock('../../../../api/app', () => ({
  createAgent: mocks.createAgent,
}))

vi.mock('../../../permissions/rules', () => ({
  checkPermissionRules: mocks.checkPermissionRules,
}))

vi.mock('../../../memory', () => ({
  extractMemoriesInBackground: mocks.extractMemoriesInBackground,
}))

vi.mock('../../../../runtime/compaction', () => ({
  generateConversationTitle: mocks.generateConversationTitle,
}))

describe('AgentInboundHandler approval resume', () => {
  beforeEach(() => {
    clearAllSuspendedStates()
    mocks.createAgent.mockReset()
    mocks.checkPermissionRules.mockReset()
    mocks.extractMemoriesInBackground.mockReset()
    mocks.generateConversationTitle.mockReset()
    mocks.checkPermissionRules.mockReturnValue(null)
    mocks.extractMemoriesInBackground.mockResolvedValue(undefined)
    mocks.generateConversationTitle.mockResolvedValue('connector conversation')
  })

  it('stores the tool approval request in suspended model messages', async () => {
    const streamCalls: ModelMessage[][] = []
    mocks.createAgent.mockImplementation(createAgentFactory(streamCalls, [approvalRequestStream()]))

    const { handler, store } = createHandler()
    const result = await handler.handle(inboundEvent('write-request-store', '帮我写一个文档'))

    expect(result.success).toBe(true)
    expect(result.response).toContain('需要您的审批确认')

    const suspended = getSuspendedState('connector:test-service:channel:channel-1')
    expect(suspended).not.toBeNull()
    expect(suspended!.pendingApprovals).toEqual([{
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      toolName: 'write_file',
      toolInput: { filePath: 'DeepSeek-V4介绍.md', content: '# DeepSeek V4' },
    }])
    expect(findAssistantPart(suspended!.pausedModelMessages as ModelMessage[], 'tool-approval-request')).toMatchObject({
      approvalId: 'approval-1',
      toolCallId: 'call-1',
    })

    const savedMessages = store.messageStore.getMessagesByConversation('connector:test-service:channel:channel-1')
    expect(savedMessages).toHaveLength(2)
    expect(savedMessages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: '帮我写一个文档' }],
    })
    expect(savedMessages[1]).toMatchObject({
      role: 'assistant',
    })
  })

  it('resumes with the original approval request before appending approval response', async () => {
    const streamCalls: ModelMessage[][] = []
    mocks.createAgent.mockImplementation(createAgentFactory(streamCalls, [
      approvalRequestStream(),
      finalTextStream('已写入文档'),
    ]))

    const { handler } = createHandler()
    await handler.handle(inboundEvent('write-request-resume', '帮我写一个文档'))

    const result = await handler.handle(inboundEvent('approval-reply-resume', '同意'))

    expect(result.success).toBe(true)
    expect(result.response).toContain('已写入文档')

    const resumeMessages = streamCalls[1]
    expect(findAssistantPart(resumeMessages, 'tool-approval-request')).toMatchObject({
      approvalId: 'approval-1',
      toolCallId: 'call-1',
    })
    expect(resumeMessages.at(-1)).toMatchObject({
      role: 'tool',
      content: [{
        type: 'tool-approval-response',
        approvalId: 'approval-1',
        approved: true,
      }],
    })
  })

  it('auto-approves later local file tool approvals in the same suspended task', async () => {
    const streamCalls: ModelMessage[][] = []
    mocks.createAgent.mockImplementation(createAgentFactory(streamCalls, [
      approvalRequestStream(),
      approvalRequestStream({
        approvalId: 'approval-2',
        toolCallId: 'call-2',
        toolName: 'edit_file',
        input: {
          filePath: 'DeepSeek-V4介绍.md',
          oldString: '# DeepSeek V4',
          newString: '# DeepSeek V4\n\n已更新',
        },
      }),
      finalTextStream('文件已更新'),
    ]))

    const { handler } = createHandler()
    await handler.handle(inboundEvent('write-request-file-scope', '帮我写一个文档'))

    const result = await handler.handle(inboundEvent('approval-reply-file-scope', '同意'))

    expect(result.success).toBe(true)
    expect(result.response).toContain('文件已更新')
    expect(getSuspendedState('connector:test-service:channel:channel-1')).toBeNull()

    const editApprovalMessages = streamCalls[2]
    expect(editApprovalMessages.at(-1)).toMatchObject({
      role: 'tool',
      content: [{
        type: 'tool-approval-response',
        approvalId: 'approval-2',
        approved: true,
      }],
    })
  })

  it('keeps executed tool results when auto-approving later approvals', async () => {
    const streamCalls: ModelMessage[][] = []
    mocks.createAgent.mockImplementation(createAgentFactory(streamCalls, [
      approvalRequestStream(),
      executedToolsWithApprovalRequestStream(),
      finalTextStream('后续操作完成'),
    ]))

    const { handler } = createHandler()
    await handler.handle(inboundEvent('write-request-with-executed-tools', '帮我写一个文档'))

    const result = await handler.handle(inboundEvent('approval-reply-with-executed-tools', '同意'))

    expect(result.success).toBe(true)
    expect(result.response).toContain('后续操作完成')

    const autoApprovalMessages = streamCalls[2]
    expect(autoApprovalMessages.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-read',
          toolName: 'read_file',
          output: { type: 'json', value: '原文件内容' },
        },
        {
          type: 'tool-result',
          toolCallId: 'call-glob',
          toolName: 'glob',
          output: { type: 'json', value: ['DeepSeek-V4介绍.md'] },
        },
        {
          type: 'tool-approval-response',
          approvalId: 'approval-2',
          approved: true,
        },
      ],
    })
  })

  it('resumes all pending approvals from a single suspended round', async () => {
    const streamCalls: ModelMessage[][] = []
    mocks.createAgent.mockImplementation(createAgentFactory(streamCalls, [
      multiApprovalRequestStream([
        {
          approvalId: 'approval-1',
          toolCallId: 'call-1',
          toolName: 'read_file',
          input: { filePath: 'DeepSeek_V4_介绍.md' },
        },
        {
          approvalId: 'approval-2',
          toolCallId: 'call-2',
          toolName: 'read_file',
          input: { filePath: 'DeepSeek_V4_vs_Qwen3.6_对比.md' },
        },
      ]),
      finalTextStream('两个文档已合并'),
    ]))

    const { handler } = createHandler()
    await handler.handle(inboundEvent('merge-request', '将两个文档合并然后删除旧的文件'))

    const suspended = getSuspendedState('connector:test-service:channel:channel-1')
    expect(suspended).not.toBeNull()
    expect(suspended!.pendingApprovals).toHaveLength(2)

    const result = await handler.handle(inboundEvent('approval-reply-merge', '同意'))

    expect(result.success).toBe(true)
    expect(result.response).toContain('两个文档已合并')

    const resumeMessages = streamCalls[1]
    expect(findAllAssistantParts(resumeMessages, 'tool-approval-request')).toHaveLength(2)
    expect(resumeMessages.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'approval-1',
          approved: true,
        },
        {
          type: 'tool-approval-response',
          approvalId: 'approval-2',
          approved: true,
        },
      ],
    })
  })
})

function createHandler(): { handler: AgentInboundHandler; store: DataStore } {
  const store = createStore()
  const context = {
    cwd: process.cwd(),
    runtime: { dataStore: store },
  } as unknown as AppContext

  return {
    store,
    handler: new AgentInboundHandler({
      registry: {} as ConnectorRegistry,
      context,
      modelConfig: {
        apiKey: 'test-key',
        baseURL: 'https://example.test',
        modelName: 'test-model',
      },
      modules: {
        mcps: false,
        skills: false,
        memory: false,
        connectors: false,
      },
    }),
  }
}

function createStore(): DataStore {
  const conversations = new Map<string, { id: string; title: string }>()
  const messages = new Map<string, UIMessage[]>()

  return {
    conversationStore: {
      getConversation: vi.fn((id: string) => conversations.get(id) ?? null),
      createConversation: vi.fn((id: string, title: string) => {
        conversations.set(id, { id, title })
      }),
      updateConversationTitle: vi.fn(),
    },
    messageStore: {
      getMessagesByConversation: vi.fn((id: string) => messages.get(id) ?? []),
      saveMessages: vi.fn((id: string, nextMessages: UIMessage[]) => {
        messages.set(id, nextMessages)
      }),
    },
  } as unknown as DataStore
}

function createAgentFactory(streamCalls: ModelMessage[][], streamResults: unknown[]) {
  return async () => ({
    agent: {
      stream: vi.fn(async ({ messages }: { messages: ModelMessage[] }) => {
        streamCalls.push(messages)
        const next = streamResults.shift()
        if (!next) throw new Error('No mocked stream result available')
        return next
      }),
    },
    sessionState: {
      costTracker: {
        persistToDB: vi.fn().mockResolvedValue(undefined),
      },
    },
    adjustedMessages: undefined,
    model: {},
    dispose: vi.fn().mockResolvedValue(undefined),
  })
}

function approvalRequestStream(options?: {
  approvalId?: string
  toolCallId?: string
  toolName?: string
  input?: Record<string, unknown>
}) {
  const approvalId = options?.approvalId ?? 'approval-1'
  const toolCallId = options?.toolCallId ?? 'call-1'
  const toolName = options?.toolName ?? 'write_file'
  const input = options?.input ?? { filePath: 'DeepSeek-V4介绍.md', content: '# DeepSeek V4' }

  return {
    fullStream: asyncIterable([
      {
        type: 'tool-call',
        toolCallId,
        toolName,
        input,
      },
      {
        type: 'tool-approval-request',
        approvalId,
        toolCall: {
          toolCallId,
          toolName,
          input,
        },
      },
    ]),
    finishReason: Promise.resolve('tool-calls'),
    steps: Promise.resolve([]),
    text: Promise.resolve(''),
  }
}

function multiApprovalRequestStream(requests: Array<{
  approvalId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}>) {
  const parts: unknown[] = []

  for (const request of requests) {
    parts.push({
      type: 'tool-call',
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      input: request.input,
    })
    parts.push({
      type: 'tool-approval-request',
      approvalId: request.approvalId,
      toolCall: {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        input: request.input,
      },
    })
  }

  return {
    fullStream: asyncIterable(parts),
    finishReason: Promise.resolve('tool-calls'),
    steps: Promise.resolve([]),
    text: Promise.resolve(''),
  }
}

function executedToolsWithApprovalRequestStream() {
  const editInput = {
    filePath: 'DeepSeek-V4介绍.md',
    oldString: '# DeepSeek V4',
    newString: '# DeepSeek V4\n\n已更新',
  }

  return {
    fullStream: asyncIterable([
      {
        type: 'tool-call',
        toolCallId: 'call-read',
        toolName: 'read_file',
        input: { filePath: 'DeepSeek-V4介绍.md' },
      },
      {
        type: 'tool-call',
        toolCallId: 'call-glob',
        toolName: 'glob',
        input: { pattern: '*.md' },
      },
      {
        type: 'tool-call',
        toolCallId: 'call-edit',
        toolName: 'edit_file',
        input: editInput,
      },
      {
        type: 'tool-approval-request',
        approvalId: 'approval-2',
        toolCall: {
          toolCallId: 'call-edit',
          toolName: 'edit_file',
          input: editInput,
        },
      },
    ]),
    finishReason: Promise.resolve('tool-calls'),
    steps: Promise.resolve([
      {
        toolResults: [
          {
            toolCallId: 'call-read',
            toolName: 'read_file',
            result: '原文件内容',
          },
          {
            toolCallId: 'call-glob',
            toolName: 'glob',
            result: ['DeepSeek-V4介绍.md'],
          },
        ],
      },
    ]),
    text: Promise.resolve(''),
  }
}

function finalTextStream(text: string) {
  return {
    fullStream: asyncIterable([{ type: 'text-delta', text }]),
    finishReason: Promise.resolve('stop'),
    steps: Promise.resolve([]),
    text: Promise.resolve(text),
  }
}

async function* asyncIterable(parts: unknown[]) {
  for (const part of parts) yield part
}

function inboundEvent(id: string, text: string): InboundEvent {
  return {
    id,
    connectorId: 'test-service',
    protocol: 'test-service',
    transport: 'test',
    externalEventId: id,
    channel: { id: 'channel-1' },
    sender: { id: 'user-1', type: 'user' },
    message: { id, type: 'text', text },
    replyAddress: {
      connectorId: 'test-service',
      protocol: 'test-service',
      channelId: 'channel-1',
      messageId: id,
    },
    receivedAt: Date.now(),
  }
}

function findAssistantPart(messages: ModelMessage[], type: string) {
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const part = message.content.find(item => item.type === type)
    if (part) return part
  }
  return undefined
}

function findAllAssistantParts(messages: ModelMessage[], type: string) {
  const parts: unknown[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    parts.push(...message.content.filter(item => item.type === type))
  }
  return parts
}
