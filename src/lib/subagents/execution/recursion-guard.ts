export const RECURSION_GUARD_CONFIG = {
  maxDepth: 3,
  maxAgentCallsPerSession: 10,
};

export class RecursionTracker {
  private depthMap = new Map<string, number>();
  private totalCalls = 0;

  enter(agentId: string): number {
    this.totalCalls++;
    const current = this.depthMap.get(agentId) ?? 0;
    const newDepth = current + 1;
    this.depthMap.set(agentId, newDepth);
    return newDepth;
  }

  exit(agentId: string): void {
    const current = this.depthMap.get(agentId) ?? 1;
    this.depthMap.set(agentId, Math.max(0, current - 1));
  }

  getDepth(agentId: string): number {
    return this.depthMap.get(agentId) ?? 0;
  }

  getTotalCalls(): number {
    return this.totalCalls;
  }

  reset(): void {
    this.depthMap.clear();
    this.totalCalls = 0;
  }
}

export function checkRecursionGuard(context: { recursionDepth: number }): boolean {
  if (context.recursionDepth >= RECURSION_GUARD_CONFIG.maxDepth) {
    console.warn(
      `[RecursionGuard] Depth ${context.recursionDepth} exceeds max ${RECURSION_GUARD_CONFIG.maxDepth}`
    );
    return true;
  }
  return false;
}
