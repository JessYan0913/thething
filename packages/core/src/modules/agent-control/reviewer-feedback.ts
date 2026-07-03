/**
 * Reviewer Feedback Store — 模块级状态，用于将 reviewer 的拒绝原因
 * 从 toolApproval 层传递到工具执行层，避免循环依赖。
 *
 * 设计：catchAllApproval 中 reviewer 返回 DENIED 时，
 * setReviewerDenial() 将原因写入此处；catchAllApproval 返回 'approved'
 * 让工具正常执行；工具执行时 consumeReviewerDenial() 消费并返回详细错误。
 * 这样 agent 能看到具体拒绝原因，而不是 SDK 的通用 "Tool call denied"。
 */

interface DenialRecord {
  toolName: string;
  inputKey: string;
  reason: string;
  timestamp: number;
}

let _denial: DenialRecord | null = null;

/**
 * 从工具输入中提取用于匹配的 key
 */
export function extractInputKey(input: unknown, toolName: string): string {
  if (typeof input !== 'object' || input === null) return String(input ?? '');
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case 'bash':
      return String(obj.command ?? '');
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(obj.filePath ?? '');
    default:
      return JSON.stringify(obj);
  }
}

/**
 * 存储 reviewer 拒绝原因
 */
export function setReviewerDenial(toolName: string, inputKey: string, reason: string): void {
  _denial = { toolName, inputKey, reason, timestamp: Date.now() };
}

/**
 * 检查是否有待消费的拒绝记录
 */
export function hasReviewerDenial(): boolean {
  return _denial !== null;
}

/**
 * 消费并返回匹配的拒绝原因（清除记录）。
 * 只在工具名称和 input 都匹配时返回原因。
 */
export function consumeReviewerDenial(toolName: string, inputKey: string): string | null {
  if (!_denial) return null;
  if (_denial.toolName !== toolName || _denial.inputKey !== inputKey) return null;
  if (Date.now() - _denial.timestamp > 5000) {
    _denial = null;
    return null;
  }
  const reason = _denial.reason;
  _denial = null;
  return reason;
}
