// ============================================================
// Session State Interfaces - 接口隔离原则
// ============================================================
// 定义 6 个独立接口，每个消费者只 import 它需要的接口。
// SessionState 不强制 extends 这些接口（避免实现类需要满足所有属性），
// 但这些接口描述了 SessionState 的能力子集。
//
// 依赖方向：interfaces.ts 是纯类型定义，不 import 任何运行时模块。
// 这打破了 session-state ↔ compaction 和 session-state ↔ agent-control 的循环。

import type { LanguageModelUsage, UIMessage } from 'ai';
import type { CompactionResult, CompactionConfig} from '../../services/config/compaction-types';
import type { ContentReplacementState, ToolOutputConfig } from '../budget/tool-output-manager';
import type { ResolvedLayout } from '../../services/config/layout';
import type { TodoStore } from '../../primitives/datastore/types';
import type { PermissionRule } from '../../modules/permissions/types';
import type { Skill, SkillEffort } from '../../modules/skills/types';
import type { ModelMessage } from 'ai';
import type { GoalState } from '../../modules/goal/types';

// ============================================================
// 1. TokenBudget - 上下文窗口预算（compaction/pipeline 消费）
// ============================================================
export interface TokenBudget {
  accumulate(usage: LanguageModelUsage): void;
  reportCompaction(result: CompactionResult): void;
  /** 记录本次请求发出前的输入侧估算,供下一步 usage 配对校准(见主文档 F) */
  recordEstimate(estimatedInputTokens: number): void;
  /** usage 反馈校准系数(实际/估算 的滑动平均) */
  readonly calibration: number;
  /** 上一步实际输入 tokens 增量 */
  readonly lastStepInputTokens: number;
  /** 上一步实际输出 tokens 增量 */
  readonly lastStepOutputTokens: number;
  /** 上一步实际缓存读取 tokens 增量 */
  readonly lastStepCachedReadTokens: number;
  getSummary(): {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalTokens: number;
    remainingTokens: number;
    usagePercentage: number;
    shouldCompact: boolean;
  };
}

// ============================================================
// 2. CostTracking - 费用追踪（stop-conditions/pipeline 消费）
// ============================================================
export interface CostTracking {
  readonly isOverBudget: boolean;
  readonly totalCost: number;
  getSummary(): {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    totalCostUsd: number;
    maxBudgetUsd: number;
    isOverBudget: boolean;
    remainingBudget: number;
    budgetUsagePercent: number;
  };
  persistToDB(): Promise<void>;
}

// ============================================================
// 3. DenialTracking - 工具否决追踪（stop-conditions/pipeline 消费）
// ============================================================
export interface DenialTracking {
  record(toolName: string, reason: string): void;
  isThresholdExceeded(): boolean;
  getInjectMessage(): ModelMessage | null;
}

// ============================================================
// 4. ToolOutputState - 工具输出管理（compaction/tools/connector 消费）
// ============================================================
export interface ToolOutputState {
  contentReplacementState: ContentReplacementState;
  toolOutputConfig: ToolOutputConfig;
}

// ============================================================
// 5. SessionContext - 会话基础信息（tools/pipeline 消费）
// ============================================================
export interface SessionContext {
  readonly conversationId: string;
  turnCount: number;
  model: string;
  readonly projectRoot: string;
  readonly layout: ResolvedLayout;
  readonly todoStore: TodoStore;
  readonly permissionRules: readonly PermissionRule[];
  readonly extraSensitivePaths: readonly string[];
  readonly compactionConfig?: CompactionConfig;
  readonly activeSkills: Set<string>;
  readonly loadedSkills: Map<string, Skill>;
  readonly dataStore?: import('../../primitives/datastore/types').DataStore;
  compactModel?: import('@ai-sdk/provider').LanguageModelV3;
  fallbackModels?: import('@ai-sdk/provider').LanguageModelV3[];
  abort(): void;
  aborted: boolean;
}

// ============================================================
// 6. CompactionService - 压缩服务（由 api/app 注入，pipeline 消费）
// ============================================================
// 打破 session-state ↔ compaction 循环的关键：
// session-state 只依赖这个接口，不 import compaction 模块。
export interface CompactionService {
  compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult>;
}

// ============================================================
// PipelineContext - pipeline.ts 所需的组合接口
// ============================================================
// 聚合 pipeline 消费的所有子接口，避免 pipeline 直接 import 完整 SessionState。
export interface PipelineContext {
  tokenBudget: TokenBudget;
  costTracker: CostTracking;
  denialTracker: DenialTracking;
  contentReplacementState: ContentReplacementState;
  toolOutputConfig: ToolOutputConfig;
  compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult>;
  aborted: boolean;
  turnCount: number;
  model: string;
  skillTurnOverride?: {
    skillName: string;
    model?: string;
    effort?: SkillEffort;
  };
  conversationId: string;
  layout: ResolvedLayout;
  /** 连续纯推理步数（无工具调用、无文本输出），用于检测推理循环 */
  consecutiveReasoningOnlySteps: number;
  /** 当前活跃目标（null 表示无目标） */
  goalState: GoalState | null;
  /** 更新会话上下文水位到数据库。pipeline 每步估算后调用。 */
  updateContextBudget?: (estimation: {
    utilizationPercent: number;
    totalTokens: number;
    modelLimit: number;
    messagesTokens?: number;
    instructionsTokens?: number;
    toolsTokens?: number;
    outputReserve?: number;
    cachedReadTokens?: number;
    stepInputTokens?: number;
    /** 上次压缩释放的 tokens */
    lastCompactionFreedTokens?: number;
    /** 当前上下文已被压缩 */
    compactionActive?: boolean;
  }) => void;

  /** 上一步骤的 todo revision 快照，用于 ContextInjector 变更检测 */
  lastTodoRevision: number;

  /** 自上次 todo 变更以来的步数，用于 ContextInjector 无活动提醒 */
  stepsSinceTodoMutation: number;

  /** 任务存储，用于 ContextInjector 读取任务快照 */
  todoStore: TodoStore;
}
