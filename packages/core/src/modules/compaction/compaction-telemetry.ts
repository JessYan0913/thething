// ============================================================
// Compaction Telemetry - 压缩遥测
// ============================================================
// 收集和记录压缩操作的性能指标

import { logger } from '../../primitives/logger';

/**
 * 遥测事件类型
 */
export type TelemetryEvent =
  | ViewAppliedEvent
  | ViewInvalidatedEvent
  | Layer3TriggeredEvent
  | Layer2ExecutedEvent
  | CheckpointLoadedEvent
  | ReadLoopDetectedEvent
  | OvercompactionDetectedEvent
  | TaskSplitEvent;

/**
 * 视图应用事件
 */
export interface ViewAppliedEvent {
  type: 'view_applied';
  timestamp: number;
  messagesBeforeView: number;
  messagesAfterView: number;
  anchorIndex: number;
  /** 节省的时间（估算，相比 Layer 3） */
  estimatedTimeSavedMs?: number;
}

/**
 * 视图失效事件
 */
export interface ViewInvalidatedEvent {
  type: 'view_invalidated';
  timestamp: number;
  reason: 'fingerprint_mismatch' | 'anchor_not_found' | 'anchor_out_of_range';
  anchorIndex?: number;
  messagesLength: number;
}

/**
 * Layer 3 触发事件
 */
export interface Layer3TriggeredEvent {
  type: 'layer3_triggered';
  timestamp: number;
  reason: 'budget_exceeded' | 'no_view' | 'view_invalidated';
  messagesBeforeCompaction: number;
  messagesAfterCompaction: number;
  tokensFreed?: number;
  durationMs: number;
}

/**
 * Layer 2 执行事件
 */
export interface Layer2ExecutedEvent {
  type: 'layer2_executed';
  timestamp: number;
  toolResultsCompressed: number;
  bytesFreed: number;
  durationMs: number;
}

/**
 * Checkpoint 加载事件
 */
export interface CheckpointLoadedEvent {
  type: 'checkpoint_loaded';
  timestamp: number;
  applied: boolean;
  anchorIndex?: number;
  messagesSkipped?: number;
}

/**
 * 读循环检测事件（压缩副作用信号）
 * 同一文件被反复读取说明压缩把模型要的内容吃掉了——
 * 2026-07-25 事故：skill 文件被压成 meta 后模型连读 7/31 次。
 */
export interface ReadLoopDetectedEvent {
  type: 'read_loop_detected';
  timestamp: number;
  /** 被反复读取的文件路径 */
  path: string;
  /** 读取次数 */
  readCount: number;
  /** 是否已自动 pin（最新读取豁免压缩） */
  autoPinned: boolean;
}

/**
 * 压缩过头检测事件（可观测闭环信号）
 * 模型 re-read 了一个曾被 meta 化的文件,说明压缩删了模型需要的内容。
 * 区别于 read_loop_detected:后者统计总读次数,本事件特指"压缩后 re-read"。
 */
export interface OvercompactionDetectedEvent {
  type: 'overcompaction_detected';
  timestamp: number;
  /** 被 re-read 的路径(此前被 meta 化) */
  path: string;
  /** 是否已自动 pin(防止再次被压) */
  autoPinned: boolean;
}

/**
 * 任务拆分事件（子任务独立上下文范式）
 */
export interface TaskSplitEvent {
  type: 'task_split';
  timestamp: number;
  /** 被拆分的 todo ID */
  todoId: string;
  /** 拆分原因 */
  reason: 'budget_exceeded' | 'safety_valve';
  /** 拆分后新子任务数量 */
  newSubtaskCount: number;
  /** 拆分前估算 tokens */
  estimatedTokensBefore: number;
  /** 触发阈值 tokens */
  triggerTokens: number;
}

/**
 * UI 通知事件 — 用于在对话流中插入系统消息
 */
export interface CompactionUINotification {
  /** 触发的压缩层 */
  layer: 'lifecycle' | 'emergency';
  /** 受影响的消息数量 */
  messagesAffected: number;
  /** 释放的 token 数量（估算） */
  tokensSaved: number;
  /** 压缩策略 */
  strategy: 'meta' | 'truncate' | 'summarize' | 'force-truncate' | 'ttl-stub' | 'ttl-evict';
  /** 压缩耗时（毫秒） */
  durationMs: number;
}

/** UI 通知回调类型 */
export type CompactionUICallback = (notification: CompactionUINotification) => void;

export interface TelemetryStats {
  /** 总视图应用次数 */
  viewAppliedCount: number;
  /** 总视图失效次数 */
  viewInvalidatedCount: number;
  /** 总 Layer 3 触发次数 */
  layer3TriggeredCount: number;
  /** 总 Layer 2 执行次数 */
  layer2ExecutedCount: number;
  /** Checkpoint 加载次数 */
  checkpointLoadedCount: number;
  /** 视图命中率（应用次数 / (应用次数 + Layer 3 次数)） */
  viewHitRate: number;
  /** 估算节省的总时间（ms） */
  estimatedTotalTimeSavedMs: number;
  /** 平均每次视图应用节省的消息数 */
  avgMessagesCompressedByView: number;
}

/**
 * 遥测收集器
 */
export class CompactionTelemetry {
  private events: TelemetryEvent[] = [];
  private maxEvents = 1000; // 保留最近 1000 个事件
  private uiCallbacks: CompactionUICallback[] = [];

  /**
   * 注册 UI 通知回调（每次压缩完成后推送）
   */
  onCompactionUI(cb: CompactionUICallback): void {
    this.uiCallbacks.push(cb);
  }

  /**
   * 推送 UI 通知（仅当 messagesAffected > 0 时）
   */
  notifyUI(notification: CompactionUINotification): void {
    if (notification.messagesAffected <= 0) return;
    for (const cb of this.uiCallbacks) {
      try { cb(notification); } catch { /* UI 回调不应影响压缩管道 */ }
    }
  }

  /**
   * 记录视图应用
   */
  recordViewApplied(data: Omit<ViewAppliedEvent, 'type' | 'timestamp'>): void {
    const event: ViewAppliedEvent = {
      type: 'view_applied',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    const saved = data.messagesBeforeView - data.messagesAfterView;
    logger.info(
      'CompactionTelemetry',
      `View applied: ${data.messagesBeforeView} → ${data.messagesAfterView} messages (saved ${saved}, anchor=${data.anchorIndex})`,
    );

    if (data.estimatedTimeSavedMs) {
      logger.debug(
        'CompactionTelemetry',
        `Estimated time saved: ${data.estimatedTimeSavedMs.toFixed(0)}ms`,
      );
    }
  }

  /**
   * 记录视图失效
   */
  recordViewInvalidated(data: Omit<ViewInvalidatedEvent, 'type' | 'timestamp'>): void {
    const event: ViewInvalidatedEvent = {
      type: 'view_invalidated',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    logger.warn(
      'CompactionTelemetry',
      `View invalidated: reason=${data.reason}, anchor=${data.anchorIndex}, messages=${data.messagesLength}`,
    );
  }

  /**
   * 记录 Layer 3 触发
   */
  recordLayer3Triggered(data: Omit<Layer3TriggeredEvent, 'type' | 'timestamp'>): void {
    const event: Layer3TriggeredEvent = {
      type: 'layer3_triggered',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    const compressed = data.messagesBeforeCompaction - data.messagesAfterCompaction;
    logger.info(
      'CompactionTelemetry',
      `Layer 3 triggered: reason=${data.reason}, ${data.messagesBeforeCompaction} → ${data.messagesAfterCompaction} messages (compressed ${compressed}) in ${data.durationMs.toFixed(0)}ms`,
    );
  }

  /**
   * 记录 Layer 2 执行
   */
  recordLayer2Executed(data: Omit<Layer2ExecutedEvent, 'type' | 'timestamp'>): void {
    const event: Layer2ExecutedEvent = {
      type: 'layer2_executed',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    logger.debug(
      'CompactionTelemetry',
      `Layer 2 executed: ${data.toolResultsCompressed} results compressed, ${data.bytesFreed} bytes freed in ${data.durationMs.toFixed(0)}ms`,
    );
  }

  /**
   * 记录 Checkpoint 加载
   */
  recordCheckpointLoaded(data: Omit<CheckpointLoadedEvent, 'type' | 'timestamp'>): void {
    const event: CheckpointLoadedEvent = {
      type: 'checkpoint_loaded',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    if (data.applied) {
      logger.info(
        'CompactionTelemetry',
        `Checkpoint loaded: anchor=${data.anchorIndex}, skipped ${data.messagesSkipped} messages`,
      );
    } else {
      logger.debug('CompactionTelemetry', 'Checkpoint not found or not applicable');
    }
  }

  /**
   * 记录读循环检测（压缩副作用信号）
   */
  recordReadLoopDetected(data: Omit<ReadLoopDetectedEvent, 'type' | 'timestamp'>): void {
    const event: ReadLoopDetectedEvent = {
      type: 'read_loop_detected',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    logger.warn(
      'CompactionTelemetry',
      `Read loop: ${data.path} read ${data.readCount} times${data.autoPinned ? ' (auto-pinned)' : ''}`,
    );
  }

  /**
   * 记录压缩过头检测（可观测闭环:压缩删了模型需要的内容,触发 re-read）
   */
  recordOvercompactionDetected(data: Omit<OvercompactionDetectedEvent, 'type' | 'timestamp'>): void {
    const event: OvercompactionDetectedEvent = {
      type: 'overcompaction_detected',
      timestamp: Date.now(),
      ...data,
    };
    this.events.push(event);
    this.trimEvents();

    logger.warn(
      'CompactionTelemetry',
      `Overcompaction: ${data.path} re-read after being meta-ized${data.autoPinned ? ' (auto-pinned)' : ''}`,
    );
  }

  /**
   * 记录任务拆分（子任务独立上下文范式）
   */
  recordTaskSplit(data: Omit<TaskSplitEvent, 'type' | 'timestamp'>): void {
    const event: TaskSplitEvent = {
      type: 'task_split',
      timestamp: Date.now(),
      ...data,
    };

    this.events.push(event);
    this.trimEvents();

    logger.info(
      'CompactionTelemetry',
      `Task split: todoId=${data.todoId}, reason=${data.reason}, ` +
        `${data.estimatedTokensBefore} tokens → ${data.newSubtaskCount} subtasks (trigger=${data.triggerTokens})`,
    );
  }

  /**
   * 获取统计信息
   */
  getStats(): TelemetryStats {
    const viewApplied = this.events.filter((e) => e.type === 'view_applied');
    const viewInvalidated = this.events.filter((e) => e.type === 'view_invalidated');
    const layer3 = this.events.filter((e) => e.type === 'layer3_triggered');
    const layer2 = this.events.filter((e) => e.type === 'layer2_executed');
    const checkpoint = this.events.filter((e) => e.type === 'checkpoint_loaded');

    const viewAppliedCount = viewApplied.length;
    const layer3TriggeredCount = layer3.length;
    const totalCompressions = viewAppliedCount + layer3TriggeredCount;
    const viewHitRate = totalCompressions > 0 ? viewAppliedCount / totalCompressions : 0;

    // 估算节省的时间：假设 Layer 3 平均需要 5 秒
    const avgLayer3DurationMs = 5000;
    const estimatedTotalTimeSavedMs = viewAppliedCount * avgLayer3DurationMs;

    // 平均每次视图应用压缩的消息数
    const totalMessagesCompressed = viewApplied.reduce((sum, e) => {
      const event = e as ViewAppliedEvent;
      return sum + (event.messagesBeforeView - event.messagesAfterView);
    }, 0);
    const avgMessagesCompressedByView =
      viewAppliedCount > 0 ? totalMessagesCompressed / viewAppliedCount : 0;

    return {
      viewAppliedCount,
      viewInvalidatedCount: viewInvalidated.length,
      layer3TriggeredCount,
      layer2ExecutedCount: layer2.length,
      checkpointLoadedCount: checkpoint.filter((e) => (e as CheckpointLoadedEvent).applied).length,
      viewHitRate,
      estimatedTotalTimeSavedMs,
      avgMessagesCompressedByView,
    };
  }

  /**
   * 打印统计摘要
   */
  printSummary(): void {
    const stats = this.getStats();

    logger.info('CompactionTelemetry', '========== Compaction Statistics ==========');
    logger.info('CompactionTelemetry', `View Applied: ${stats.viewAppliedCount}`);
    logger.info('CompactionTelemetry', `View Invalidated: ${stats.viewInvalidatedCount}`);
    logger.info('CompactionTelemetry', `Layer 3 Triggered: ${stats.layer3TriggeredCount}`);
    logger.info('CompactionTelemetry', `Layer 2 Executed: ${stats.layer2ExecutedCount}`);
    logger.info(
      'CompactionTelemetry',
      `Checkpoint Loaded: ${stats.checkpointLoadedCount}`,
    );
    logger.info(
      'CompactionTelemetry',
      `View Hit Rate: ${(stats.viewHitRate * 100).toFixed(1)}%`,
    );
    logger.info(
      'CompactionTelemetry',
      `Estimated Time Saved: ${(stats.estimatedTotalTimeSavedMs / 1000).toFixed(1)}s`,
    );
    logger.info(
      'CompactionTelemetry',
      `Avg Messages Compressed by View: ${stats.avgMessagesCompressedByView.toFixed(1)}`,
    );
    logger.info('CompactionTelemetry', '==========================================');
  }

  /**
   * 获取最近的事件
   */
  getRecentEvents(count = 10): TelemetryEvent[] {
    return this.events.slice(-count);
  }

  /**
   * 清空事件
   */
  clear(): void {
    this.events = [];
  }

  /**
   * 限制事件数量
   */
  private trimEvents(): void {
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }
}

/**
 * 全局遥测实例
 */
export const telemetry = new CompactionTelemetry();
