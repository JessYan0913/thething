import chalk from 'chalk'
import type { UIMessage } from 'ai'
import type { ApprovalRequest, ApprovalResponse, SelectOption } from './types.js'

export function computeApprovalScope(toolName: string, input: unknown): string {
  if (toolName === 'bash') {
    const command = String((input as Record<string, unknown>)?.command || '').trim()
    const prefix = command.split(' ')[0]
    return prefix ? `bash:${prefix}` : 'bash'
  }
  return toolName
}

export function buildApprovalQuestion(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return `Do you want to run ${toolName}?`

  switch (toolName) {
    case 'bash': {
      const cmd = String(inp.command || '').trim()
      const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
      return `Do you want to execute ${chalk.cyan(`\`${short}\``)}?`
    }
    case 'write_file':
      return `Do you want to create ${chalk.cyan(String(inp.file_path))}?`
    case 'edit_file':
      return `Do you want to edit ${chalk.cyan(String(inp.file_path))}?`
    case 'read_file':
      return `Do you want to read ${chalk.cyan(String(inp.file_path))}?`
    case 'grep':
      return `Do you want to search for ${chalk.cyan(`/${inp.pattern}/`)}?`
    case 'glob':
      return `Do you want to search files matching ${chalk.cyan(String(inp.pattern))}?`
    case 'agent':
      return `Do you want to spawn a sub-agent?`
    default:
      return `Do you want to run ${chalk.cyan(toolName)}?`
  }
}

export function buildApprovalOptions(toolName: string, input: unknown): SelectOption<'allow' | 'always' | 'deny'>[] {
  const scope = computeApprovalScope(toolName, input)

  let alwaysLabel: string
  switch (toolName) {
    case 'bash': {
      const prefix = scope.split(':')[1] || 'these'
      alwaysLabel = `Yes, allow all ${prefix} commands this session`
      break
    }
    case 'edit_file':
      alwaysLabel = 'Yes, allow all edits this session'
      break
    case 'write_file':
      alwaysLabel = 'Yes, allow all file writes this session'
      break
    case 'read_file':
      alwaysLabel = 'Yes, allow all reads this session'
      break
    default:
      alwaysLabel = `Yes, allow all ${toolName} this session`
      break
  }

  return [
    { label: 'Yes', value: 'allow' },
    { label: alwaysLabel, value: 'always' },
    { label: 'No', value: 'deny' },
  ]
}

export function applyApprovalResponses(
  messages: UIMessage[],
  responses: ApprovalResponse[],
): UIMessage[] {
  const responseMap = new Map(responses.map(r => [r.approvalId, r]))
  return messages.map(msg => {
    if (msg.role !== 'assistant') return msg
    const newParts = msg.parts.map((part: any) => {
      if (
        part.state === 'approval-requested' &&
        part.approval?.id &&
        responseMap.has(part.approval.id)
      ) {
        const resp = responseMap.get(part.approval.id)!
        return {
          ...part,
          state: 'approval-responded',
          approval: {
            id: resp.approvalId,
            approved: resp.approved,
            ...(resp.reason ? { reason: resp.reason } : {}),
          },
        }
      }
      return part
    })
    return { ...msg, parts: newParts }
  })
}

export function formatToolInputSummary(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined
  if (!inp) return toolName

  switch (toolName) {
    case 'bash': {
      const cmd = String(inp.command || '').trim()
      return cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd
    }
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(inp.file_path || '')
    case 'grep':
      return `/${inp.pattern || ''}/ ${inp.path || ''}`
    case 'glob':
      return String(inp.pattern || '')
    case 'agent':
      return String(inp.description || inp.prompt || '').slice(0, 80)
    case 'web_search':
      return String(inp.query || '').slice(0, 80)
    default:
      return ''
  }
}
