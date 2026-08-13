import React from 'react'
import { Box, Text } from 'ink'
import { MarkdownText } from './MarkdownText.js'
import { ToolCallLine } from './ToolCallLine.js'
import { ToolCallsSummaryLine } from './ToolCallsSummaryLine.js'
import { ReasoningBlock } from './ReasoningBlock.js'
import { CostSummary } from './CostSummary.js'
import { ApprovalPrompt } from './ApprovalPrompt.js'
import { TOOL_FOLD_THRESHOLD, type StreamState, type ApprovalResponse } from '../lib/types.js'
interface Props {
  state: StreamState
  onApprovalResponse: (response: ApprovalResponse) => void
  sessionApprovedScopes: Set<string>
  toolCallsExpanded: boolean
  onToggleToolCalls: () => void
}

export function StreamingResponse({ state, onApprovalResponse, sessionApprovedScopes, toolCallsExpanded, onToggleToolCalls }: Props) {
  const elapsed = state.reasoningStartTime
    ? (Date.now() - state.reasoningStartTime) / 1000
    : 0

  const folded = state.toolCalls.size >= TOOL_FOLD_THRESHOLD && !toolCallsExpanded
  const firstToolPartIndex = folded ? state.parts.findIndex(p => p.type === 'tool-call') : -1
  const runningTool = folded
    ? [...state.toolCalls.values()].find(tc => tc.status === 'running' || tc.status === 'queued')
    : undefined
  const errorCount = folded
    ? [...state.toolCalls.values()].filter(tc => tc.status === 'error').length
    : 0

  return (
    <Box flexDirection="column">
      {(state.isReasoning || state.reasoning) && (
        <ReasoningBlock
          text={state.reasoning}
          isActive={state.isReasoning}
          elapsed={elapsed}
        />
      )}

      {state.parts.map((part, i) => {
        if (part.type === 'text') {
          return part.text ? (
            <MarkdownText key={`text-${i}`} text={part.text} streaming={state.phase === 'streaming'} />
          ) : null
        }
        if (part.type === 'tool-call') {
          if (folded) {
            if (i !== firstToolPartIndex) return null
            return (
              <ToolCallsSummaryLine
                key="tool-summary"
                count={state.toolCalls.size}
                errorCount={errorCount}
                isStreaming
                runningSummary={runningTool?.summary}
                expanded={toolCallsExpanded}
                onToggle={onToggleToolCalls}
              />
            )
          }
          const tc = state.toolCalls.get(part.toolCallId)
          return tc ? <ToolCallLine key={part.toolCallId} tool={tc} /> : null
        }
        if (part.type === 'step-boundary') {
          return <Text key={`step-${i}`} dimColor>{' '}</Text>
        }
        return null
      })}

      {state.phase === 'awaiting-approval' && state.approvalRequests.length > 0 && (
        <ApprovalPrompt
          request={state.approvalRequests[0]}
          onRespond={onApprovalResponse}
          sessionApprovedScopes={sessionApprovedScopes}
        />
      )}

      {state.phase === 'done' && state.cost && (
        <CostSummary
          totalCostUsd={state.cost.totalCostUsd}
          inputTokens={state.cost.inputTokens}
          outputTokens={state.cost.outputTokens}
        />
      )}

      {state.phase === 'error' && state.error && (
        <Box marginTop={1}>
          <MarkdownText text={`**Error:** ${state.error}`} />
        </Box>
      )}
    </Box>
  )
}
