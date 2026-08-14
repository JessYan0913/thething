import React from 'react'
import { Box, Text } from 'ink'
import { MarkdownText } from './MarkdownText.js'
import { ToolCallLine } from './ToolCallLine.js'
import { ToolCallsSummaryLine } from './ToolCallsSummaryLine.js'
import { ReasoningBlock } from './ReasoningBlock.js'
import { CostSummary } from './CostSummary.js'
import { ApprovalPrompt } from './ApprovalPrompt.js'
import { TOOL_FOLD_THRESHOLD, type StreamState, type ApprovalResponse } from '../lib/types.js'
import { computeToolClusters } from '../lib/tool-clusters.js'
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

  const { clusters, clusterOfIndex } = computeToolClusters(state.parts, id => state.toolCalls.get(id))
  const expanded = toolCallsExpanded

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
          const ci = clusterOfIndex.get(i)
          const cluster = ci !== undefined ? clusters[ci] : undefined
          const collapsible = !!cluster && cluster.count >= TOOL_FOLD_THRESHOLD
          if (collapsible && !expanded) {
            if (i !== cluster!.firstIndex) return null
            const runningTool = cluster!.toolCallIds
              .map(id => state.toolCalls.get(id))
              .find(tc => tc && (tc.status === 'running' || tc.status === 'queued'))
            return (
              <ToolCallsSummaryLine
                key={`tool-summary-${i}`}
                count={cluster!.count}
                errorCount={cluster!.errorCount}
                isStreaming
                runningSummary={runningTool?.summary}
                expanded={expanded}
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
