// ============================================================
// Approval Handler - 审批消息构建
// ============================================================

/**
 * 构建审批询问消息
 * 纯文本格式，向用户展示待审批的工具及关键参数
 */
export function buildApprovalAskMessage(
  toolName: string,
  input: Record<string, unknown>
): string {
  const lines = ['需要您的审批确认：\n']

  lines.push(`**${toolName}**`)

  if (toolName === 'bash' && input.command) {
    lines.push(`命令: \`${input.command}\``)
  } else if (toolName === 'write_file' && input.filePath) {
    lines.push(`文件: \`${input.filePath}\``)
  } else if (toolName === 'edit_file' && input.filePath) {
    lines.push(`文件: \`${input.filePath}\``)
  } else if (toolName === 'read_file' && input.filePath) {
    lines.push(`文件: \`${input.filePath}\``)
  }

  lines.push('\n请回复 "同意" 或 "拒绝"')
  lines.push('_审批有效期 5 分钟，超时将自动拒绝_')

  return lines.join('\n')
}

/**
 * 解析用户回复，判断是否为审批响应
 * 注意：调用方应先通过 hasPendingApproval() 确认存在待审批项，
 * 再调用此函数，否则普通消息会被误判为审批响应
 */
export function parseApprovalResponse(text: string): {
  isApprovalResponse: boolean
  approved?: boolean
} {
  const lowerText = text.toLowerCase().trim()

  const approveKeywords = ['同意', '允许', '批准', '确认', 'ok', 'yes', '好', '行', '可以', '是的', '没问题']
  const denyKeywords = ['拒绝', '不同意', '禁止', '取消', 'no', '不行', '不要', 'deny']

  for (const keyword of approveKeywords) {
    if (lowerText.includes(keyword)) {
      return { isApprovalResponse: true, approved: true }
    }
  }

  for (const keyword of denyKeywords) {
    if (lowerText.includes(keyword)) {
      return { isApprovalResponse: true, approved: false }
    }
  }

  return { isApprovalResponse: false }
}
