// ============================================================
// Session State Types
// ============================================================

import type { UIMessage } from 'ai';
import type { CompactionResult } from '../compaction/types';
import type { Skill } from '../../extensions/skills/types';
import type { ContentReplacementState, ToolOutputOverrides } from '../budget/tool-output-manager';
import type { DataStore } from '../../foundation/datastore';

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
  /** 项目目录，用于工具结果持久化 */
  projectDir?: string;
  /** 工具输出配置覆盖（由应用层注入） */
  toolOutputOverrides?: ToolOutputOverrides;
  /** DataStore 实例（来自 CoreRuntime） */
  dataStore?: DataStore;
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
  /** 项目目录 */
  projectDir: string;
  /** 内容替换状态（保证 prompt cache 稳定） */
  contentReplacementState: ContentReplacementState;

  /** 压缩消息 */
  compact(messages: UIMessage[]): Promise<CompactionResult>;
  /** 中止会话 */
  abort(): void;
  /** 清理工具结果存储 */
  cleanupToolResults(): Promise<void>;
}