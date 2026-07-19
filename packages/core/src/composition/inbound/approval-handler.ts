// ============================================================
// Approval Handler - 审批消息构建
// ============================================================

/**
 * 构建审批询问消息
 * 纯文本格式，向用户展示待审批的工具及关键参数
 */
export interface ApprovalMessageRequest {
  toolName: string
  input: Record<string, unknown>
}

function describeApprovalTarget(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'bash' && input.command) {
    return `命令: \`${input.command}\``
  }
  if (toolName === 'write_file' && input.filePath) {
    return `文件: \`${input.filePath}\``
  }
  if (toolName === 'edit_file' && input.filePath) {
    return `文件: \`${input.filePath}\``
  }
  if (toolName === 'read_file' && input.filePath) {
    return `文件: \`${input.filePath}\``
  }
  // 其他工具（connector/MCP 等）：展示截断后的入参 JSON
  const keys = Object.keys(input)
  if (keys.length > 0) {
    let json: string
    try {
      json = JSON.stringify(input)
    } catch {
      return null
    }
    if (json.length > 200) json = json.slice(0, 200) + '…'
    return `参数: \`${json}\``
  }
  return null
}

export function buildApprovalAskMessage(
  toolName: string,
  input: Record<string, unknown>
): string {
  return buildApprovalAskMessageForRequests([{ toolName, input }])
}

export function buildApprovalAskMessageForRequests(
  requests: ApprovalMessageRequest[]
): string {
  const lines = ['需要您的审批确认：', '']

  requests.forEach((request, index) => {
    if (requests.length > 1) {
      lines.push(`${index + 1}. **${request.toolName}**`)
    } else {
      lines.push(`**${request.toolName}**`)
    }

    const detail = describeApprovalTarget(request.toolName, request.input)
    if (detail) {
      lines.push(detail)
    }

    if (index < requests.length - 1) {
      lines.push('')
    }
  })

  lines.push('')
  lines.push('请回复 "同意" 或 "拒绝"')
  lines.push('_审批有效期 30 分钟，超时将自动取消并通知您_')

  return lines.join('\n')
}
