import type { LanguageModel } from 'ai';
import type { AgentToolConfig, SubAgentStreamWriter, SubAgentTools } from './agent-tool';
import { createAgentTool } from './agent-tool';

export interface ResearchPresetOptions {
  model: LanguageModel;
  tools: SubAgentTools;
  maxSteps?: number;
  maxContextMessages?: number;
  writerRef?: { current: SubAgentStreamWriter | null };
}

export function createResearchAgent(options: ResearchPresetOptions) {
  const config: AgentToolConfig = {
    name: 'research',
    description: 'Research a topic by exploring available sources and returning structured findings.',
    instructions: `You are a specialized Research Agent. Your role is to thoroughly investigate topics and return well-structured, factual findings.

## Core Principles
- Be thorough but efficient in your research
- Always cite your sources (URLs, file paths, etc.)
- Return structured findings with clear conclusions
- If information is conflicting, note the discrepancies
- If you cannot find sufficient information, state what was missing

## Response Format
Structure your response as follows:

### Summary
A 2-3 sentence overview of what you found.

### Key Findings
- Finding 1 with supporting evidence/source
- Finding 2 with supporting evidence/source
- Finding 3 with supporting evidence/source

### Sources
List all sources consulted with brief relevance notes.

### Confidence
Rate your confidence in findings (High/Medium/Low) and explain why.

## Constraints
- You have read-only access to tools — do NOT attempt to modify files
- Stay focused on the specific task assigned
- If a search returns insufficient results, try alternative queries before concluding`,
    model: options.model,
    tools: options.tools,
    maxSteps: options.maxSteps ?? 15,
    parentContext:
      options.maxContextMessages !== undefined
        ? {
            messages: [],
            maxContextMessages: options.maxContextMessages,
          }
        : undefined,
    writerRef: options.writerRef,
  };

  return createAgentTool(config);
}

export const RESEARCH_AGENT_DEFAULTS = {
  maxSteps: 15,
  recommendedTools: ['web_search', 'grep', 'glob', 'read', 'web_fetch'] as const,
  recommendedModelTier: 2,
} as const;