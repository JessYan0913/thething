import type { UIMessage } from "ai";

export type CompactionType = "auto" | "manual" | "micro";

export interface PreservedSegment {
  headUuid: string;
  anchorUuid: string;
  tailUuid: string;
}

export interface CompactMetadata {
  compactType: CompactionType;
  preCompactTokenCount: number;
  lastUserMessageUuid: string;
  preCompactDiscoveredTools?: string[];
  preservedSegment?: PreservedSegment;
}

export interface CompactBoundaryMessage extends UIMessage {
  role: "system";
  parts: Array<{
    type: "text";
    text: string;
  }>;
}

export interface CompactionResult {
  messages: UIMessage[];
  executed: boolean;
  type: CompactionType | null;
  tokensFreed: number;
  boundaryMessage?: CompactBoundaryMessage;
  summary?: string;
}

export interface SessionMemoryCompactConfig {
  minTokens: number;
  maxTokens: number;
  minTextBlockMessages: number;
}

export interface MicroCompactConfig {
  timeWindowMs: number;
  imageMaxTokenSize: number;
  compactableTools: Set<string>;
  gapThresholdMinutes: number;
  keepRecent: number;
}

export interface PostCompactConfig {
  totalBudget: number;
  maxFilesToRestore: number;
  maxTokensPerFile: number;
  maxTokensPerSkill: number;
  skillsTokenBudget: number;
}

export interface StoredSummary {
  id: string;
  conversationId: string;
  summary: string;
  compactedAt: string;
  lastMessageOrder: number;
  preCompactTokenCount: number;
}

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  maxTokens: 40_000,
  minTextBlockMessages: 5,
};

export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  timeWindowMs: 15 * 60 * 1000,
  imageMaxTokenSize: 2000,
  compactableTools: new Set([
    "web_search",
    "Read",
    "Bash",
    "Grep",
    "Glob",
    "WebSearch",
    "WebFetch",
    "Edit",
    "Write",
  ]),
  gapThresholdMinutes: 60,
  keepRecent: 5,
};

export const DEFAULT_POST_COMPACT_CONFIG: PostCompactConfig = {
  totalBudget: 50_000,
  maxFilesToRestore: 5,
  maxTokensPerFile: 5_000,
  maxTokensPerSkill: 5_000,
  skillsTokenBudget: 25_000,
};

export const COMPACT_TOKEN_THRESHOLD = 25_000;

export const SYSTEM_COMPACT_BOUNDARY_MARKER = "SYSTEM_COMPACT_BOUNDARY";
