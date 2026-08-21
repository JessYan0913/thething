import type { TodoStore, Todo, TodoStatus, TodoMetadata } from './types';

/**
 * TodoRuntime — Todo Runtime 的状态与运行时心脏。
 *
 * 分层（模型决策 / 系统执行）：
 * - 模型负责「做什么、何时做、是否完成」；系统（本模块）只做运行时约束。
 * - 系统可以判断：迁移是否合法、claim 是否冲突、依赖是否满足、是否 quiescent。
 * - 系统不得判断：任务"实际上"是否完成、是否要验证、该做哪个任务。
 *
 * READY 是派生属性（pending + 依赖完成 + 未 claim），不落库。
 * Quiescent ≠ Goal 完成：isQuiescent() 只表示「没有正在运行的 runtime work」。
 */
import { logger } from '../../primitives/logger';

/** 严格状态迁移矩阵 —— 唯一事实源。terminal 态(completed/cancelled)无出边。 */
export const TODO_TRANSITIONS: Record<TodoStatus, readonly TodoStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  failed: ['pending', 'cancelled'],
  completed: [], // terminal
  cancelled: [], // terminal
};

/** 执行模式（模型选择，系统只记录与约束）。 */
export type ExecutionMode = 'main_agent' | 'agent' | 'parallel_agent';

/**
 * Quiescent 的原因（区分「可完成候选」vs「卡住」）：
 * - completed_candidate：无就绪/进行中/failed/blocked，且会话内有 todo（多为全 terminal）→ 值得 Completion Audit。
 * - blocked：卡在未完成的依赖上（有 blocked todo）。
 * - failed：有 failed todo（失败是模型决策，不自动忽略）。
 * - no_work：会话内根本没有 todo（空会话）。
 * - null：非 quiescent（还有 runtime work）。
 */
export type QuiescenceReason = 'completed_candidate' | 'blocked' | 'failed' | 'no_work';

/** 谁/什么在执行一个 todo（写入 metadata.execution） */
export interface ExecutionInfo {
  agentId: string;
  mode?: ExecutionMode;
  source?: string;
  startedAt?: number;
  /** 并行路径：跳过「单进行中」门（仍保留 blockedBy/重复 claim 校验）。 */
  allowParallel?: boolean;
}

/** Scheduler 拒绝时的错误类别（不做静默覆盖）。 */
export type TransitionError =
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'ALREADY_CLAIMED'
  | 'AGENT_BUSY'
  | 'DEPENDENCIES_UNMET'
  | 'TOO_MANY_IN_PROGRESS';

class TodoRuntimeError extends Error {
  constructor(public code: TransitionError, message: string) {
    super(message);
    this.name = 'TodoRuntimeError';
  }
}

/** 只读运行时派生状态快照。 */
export interface TodoRuntimeState {
  ready: Todo[];
  inProgress: Todo[];
  pending: Todo[];
  blocked: Todo[];
  failed: Todo[];
  completed: Todo[];
  cancelled: Todo[];
  pendingArchiveIds: string[];
  pendingRetryIds: string[];
  quiescent: boolean;
  /** quiescent 时的原因；非 quiescent 为 null。 */
  quiescenceReason: QuiescenceReason | null;
}

/** 统一终局判定视图（quiescent ≠ completed；requiresCompletionAudit 由调用方算）。 */
export interface TaskFinishState {
  quiescent: boolean;
  reason: QuiescenceReason | null;
  requiresCompletionAudit: boolean;
  pendingArchives: string[];
  pendingRetries: string[];
  readyTodos: Todo[];
  inProgressTodos: Todo[];
}

/** metadata.execution（V3） */
export interface TodoExecutionMeta {
  agentId?: string;
  mode?: ExecutionMode;
  source?: string;
  startedAt?: number;
  finishedAt?: number;
  retryable?: boolean;
}

/** metadata.lifecycle（V3） */
export interface TodoLifecycleMeta {
  createdBy?: 'planner' | 'main_agent' | 'sub_agent' | 'splitter' | 'system';
  retries?: number;
  parentTodoId?: string;
  rootTodoId?: string;
  generation?: number;
  supersededBy?: string;
  mergedInto?: string;
  cancelReason?: string;
}

/** metadata.verification（V2，仅记录，不做 completion gate） */
export interface TodoVerificationMeta {
  status?: 'not_required' | 'pending' | 'passed' | 'failed';
  checkedAt?: number;
  method?: string;
  evidence?: unknown;
  failureReason?: string;
}

/** metadata.archive（V2；facts 是既有 metadata.facts 的别名引用） */
export interface TodoArchiveMeta {
  status?: 'pending' | 'completed' | 'failed';
  attempts?: number;
  facts?: TodoMetadata['facts'];
}

/**
 * Metadata V2 访问器 — 缺省返回安全默认，无需每个读点判空。
 * DB/既有 metadata 结构不动，新语义只写入 metadata 子对象。
 */
export function getExecution(todo: Todo): TodoExecutionMeta {
  const v = todo.metadata?.execution;
  return v && typeof v === 'object' ? (v as TodoExecutionMeta) : {};
}
export function getLifecycle(todo: Todo): TodoLifecycleMeta {
  const v = todo.metadata?.lifecycle;
  return v && typeof v === 'object' ? (v as TodoLifecycleMeta) : {};
}
export function getVerification(todo: Todo): TodoVerificationMeta {
  const v = todo.metadata?.verification;
  return v && typeof v === 'object' ? (v as TodoVerificationMeta) : {};
}
export function getArchive(todo: Todo): TodoArchiveMeta {
  const v = todo.metadata?.archive;
  return v && typeof v === 'object' ? (v as TodoArchiveMeta) : {};
}

/**
 * 计算 quiescent 的原因（纯函数）。仅在 quiescent 时调用（调用方保证 ready/inProgress 为空）。
 * completed_candidate 与 no_work 的区分依赖会话内 todo 总数（convCount）：
 * - 会话为空（无任何 todo）→ no_work；
 * - 会话非空且无 failed/blocked（多为全 terminal）→ completed_candidate。
 */
export function computeQuiescenceReason(args: {
  failed: number;
  blocked: number;
  convCount: number;
}): QuiescenceReason {
  if (args.failed > 0) return 'failed';
  if (args.blocked > 0) return 'blocked';
  if (args.convCount === 0) return 'no_work';
  return 'completed_candidate';
}

export type TodoRuntime = {
  getReadyTodos(): Todo[];
  getRuntimeState(): TodoRuntimeState;
  isQuiescent(): boolean;
  getTaskFinishState(): TaskFinishState;
  claimTodo(todoId: string, execution: ExecutionInfo): Todo;
  completeTodo(todoId: string, result: string): Todo;
  failTodo(todoId: string, error: string, retryable?: boolean): Todo;
  retryTodo(todoId: string): Todo;
  cancelTodo(todoId: string, reason?: string): Todo;
  readonly store: TodoStore;
};

export function createTodoRuntime(deps: {
  store: TodoStore;
  conversationId: string;
  /** 是否强制「同一时刻仅一个 in_progress」（方案 C 单进行中约束）。默认 true。 */
  enforceSingleInProgress?: boolean;
}): TodoRuntime {
  const store = deps.store;
  const enforceSingleInProgress = deps.enforceSingleInProgress ?? true;

  /** 校验迁移合法，非法抛 ILLEGAL_TRANSITION。 */
  function assertTransition(from: TodoStatus, to: TodoStatus): void {
    if (!TODO_TRANSITIONS[from].includes(to)) {
      throw new TodoRuntimeError(
        'ILLEGAL_TRANSITION',
        `Illegal todo status transition ${from} → ${to}. Allowed: [${TODO_TRANSITIONS[from].join(', ') || 'terminal'}].`,
      );
    }
  }

  /** 依赖是否全部完成。 */
  function depsMet(todo: Todo): boolean {
    return todo.blockedBy.every((id) => store.getTodo(id)?.status === 'completed');
  }

  /** 该 todo 是否已 claim（claimedBy 非空 或 已是 in_progress）。 */
  function isClaimed(todo: Todo): boolean {
    return todo.claimedBy !== null && todo.claimedBy !== undefined;
  }

  function getReadyTodos(): Todo[] {
    return store.getAvailableTodos();
  }

  function inProgressIds(): string[] {
    return store.getTodosByStatus('in_progress').map((t) => t.id);
  }

  function getRuntimeState(): TodoRuntimeState {
    const pending = store.getTodosByStatus('pending');
    const inProgress = store.getTodosByStatus('in_progress');
    const ready = getReadyTodos();
    const readyIds = new Set(ready.map((t) => t.id));
    const blocked = pending.filter((t) => !readyIds.has(t.id));
    const pendingArchiveIds: string[] = [];
    const pendingRetryIds: string[] = [];
    const failed = store.getTodosByStatus('failed');
    const completed = store.getTodosByStatus('completed');
    const cancelled = store.getTodosByStatus('cancelled');

    // One Canvas 之后不再有内存归档队列；quiescent 只由 ready / in_progress 决定。
    const quiescent = ready.length === 0 && inProgress.length === 0;

    return {
      ready,
      inProgress,
      pending,
      blocked,
      failed,
      completed,
      cancelled,
      pendingArchiveIds,
      pendingRetryIds,
      quiescent,
      quiescenceReason: quiescent
        ? computeQuiescenceReason({
            failed: failed.length,
            blocked: blocked.length,
            convCount: store.getTodosByConversation(deps.conversationId).length,
          })
        : null,
    };
  }

  function isQuiescent(): boolean {
    return getReadyTodos().length === 0
      && store.getTodosByStatus('in_progress').length === 0;
  }

  /** 统一终局判定视图。requiresCompletionAudit 需调用方结合 goal/latch 计算，此处只给原始派生态。 */
  function getTaskFinishState(): TaskFinishState {
    const s = getRuntimeState();
    return {
      quiescent: s.quiescent,
      reason: s.quiescenceReason,
      requiresCompletionAudit: s.quiescent,
      pendingArchives: s.pendingArchiveIds,
      pendingRetries: s.pendingRetryIds,
      readyTodos: s.ready,
      inProgressTodos: s.inProgress,
    };
  }

  function claimTodo(todoId: string, execution: ExecutionInfo): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    // 已 claim（含 in_progress 重复 claim）→ ALREADY_CLAIMED，不静默覆盖
    if (isClaimed(todo)) {
      throw new TodoRuntimeError('ALREADY_CLAIMED', `ALREADY_CLAIMED: Todo ${todoId} is already claimed.`);
    }
    if (todo.status !== 'pending') {
      throw new TodoRuntimeError(
        'ILLEGAL_TRANSITION',
        `Illegal todo status transition: cannot claim a todo in status ${todo.status}; only pending can be claimed.`,
      );
    }
    if (!depsMet(todo)) {
      throw new TodoRuntimeError('DEPENDENCIES_UNMET', `DEPENDENCIES_UNMET: Todo ${todoId} is blocked by incomplete dependencies.`);
    }
    if (enforceSingleInProgress && !execution.allowParallel && inProgressIds().length > 0) {
      throw new TodoRuntimeError('TOO_MANY_IN_PROGRESS', 'TOO_MANY_IN_PROGRESS: Already one todo is in_progress; keep exactly one at a time.');
    }

    const agentId = execution.agentId;
    const result = store.claimTodo(todoId, agentId);
    if (!result.success || !result.todo) {
      // store 的 claim 也做满足性检查；此处做兜底映射
      const msg = result.message ?? '';
      if (/busy/i.test(msg)) throw new TodoRuntimeError('AGENT_BUSY', msg);
      if (/blocked by/i.test(msg)) throw new TodoRuntimeError('DEPENDENCIES_UNMET', msg);
      if (/already claimed/i.test(msg) || /not pending/i.test(msg)) {
        throw new TodoRuntimeError('ALREADY_CLAIMED', msg);
      }
      throw new TodoRuntimeError('ILLEGAL_TRANSITION', msg);
    }

    const executionMeta: TodoExecutionMeta = {
      agentId,
      mode: execution.mode,
      source: execution.source,
      startedAt: execution.startedAt ?? Date.now(),
    };
    const lifecycle = getLifecycle(result.todo);
    store.updateTodo({
      id: todoId,
      metadata: { execution: executionMeta, lifecycle: lifecycle },
    });
    logger.debug('TodoRuntime', `[claim] todoId=${todoId} agent=${agentId}`);
    return store.getTodo(todoId)!;
  }

  function completeTodo(todoId: string, result: string): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    assertTransition(todo.status, 'completed');

    const execution = getExecution(todo);
    const updatedExecution = { ...execution, finishedAt: Date.now() };
    store.updateTodo({
      id: todoId,
      status: 'completed',
      activeForm: null,
      metadata: { result, execution: updatedExecution },
    });
    logger.debug('TodoRuntime', `[complete] todoId=${todoId}`);
    return store.getTodo(todoId)!;
  }

  function failTodo(todoId: string, error: string, retryable = false): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    assertTransition(todo.status, 'failed');

    const execution = getExecution(todo);
    store.updateTodo({
      id: todoId,
      status: 'failed',
      activeForm: null,
      metadata: { error, execution: { ...execution, finishedAt: Date.now(), retryable } },
    });
    logger.debug('TodoRuntime', `[fail] todoId=${todoId}`);
    return store.getTodo(todoId)!;
  }

  function retryTodo(todoId: string): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    assertTransition(todo.status, 'pending');

    const lifecycle = getLifecycle(todo);
    const execution = getExecution(todo);
    store.updateTodo({
      id: todoId,
      status: 'pending',
      claimedBy: null,
      metadata: {
        error: undefined,
        lifecycle: { ...lifecycle, retries: (lifecycle.retries ?? 0) + 1 },
        execution: { ...execution, finishedAt: undefined, retryable: undefined },
      },
    });
    logger.debug('TodoRuntime', `[retry] todoId=${todoId}`);
    return store.getTodo(todoId)!;
  }

  function cancelTodo(todoId: string, reason?: string): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    assertTransition(todo.status, 'cancelled');

    const lifecycle = getLifecycle(todo);
    store.updateTodo({
      id: todoId,
      status: 'cancelled',
      activeForm: null,
      metadata: {
        stopReason: reason ?? todo.metadata?.stopReason,
        lifecycle: { ...lifecycle, cancelReason: reason ?? lifecycle.cancelReason },
      },
    });
    logger.debug('TodoRuntime', `[cancel] todoId=${todoId}${reason ? ` reason=${reason}` : ''}`);
    return store.getTodo(todoId)!;
  }

  return {
    getReadyTodos,
    getRuntimeState,
    isQuiescent,
    getTaskFinishState,
    claimTodo,
    completeTodo,
    failTodo,
    retryTodo,
    cancelTodo,
    store,
  };
}
