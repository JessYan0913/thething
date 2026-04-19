import type { ModelMessage as ModelMessageType, PrepareStepFunction, PrepareStepResult, ToolSet, UIMessage } from 'ai';
import type { SessionState } from '../session-state/state';
import { activateConditionalSkills, formatConditionalSkillActivation } from '../skills/conditional-activation';

function debugLog(...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.log(...args);
  }
}

export interface AgentPipelineConfig {
  sessionState: SessionState;
  maxSteps?: number;
  maxBudgetUsd?: number;
}

export function createAgentPipeline<TOOLS extends ToolSet>(config: AgentPipelineConfig): PrepareStepFunction<TOOLS> {
  const { sessionState } = config;

  const prepareStep: PrepareStepFunction<TOOLS> = async ({ stepNumber, messages, steps }) => {
    if (sessionState.aborted) {
      return { messages, tools: [] as any, continue: false } as PrepareStepResult<TOOLS>;
    }

    sessionState.turnCount = stepNumber + 1;

    const lastStep = steps[steps.length - 1];
    if (lastStep?.usage) {
      sessionState.tokenBudget.accumulate(lastStep.usage);
    }

    const budgetSummary = sessionState.tokenBudget.getSummary();
    debugLog(
      `[Agent] Step ${stepNumber + 1} | Tokens: ${budgetSummary.totalTokens.toLocaleString()} (${budgetSummary.usagePercentage.toFixed(1)}%) | Compact: ${budgetSummary.shouldCompact ? 'YES' : 'no'}`,
    );

    if (stepNumber > 0 && lastStep?.toolResults && lastStep.toolResults.length > 0) {
      const filePaths: string[] = [];
      for (const tr of lastStep.toolResults) {
        if (tr.toolName === 'read_file' || tr.toolName === 'edit_file' || tr.toolName === 'write_file') {
          const input = tr.input as { filePath?: string } | undefined;
          if (input?.filePath) {
            filePaths.push(input.filePath);
          }
        }
      }
      if (filePaths.length > 0) {
        const activationResult = await activateConditionalSkills(filePaths);
        if (activationResult.activated.length > 0) {
          for (const skill of activationResult.activated) {
            sessionState.activeSkills.add(skill.name);
            sessionState.loadedSkills.set(skill.name, skill);
          }
          const activationMessage = formatConditionalSkillActivation(activationResult.activated);
          debugLog(`[Agent] Conditional skills activated: ${activationResult.activated.map((s) => s.name).join(', ')}`);
          const systemMsg: ModelMessageType = {
            role: 'system',
            content: activationMessage,
          };
          messages = [...messages, systemMsg];
        }
      }
    }

    if (sessionState.denialTracker.isThresholdExceeded()) {
      const injectMsg = sessionState.denialTracker.getInjectMessage();
      if (injectMsg) {
        debugLog(`[Agent] Denial threshold exceeded, injecting warning message`);
        return {
          messages: [...messages, injectMsg as ModelMessageType],
        } as PrepareStepResult<TOOLS>;
      }
    }

    const modelSwitchResult = sessionState.modelSwapper.checkUserIntent(messages);
    if (modelSwitchResult.switched) {
      debugLog(`[Agent] Model switched: ${sessionState.model} -> ${modelSwitchResult.newModel}`);
      sessionState.model = modelSwitchResult.newModel!;
      if (modelSwitchResult.notification) {
        debugLog(`[Agent] ${modelSwitchResult.notification}`);
      }
    }

    const costSummary = sessionState.costTracker.getSummary();
    const costPercent = (costSummary.totalCostUsd / costSummary.maxBudgetUsd) * 100;
    const costSwitchResult = sessionState.modelSwapper.checkCostBudget(costPercent);
    if (costSwitchResult.switched) {
      debugLog(`[Agent] Auto-downgrade model due to cost: ${costSwitchResult.newModel}`);
      sessionState.model = costSwitchResult.newModel!;
    }

    if (sessionState.tokenBudget.shouldCompact()) {
      debugLog(`[Agent] Token budget exceeded threshold, triggering compaction...`);
      const compactionResult = await sessionState.compact(messages as unknown as UIMessage[]);
      if (compactionResult.executed) {
        debugLog(`[Agent] Compaction freed ${compactionResult.tokensFreed} tokens`);
        return {
          messages: compactionResult.messages as unknown as ModelMessageType[],
        } as unknown as PrepareStepResult<TOOLS>;
      }
    }

    return {
      messages,
      continue: true,
    } as unknown as PrepareStepResult<TOOLS>;
  };

  return prepareStep;
}
