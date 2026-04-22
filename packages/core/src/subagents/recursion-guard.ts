/**
 * 递归防护配置
 */
export const RECURSION_GUARD_CONFIG = {
  /** 最大递归深度 */
  maxDepth: 3,
  /** 每会话最大 Agent 调用次数 */
  maxAgentCallsPerSession: 10,
};

/**
 * 递归追踪器
 *
 * 用于追踪 Agent 调用的递归深度和总次数。
 */
export class RecursionTracker {
  private depthMap = new Map<string, number>();
  private totalCalls = 0;

  /**
   * 进入 Agent 调用
   */
  enter(agentId: string): number {
    this.totalCalls++;
    const current = this.depthMap.get(agentId) ?? 0;
    const newDepth = current + 1;
    this.depthMap.set(agentId, newDepth);
    return newDepth;
  }

  /**
   * 退出 Agent 调用
   */
  exit(agentId: string): void {
    const current = this.depthMap.get(agentId) ?? 1;
    this.depthMap.set(agentId, Math.max(0, current - 1));
  }

  /**
   * 获取当前深度
   */
  getDepth(agentId: string): number {
    return this.depthMap.get(agentId) ?? 0;
  }

  /**
   * 获取总调用次数
   */
  getTotalCalls(): number {
    return this.totalCalls;
  }

  /**
   * 重置追踪器
   */
  reset(): void {
    this.depthMap.clear();
    this.totalCalls = 0;
  }
}

/**
 * 检查是否触发递归防护
 *
 * @param context 包含 recursionDepth 的上下文
 * @returns true 表示应阻止继续调用
 */
export function checkRecursionGuard(context: { recursionDepth: number }): boolean {
  if (context.recursionDepth >= RECURSION_GUARD_CONFIG.maxDepth) {
    console.warn(
      `[RecursionGuard] Depth ${context.recursionDepth} exceeds max ${RECURSION_GUARD_CONFIG.maxDepth}`
    );
    return true;
  }
  return false;
}