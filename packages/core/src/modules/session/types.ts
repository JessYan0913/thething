// ============================================================
// Session State Types
// ============================================================

import type { UIMessage } from 'ai';
import type { CompactionResult} from '../../services/config/compaction-types';
import type { Skill, SkillEffort } from '../../modules/skills/types';
import type { ContentReplacementState, ToolOutputConfig } from '../budget/tool-output-manager';
import type { DataStore } from '../../primitives/datastore/types';
import type { CompactionConfig } from '../../services/config/behavior';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ResolvedLayout } from '../../services/config/layout';
import type { PermissionRule } from '../../modules/permissions/types';
import type { PricingResolver } from '../../services/model/pricing';
import type { TodoStore } from '../todos/types';
import type { GoalState } from '../../modules/goal/types';
import type { CompactionView } from '../compaction/compaction-view';

/**
 * Session 状态选项
 */
export interface SessionStateOptions {
  /** 最大上下文 Token */
  maxContextTokens?: number;
  /** 压缩阈值 */
  compactThreshold?: number;
  /** 最大预算（美元） */
  maxBudgetUsd?: number;
  /** 模型名称 */
  model?: string;
  /** 每工具最大拒绝次数 */
  maxDenialsPerTool?: number;
  /** 项目根目录，用于工具执行与项目上下文 */
  projectRoot?: string;
  /** 解析后的布局快照 */
  layout: ResolvedLayout;
  /** 工具输出配置 */
  toolOutputConfig?: ToolOutputConfig;
  /** DataStore 实例（来自 CoreRuntime，必填） */
  dataStore: DataStore;
  /** 定价解析器（来自 CoreRuntime；未传入时使用实例级默认定价） */
  pricingResolver?: PricingResolver;
  /** 任务存储（来自 CoreRuntime/DataStore，未传入时使用 dataStore.todoStore） */
  todoStore?: TodoStore;
  /** Compaction 配置（来自 BehaviorConfig.compaction） */
  compactionConfig?: CompactionConfig;
  /** 是否启用普通自动压缩（modules.compaction !== false） */
  compactionEnabled?: boolean;
  /** 注入的压缩函数（从 composition 层传入，打破 session→compaction 耦合） */
  compact?: (messages: import('ai').ModelMessage[]) => Promise<CompactionResult>;
  /** AppContext 快照中的权限规则 */
  permissionRules?: readonly PermissionRule[];
  /** 来自 BehaviorConfig.extraSensitivePaths */
  extraSensitivePaths?: readonly string[];
}

/**
 * Session 状态
 */
export interface SessionState {
  /** 对话 ID */
  conversationId: string;
  /** 轮次计数 */
  turnCount: number;
  /** Token 预算追踪 */
  tokenBudget: import('./token-budget').TokenBudgetTracker;
  /** 成本追踪 */
  costTracker: import('./cost').CostTracker;
  /** 拒绝追踪 */
  denialTracker: import('./denial-tracking').DenialTracker;
  /** 活跃技能 */
  activeSkills: Set<string>;
  /** 已加载技能 */
  loadedSkills: Map<string, Skill>;
  /** 当前模型 */
  model: string;
  /** 当前请求内由 Skill 激活的临时覆盖；新用户消息会重建 SessionState，因此不会持久化。 */
  skillTurnOverride?: {
    skillName: string;
    model?: string;
    effort?: SkillEffort;
  };
  /** 是否中止 */
  aborted: boolean;
  /** 项目根目录 */
  projectRoot: string;
  /** 解析后的布局 */
  layout: ResolvedLayout;
  /** 工具输出配置 */
  toolOutputConfig: ToolOutputConfig;
  /** AppContext 快照中的权限规则 */
  permissionRules: readonly PermissionRule[];
  /** 额外敏感路径 */
  extraSensitivePaths: readonly string[];
  /** 当前会话绑定的任务存储 */
  todoStore: TodoStore;
  /** 内容替换状态（保证 prompt cache 稳定） */
  contentReplacementState: ContentReplacementState;
  /** 压缩配置 */
  compactionConfig?: CompactionConfig;
  /** 模型实例引用（用于 Layer 3 LLM 摘要） */
  compactModel?: LanguageModelV3;
  /** Fallback 模型列表（用于 Layer 3） */
  fallbackModels?: LanguageModelV3[];
  /** DataStore 引用（用于 Layer 3 摘要持久化） */
  dataStore?: DataStore;
  /** 连续纯推理步数（无工具调用、无文本输出），用于检测推理循环 */
  consecutiveReasoningOnlySteps: number;

  /** 上一步骤的 todo revision 快照，用于 ContextInjector 变更检测 */
  lastTodoRevision: number;

  /** 自上次 todo 变更以来的步数，用于 ContextInjector 无活动提醒 */
  stepsSinceTodoMutation: number;

  /** 当前活跃目标（null 表示无目标） */
  goalState: GoalState | null;

  /** 跨步骤压缩视图（记录已被 L3 摘要覆盖的前缀） */
  compactionView: CompactionView;

  /** 压缩状态机 + 事件累计（新；与 TokenBudgetTracker 正交） */
  compactionTracker: import('../compaction/state-tracker').CompactionStateTracker;

  /** 遥测收集器 */
  telemetry: import('../compaction/compaction-telemetry').CompactionTelemetry;

  /** 上下文台账 + pin 注册表（读循环熔断 / context_pin 工具共享） */
  contextLedger: import('../compaction/context-ledger').ContextLedger;

  /** 会话级压缩步数计数器（跨 API 调用持久），用于 TTL 老化 */
  compactionStepCounter: { current: number };

  /** 上次完整请求 token 估算结果，供 onStepEnd 推送前端 + 写库使用 */
  lastEstimation?: import('../compaction/token-counter').FullRequestEstimation;

  /** 压缩消息 */
  compact(messages: import('ai').ModelMessage[]): Promise<CompactionResult>;
  /** 中止会话 */
  abort(): void;
  /** 清理工具结果存储 */
  cleanupToolResults(): Promise<void>;
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
    lastCompactionFreedTokens?: number;
    compactionActive?: boolean;
    sessionInputTokens?: number;
    sessionOutputTokens?: number;
    sessionCostUsd?: number;
  }) => void;
}
