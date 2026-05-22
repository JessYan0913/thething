import React from 'react'
import { Box } from 'ink'
import { MarkdownText } from './MarkdownText.js'
import { ToolCallLine } from './ToolCallLine.js'
import { ReasoningBlock } from './ReasoningBlock.js'
import { CostSummary } from './CostSummary.js'
import { ApprovalPrompt } from './ApprovalPrompt.js'
import type { StreamState, ApprovalResponse } from '../lib/types.js'

interface Props {
  state: StreamState
  onApprovalResponse: (response: ApprovalResponse) => void
  sessionApprovedScopes: Set<string>
}

export function StreamingResponse({ state, onApprovalResponse, sessionApprovedScopes }: Props) {
  const toolCallList = [...state.toolCalls.values()]
  const elapsed = state.reasoningStartTime
    ? (Date.now() - state.reasoningStartTime) / 1000
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

      {state.text && (
        <MarkdownText text={state.text} streaming={state.phase === 'streaming'} />
      )}

      {toolCallList.length > 0 && (
        <Box flexDirection="column" marginTop={state.text ? 1 : 0}>
          {toolCallList.map(tc => (
            <ToolCallLine key={tc.toolCallId} tool={tc} />
          ))}
        </Box>
      )}

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
