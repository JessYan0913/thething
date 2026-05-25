import React from 'react'
import { Text, Box } from 'ink'
import Spinner from './Spinner.js'
import type { ToolCallState } from '../lib/types.js'

const TOOL_ICONS: Record<string, string> = {
  bash: '$',
  read_file: 'R',
  write_file: 'W',
  edit_file: 'E',
  grep: '?',
  glob: '?',
  agent: 'A',
  web_fetch: 'S',
}

interface Props {
  tool: ToolCallState
}

export function ToolCallLine({ tool }: Props) {
  const icon = TOOL_ICONS[tool.toolName] || '>'
  const elapsed = (((tool.endTime || Date.now()) - tool.startTime) / 1000).toFixed(1)

  return (
    <Box>
      <Text dimColor>  {icon} </Text>
      <Text bold>{tool.toolName}</Text>
      {tool.summary && <Text dimColor>: {tool.summary}</Text>}
      <Text> </Text>
      {tool.status === 'queued' && <Text dimColor>queued</Text>}
      {tool.status === 'running' && (
        <>
          <Spinner type="dots" />
          <Text color="cyan"> {elapsed}s</Text>
        </>
      )}
      {tool.status === 'success' && <Text color="green">✓ {elapsed}s</Text>}
      {tool.status === 'error' && (
        <Text color="red">✗ {tool.errorText || 'failed'}</Text>
      )}
    </Box>
  )
}
