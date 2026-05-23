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
  web_search: 'S',
}

function formatOutputPreview(output: unknown, maxLines = 5): string | null {
  if (output == null) return null
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  if (!text) return null
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`
}

function formatInputDetail(toolName: string, input: unknown): string | null {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return null

  switch (toolName) {
    case 'bash': {
      const cmd = String(inp.command || '').trim()
      return cmd || null
    }
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(inp.file_path || '')
    case 'grep':
      return `pattern: ${inp.pattern || ''} path: ${inp.path || '.'}`
    case 'glob':
      return `pattern: ${inp.pattern || ''}`
    case 'agent':
      return String(inp.description || inp.prompt || '').slice(0, 120) || null
    case 'web_search':
      return String(inp.query || '')
    default:
      return null
  }
}

interface Props {
  tool: ToolCallState
  detailed?: boolean
}

export function ToolCallLine({ tool, detailed }: Props) {
  const icon = TOOL_ICONS[tool.toolName] || '>'
  const elapsed = (((tool.endTime || Date.now()) - tool.startTime) / 1000).toFixed(1)
  const isFinished = tool.status === 'success' || tool.status === 'error'
  const showDetail = detailed && isFinished

  const inputDetail = showDetail ? formatInputDetail(tool.toolName, tool.input) : null
  const outputPreview = showDetail ? formatOutputPreview(tool.output) : null

  return (
    <Box flexDirection="column">
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
      {inputDetail && tool.toolName === 'bash' && (
        <Box marginLeft={4}>
          <Text dimColor>{'$ '}{inputDetail}</Text>
        </Box>
      )}
      {outputPreview && (
        <Box marginLeft={4} flexDirection="column">
          {outputPreview.split('\n').map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      )}
      {showDetail && tool.status === 'error' && tool.errorText && (
        <Box marginLeft={4}>
          <Text color="red">{tool.errorText}</Text>
        </Box>
      )}
    </Box>
  )
}
