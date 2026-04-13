import { type LanguageModel, type StopCondition, type ToolSet, type UIMessage } from 'ai';

export type { LanguageModel, ToolSet, UIMessage, StopCondition };

export interface AgentDefinition {
  agentType: string;
  displayName?: string;
  description?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: LanguageModel | 'inherit' | 'fast' | 'smart';
  includeParentContext?: boolean;
  maxParentMessages?: number;
  maxSteps?: number;
  instructions: string;
  summarizeOutput?: boolean;
  stopWhen?: StopCondition<ToolSet>[];
  metadata?: Record<string, unknown>;
}

export interface AgentExecutionContext {
  parentTools: ToolSet;
  parentModel: LanguageModel;
  parentSystemPrompt: string;
  parentMessages: UIMessage[];
  writerRef: { current: SubAgentStreamWriter | null };
  abortSignal: AbortSignal;
  toolCallId: string;
  recursionDepth: number;
}

export interface AgentExecutionResult {
  success: boolean;
  summary: string;
  durationMs: number;
  tokenUsage?: TokenUsageStats;
  stepsExecuted: number;
  toolsUsed: string[];
  error?: string;
  status: 'completed' | 'failed' | 'aborted' | 'recursion-blocked';
}

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type SubAgentStreamWriter = {
  write: (chunk: Record<string, unknown>) => void;
};

export interface AgentToolInput {
  agentType?: string;
  task: string;
}

export interface AgentToolConfig {
  parentTools: ToolSet;
  parentModel: LanguageModel;
  parentSystemPrompt: string;
  parentMessages: UIMessage[];
  writerRef: { current: SubAgentStreamWriter | null };
  recursionDepth?: number;
}

export type AgentRouteDecision = {
  type: 'named' | 'context' | 'general';
  definition: AgentDefinition;
  reason: string;
};
