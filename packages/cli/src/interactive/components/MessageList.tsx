import React from 'react'
import { Static, Text, Box } from 'ink'
import type { CompletedMessage } from '../lib/types.js'
import { renderMarkdown } from '../lib/markdown.js'
import { ToolCallLine } from './ToolCallLine.js'

interface Props {
  items: CompletedMessage[]
}

function AssistantParts({ item }: { item: CompletedMessage }) {
  const toolCallMap = new Map(
    (item.toolCalls || []).map(tc => [tc.toolCallId, tc])
  )

  if (item.parts && item.parts.length > 0) {
    return (
      <>
        {item.parts.map((part, i) => {
          if (part.type === 'text') {
            return part.text ? <Text key={`text-${i}`}>{renderMarkdown(part.text)}</Text> : null
          }
          if (part.type === 'tool-call') {
            const tc = toolCallMap.get(part.toolCallId)
            return tc ? <ToolCallLine key={part.toolCallId} tool={tc} /> : null
          }
          if (part.type === 'step-boundary') {
            return <Text key={`step-${i}`} dimColor>{' '}</Text>
          }
          return null
        })}
      </>
    )
  }

  return (
    <>
      <Text>{renderMarkdown(item.text)}</Text>
      {item.toolCalls && item.toolCalls.length > 0 && (
        <Box flexDirection="column">
          {item.toolCalls.map(tc => (
            <ToolCallLine key={tc.toolCallId} tool={tc} />
          ))}
        </Box>
      )}
    </>
  )
}

export function MessageList({ items }: Props) {
  return (
    <Static items={items}>
      {(item) => (
        <Box key={item.id} flexDirection="column" marginBottom={1}>
          {item.role === 'user' ? (
            <Box>
              <Text color="cyan" bold>You: </Text>
              <Text>{item.text}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text color="green" bold>Assistant:</Text>
              <AssistantParts item={item} />
              {item.cost && (
                <Text dimColor>
                  Cost: ${item.cost.totalCostUsd.toFixed(6)} | Input: {item.cost.inputTokens} | Output: {item.cost.outputTokens}
                </Text>
              )}
            </Box>
          )}
          <Text dimColor>{'─'.repeat(Math.min(process.stdout.columns || 80, 60))}</Text>
        </Box>
      )}
    </Static>
  )
}
