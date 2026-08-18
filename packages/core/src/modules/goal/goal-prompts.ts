// ============================================================
// Goal Prompts - 目标驱动的 Prompt 注入模板
// ============================================================
// 三种模板对应三种场景：
// 1. Continuation - 自动继续时注入
// 2. Budget Limit - token 超预算时注入
// 3. Objective Updated - 目标变更时注入

import type { GoalState } from './types'
import { formatGoalElapsed, getActiveElapsedMs } from './goal-state'

/**
 * 格式化 token 使用信息
 */
function formatTokenUsage(goal: GoalState): string {
  if (goal.tokenBudget !== null) {
    const remaining = Math.max(0, goal.tokenBudget - goal.tokensUsed)
    return `Tokens used: ${goal.tokensUsed} / ${goal.tokenBudget} (${remaining} remaining)`
  }
  return `Tokens used: ${goal.tokensUsed}`
}

/**
 * Continuation prompt - 核心自动继续指令
 *
 * 在 prepareStep 中注入，驱动 agent 持续执行
 */
export function buildContinuationPrompt(goal: GoalState): string {
  const elapsed = formatGoalElapsed(goal)
  const tokenInfo = formatTokenUsage(goal)
  const turnInfo = `Continuation turns executed: ${goal.turnsExecuted}`

  return `<goal-steering type="continuation">
You have an active goal to work on. Continue making progress.

## Active Goal
${goal.objective}

## Status
- Elapsed active time: ${elapsed}
- ${tokenInfo}
- ${turnInfo}

## Instructions

Continue working towards the goal. Do NOT narrow the scope of the goal — even if you cannot complete everything in one turn, maintain the full objective and make as much progress as possible.

**When a goal is active:** You have a clear objective. You may consider making autonomous decisions based on the goal context rather than stopping — when you encounter ambiguity, decide on the most reasonable path forward. Whether to ask the user or proceed autonomously is your judgment call; there is no blanket prohibition on asking when the goal context genuinely requires user input. (B6)

When you believe the goal is fully achieved, use the GoalTool to mark it complete. Before doing so, perform a strict Completion Audit:

### Completion Audit
1. Derive concrete requirements from the objective and any referenced files.
2. Preserve the original scope — do not redefine success around what is already done.
3. For every explicit requirement, identify authoritative evidence (test output, file content, command result).
4. Treat tests, manifests, and verifiers as evidence only after confirming they actually cover the requirement.
5. Treat uncertain or indirect evidence as "not achieved".
6. The audit must PROVE completion, not merely fail to find remaining work.

### Blocked Audit
Blocking is your judgment call, not a count-based rule — the system only records how many times each blocker was reported as objective context. You can consider marking blocked only after the same condition genuinely persists across attempts, but when something is truly stuck is for you to decide:
- "Difficult", "slow", or "partially incomplete" is NOT blocked.
- If you judge the goal stuck, use the GoalTool with status "blocked" and a clear reason.

Resume working now.
</goal-steering>`
}

/**
 * Budget limit prompt - token 超预算时注入
 */
export function buildBudgetLimitPrompt(goal: GoalState): string {
  return `<goal-steering type="budget_limit">
## Token Budget Reached

Your token budget for this goal has been exhausted.

- Goal: ${goal.objective}
- Tokens used: ${goal.tokensUsed}${goal.tokenBudget !== null ? ` / ${goal.tokenBudget}` : ''}
- Active time: ${formatGoalElapsed(goal)}

**Stop all substantive work immediately.** Do NOT start new file edits, tool calls, or explorations.

Instead, provide a brief summary:
1. What has been accomplished so far.
2. What remains to be done.
3. Any blockers or issues encountered.

Then use the GoalTool to mark the goal as complete (if truly done) or leave it in its current state for the user to decide.
</goal-steering>`
}

/**
 * Objective updated prompt - 目标变更时注入
 */
export function buildObjectiveUpdatedPrompt(
  newObjective: string,
  previousObjective?: string,
): string {
  const previousSection = previousObjective
    ? `\nPrevious objective: ${previousObjective}\n`
    : ''

  return `<goal-steering type="objective_updated">
The user has updated the active goal.${previousSection}
New objective: ${newObjective}

Acknowledge the updated objective and begin working towards it. All previous progress that is still relevant should be preserved, but the new objective takes priority.

Follow the same Completion Audit and Blocked Audit rules described in prior goal-steering messages.
</goal-steering>`
}

/**
 * Goal context block - 紧凑的 XML 片段，用于系统提示注入
 */
export function buildGoalContextBlock(goal: GoalState): string {
  const elapsed = formatGoalElapsed(goal)
  const elapsedMs = getActiveElapsedMs(goal)
  const budget =
    goal.tokenBudget !== null ? ` budget="${goal.tokenBudget}"` : ''

  return [
    `<active-goal status="${goal.status}" elapsed="${elapsed}" elapsed_ms="${elapsedMs}" tokens="${goal.tokensUsed}"${budget} turns="${goal.turnsExecuted}">`,
    goal.objective,
    '</active-goal>',
  ].join('\n')
}

/**
 * Max turns prompt - 达到最大轮次时注入
 */
export function buildMaxTurnsPrompt(goal: GoalState): string {
  return `<goal-steering type="max_turns">
## Maximum Continuation Turns Reached

You have reached the maximum number of continuation turns (${goal.turnsExecuted}).

- Goal: ${goal.objective}
- Elapsed time: ${formatGoalElapsed(goal)}

**Stop working and provide a progress summary:**
1. What has been accomplished so far.
2. What remains to be done.
3. Any blockers or issues encountered.

The user can run \`/goal continue\` to reset the turn counter and continue.
</goal-steering>`
}
