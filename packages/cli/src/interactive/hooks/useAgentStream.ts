import { useReducer, useRef, useCallback, useEffect } from 'react'
import { createAgentUIStream, type UIMessage } from 'ai'
import type { AppContext, CreateAgentResult } from '@the-thing/core'
import { createAgent } from '@the-thing/core'
import type { StreamState, ApprovalRequest, ApprovalResponse, ToolCallState } from '../lib/types.js'
import { applyApprovalResponses, computeApprovalScope, formatToolInputSummary } from '../lib/approval-logic.js'

type Action =
  | { type: 'START_STREAM' }
  | { type: 'TEXT_DELTA'; text: string }
  | { type: 'REASONING_START' }
  | { type: 'REASONING_DELTA'; text: string }
  | { type: 'REASONING_END' }
  | { type: 'TOOL_START'; toolCallId: string; toolName: string }
  | { type: 'TOOL_INPUT'; toolCallId: string; input: unknown }
  | { type: 'TOOL_OUTPUT'; toolCallId: string }
  | { type: 'TOOL_ERROR'; toolCallId: string; error: string }
  | { type: 'APPROVAL_REQUEST'; request: ApprovalRequest }
  | { type: 'PAUSE_FOR_APPROVAL' }
  | { type: 'APPROVAL_RESPONSE'; response: ApprovalResponse }
  | { type: 'ALL_APPROVALS_RESOLVED' }
  | { type: 'STREAM_DONE'; cost?: StreamState['cost'] }
  | { type: 'STREAM_ERROR'; error: string }
  | { type: 'RESET' }

function createInitialState(): StreamState {
  return {
    phase: 'idle',
    text: '',
    reasoning: '',
    isReasoning: false,
    reasoningStartTime: 0,
    toolCalls: new Map(),
    approvalRequests: [],
    finishedMessages: [],
    cost: undefined,
    error: undefined,
  }
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case 'START_STREAM':
      return {
        ...createInitialState(),
        phase: 'streaming',
      }

    case 'TEXT_DELTA':
      return { ...state, text: state.text + action.text, isReasoning: false }

    case 'REASONING_START':
      return { ...state, isReasoning: true, reasoningStartTime: Date.now() }

    case 'REASONING_DELTA':
      return { ...state, reasoning: state.reasoning + action.text }

    case 'REASONING_END':
      return { ...state, isReasoning: false }

    case 'TOOL_START': {
      const toolCalls = new Map(state.toolCalls)
      toolCalls.set(action.toolCallId, {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        summary: '',
        status: 'queued',
        startTime: Date.now(),
      })
      return { ...state, toolCalls }
    }

    case 'TOOL_INPUT': {
      const toolCalls = new Map(state.toolCalls)
      const existing = toolCalls.get(action.toolCallId)
      if (existing) {
        toolCalls.set(action.toolCallId, {
          ...existing,
          summary: formatToolInputSummary(existing.toolName, action.input),
          status: 'running',
        })
      }
      return { ...state, toolCalls }
    }

    case 'TOOL_OUTPUT': {
      const toolCalls = new Map(state.toolCalls)
      const existing = toolCalls.get(action.toolCallId)
      if (existing) {
        toolCalls.set(action.toolCallId, { ...existing, status: 'success' })
      }
      return { ...state, toolCalls }
    }

    case 'TOOL_ERROR': {
      const toolCalls = new Map(state.toolCalls)
      const existing = toolCalls.get(action.toolCallId)
      if (existing) {
        toolCalls.set(action.toolCallId, {
          ...existing,
          status: 'error',
          errorText: action.error,
        })
      }
      return { ...state, toolCalls }
    }

    case 'APPROVAL_REQUEST':
      return {
        ...state,
        approvalRequests: [...state.approvalRequests, action.request],
      }

    case 'PAUSE_FOR_APPROVAL':
      return { ...state, phase: 'awaiting-approval' }

    case 'APPROVAL_RESPONSE': {
      const remaining = state.approvalRequests.filter(
        r => r.approvalId !== action.response.approvalId
      )
      return { ...state, approvalRequests: remaining }
    }

    case 'ALL_APPROVALS_RESOLVED':
      return { ...state, phase: 'streaming', approvalRequests: [] }

    case 'STREAM_DONE':
      return { ...state, phase: 'done', cost: action.cost }

    case 'STREAM_ERROR':
      return { ...state, phase: 'error', error: action.error }

    case 'RESET':
      return createInitialState()

    default:
      return state
  }
}

export interface UseAgentStreamOptions {
  context: AppContext
  conversationId: string
  modelConfig: {
    apiKey: string
    baseURL: string
    modelName: string
    enableThinking?: boolean
  }
}

export interface UseAgentStreamResult {
  state: StreamState
  startStream: (messages: UIMessage[]) => void
  respondApproval: (response: ApprovalResponse) => void
  abort: () => void
  reset: () => void
  finishedMessages: UIMessage[]
  sessionState: CreateAgentResult['sessionState'] | null
}

export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { context, conversationId, modelConfig } = options
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)

  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<UIMessage[]>([])
  const finishedMessagesRef = useRef<UIMessage[]>([])
  const agentResultRef = useRef<CreateAgentResult | null>(null)
  const sessionApprovedScopes = useRef(new Set<string>())
  const approvalResponsesRef = useRef<ApprovalResponse[]>([])
  const streamGenRef = useRef(0)
  const sessionStateRef = useRef<CreateAgentResult['sessionState'] | null>(null)

  const runStream = useCallback(async (currentMessages: UIMessage[], gen: number) => {
    try {
      const agentResult = await createAgent({
        context,
        conversationId,
        messages: currentMessages,
        model: {
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.baseURL,
          modelName: modelConfig.modelName,
          enableThinking: modelConfig.enableThinking,
        },
      })

      agentResultRef.current = agentResult
      sessionStateRef.current = agentResult.sessionState

      const abort = new AbortController()
      abortRef.current = abort

      let finishedMessages: UIMessage[] = []
      const approvalRequests: ApprovalRequest[] = []

      const stream = await createAgentUIStream({
        agent: agentResult.agent,
        uiMessages: currentMessages,
        abortSignal: abort.signal,
        sendReasoning: true,
        onFinish: ({ messages }) => {
          finishedMessages = messages
        },
      })

      for await (const chunk of stream) {
        if (gen !== streamGenRef.current) return

        switch (chunk.type) {
          case 'text-delta':
            dispatch({ type: 'TEXT_DELTA', text: chunk.delta })
            break
          case 'reasoning-start':
            dispatch({ type: 'REASONING_START' })
            break
          case 'reasoning-delta':
            dispatch({ type: 'REASONING_DELTA', text: (chunk as any).textDelta || '' })
            break
          case 'tool-input-start':
            dispatch({
              type: 'TOOL_START',
              toolCallId: (chunk as any).toolCallId,
              toolName: (chunk as any).toolName,
            })
            break
          case 'tool-input-available':
            dispatch({
              type: 'TOOL_INPUT',
              toolCallId: (chunk as any).toolCallId,
              input: (chunk as any).input,
            })
            break
          case 'tool-approval-request': {
            const req: ApprovalRequest = {
              approvalId: (chunk as any).approvalId,
              toolCallId: (chunk as any).toolCallId,
              toolName: (chunk as any).toolName,
              input: (chunk as any).input,
            }
            const scope = computeApprovalScope(req.toolName, req.input)
            if (sessionApprovedScopes.current.has(scope)) {
              approvalResponsesRef.current.push({
                approvalId: req.approvalId,
                approved: true,
              })
            } else {
              approvalRequests.push(req)
              dispatch({ type: 'APPROVAL_REQUEST', request: req })
            }
            break
          }
          case 'tool-output-available':
            dispatch({ type: 'TOOL_OUTPUT', toolCallId: (chunk as any).toolCallId })
            break
          case 'tool-output-error':
            dispatch({
              type: 'TOOL_ERROR',
              toolCallId: (chunk as any).toolCallId,
              error: (chunk as any).error || 'unknown error',
            })
            break
        }
      }

      finishedMessagesRef.current = finishedMessages

      if (approvalRequests.length > 0) {
        dispatch({ type: 'PAUSE_FOR_APPROVAL' })
      } else if (approvalResponsesRef.current.length > 0) {
        const patched = applyApprovalResponses(finishedMessages, approvalResponsesRef.current)
        approvalResponsesRef.current = []
        messagesRef.current = patched
        streamGenRef.current++
        dispatch({ type: 'ALL_APPROVALS_RESOLVED' })
        runStream(patched, streamGenRef.current)
      } else {
        const cost = agentResult.sessionState?.costTracker?.getSummary?.()
        dispatch({
          type: 'STREAM_DONE',
          cost: cost ? {
            totalCostUsd: cost.totalCostUsd || 0,
            inputTokens: cost.inputTokens || 0,
            outputTokens: cost.outputTokens || 0,
          } : undefined,
        })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      dispatch({ type: 'STREAM_ERROR', error: err?.message || 'Unknown error' })
    }
  }, [context, conversationId, modelConfig])

  const startStream = useCallback((messages: UIMessage[]) => {
    messagesRef.current = messages
    approvalResponsesRef.current = []
    streamGenRef.current++
    dispatch({ type: 'START_STREAM' })
    runStream(messages, streamGenRef.current)
  }, [runStream])

  const respondApproval = useCallback((response: ApprovalResponse) => {
    dispatch({ type: 'APPROVAL_RESPONSE', response })
    approvalResponsesRef.current.push(response)

    const remaining = state.approvalRequests.filter(
      r => r.approvalId !== response.approvalId
    )

    if (remaining.length === 0) {
      const patched = applyApprovalResponses(
        finishedMessagesRef.current,
        approvalResponsesRef.current,
      )
      approvalResponsesRef.current = []
      messagesRef.current = patched
      streamGenRef.current++
      dispatch({ type: 'ALL_APPROVALS_RESOLVED' })
      runStream(patched, streamGenRef.current)
    }
  }, [state.approvalRequests, runStream])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'RESET' })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return {
    state,
    startStream,
    respondApproval,
    abort,
    reset,
    finishedMessages: finishedMessagesRef.current,
    sessionState: sessionStateRef.current,
  }
}
