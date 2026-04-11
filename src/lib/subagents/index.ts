export { createAgentTool } from './agent-tool';
export type { AgentToolConfig, AgentToolResult, SubAgentTools } from './agent-tool';

export {
  buildSubAgentPrompt,
  createSubAgentContext,
  extractContextForSubAgent,
  finalizeSubAgentContext,
  getSubAgentDurationMs,
  wrapSubAgentResult,
} from './context';
export type { BuildSubAgentPromptOptions, ContextExtractionOptions, SubAgentContext, SubAgentResult } from './context';

export { RESEARCH_AGENT_DEFAULTS, createResearchAgent } from './presets';
export type { ResearchPresetOptions } from './presets';