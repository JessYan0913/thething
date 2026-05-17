// ============================================================
// Session State Types
// ============================================================

import type { UIMessage } from 'ai';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../../extensions/skills/types';
import type { ContentReplacementState, ToolOutputConfig } from '../budget/tool-output-manager';
import type { DataStore } from '../../foundation/datastore/types';
import type { ModelSpec, CompactionConfig } from '../../config/behavior';
import type { ResolvedLayout } from '../../config/layout';
import type { PermissionRule } from '../../extensions/permissions/types';
import type { PricingResolver } from '../../foundation/model/pricing';
import type { TaskStore } from '../tasks/types';

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
  /** 任务存储（来自 CoreRuntime/DataStore，未传入时使用 dataStore.taskStore） */
  taskStore?: TaskStore;
  /** 可用模型列表（来自 BehaviorConfig） */
  availableModels?: ModelSpec[];
  /** 自动降级成本阈值（来自 BehaviorConfig） */
  autoDowngradeCostThreshold?: number;
  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: { fast: string; smart: string; default: string };
  /** Compaction 配置（来自 BehaviorConfig.compaction） */
  compactionConfig?: CompactionConfig;
  /** 是否启用普通自动压缩（modules.compaction !== false） */
  compactionEnabled?: boolean;
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
  denialTracker: import('../agent-control/denial-tracking').DenialTracker;
  /** 模型切换 */
  modelSwapper: import('../agent-control/model-switching').ModelSwapper;
  /** 活跃技能 */
  activeSkills: Set<string>;
  /** 已加载技能 */
  loadedSkills: Map<string, Skill>;
  /** 当前模型 */
  model: string;
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
  taskStore: TaskStore;
  /** 内容替换状态（保证 prompt cache 稳定） */
  contentReplacementState: ContentReplacementState;

  /** 压缩消息 */
  compact(messages: UIMessage[]): Promise<CompactionResult>;
  /** 中止会话 */
  abort(): void;
  /** 清理工具结果存储 */
  cleanupToolResults(): Promise<void>;
}
