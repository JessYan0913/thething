import React from 'react'
import { Box, Text } from 'ink'
import Spinner from './Spinner.js'

interface Props {
  count: number
  errorCount: number
  isStreaming?: boolean
  runningSummary?: string
  expanded?: boolean
  onToggle?: () => void
}

/** 工具调用折叠摘要行：流式中显示运行计数+当前工具，结束后显示工具数；失败标红 */
export function ToolCallsSummaryLine({
  count,
  errorCount,
  isStreaming,
  runningSummary,
  expanded,
  onToggle,
}: Props) {
  return (
    <Box>
      <Text dimColor>  </Text>
      {isStreaming ? <Spinner type="dots" /> : <Text color="green">✓</Text>}
      <Text> </Text>
      <Text dimColor>
        {isStreaming
          ? `${count} tool call${count === 1 ? '' : 's'} running${runningSummary ? ` · ${runningSummary}` : ''}`
          : `${count} tool call${count === 1 ? '' : 's'}`}
      </Text>
      {errorCount > 0 && <Text color="red"> ({errorCount} failed)</Text>}
      {onToggle && (
        <Text dimColor>  [{expanded ? 'Ctrl+E to collapse' : 'Ctrl+E to expand'}]</Text>
      )}
    </Box>
  )
}
