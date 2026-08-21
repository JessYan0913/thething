import type { TodoStore, Todo, TodoStatus, TodoMetadata } from './types';

/**
 * TodoRuntime — Todo Runtime（轻量化账本，docs/todos-lite.md）。
 *
 * 定调：系统只记、不判（I2）。模型决定「做什么、何时做、是否完成」；
 * 本模块只负责把模型声明的状态变化**原样写入**，不做任何闸门/合法性判断。
 * - 不校验迁移是否合法（pending→completed 直通、终态→active 重开都允许）；
 * - 不做单进行中约束、不判依赖、不查认领冲突、不读 agent busy；
 * - 只保留一致性收尾：run 结束时把未落账的 in_progress 回卷（见 run-finalization）。
 *
 * READY / blocked / quiescent 仍派生（读视图），但只退化为**展示/lint 建议**，不进任何 gate。
 * Quiescent ≠ Goal 完成：isQuiescent() 只表示「没有正在运行的 runtime work」。
 */
import { logger } from '../../primitives/logger';

/**
 * 状态迁移矩阵 —— 仅作**参考资料**（lint 建议 / 文档），**不执行**。
 * 账本模型下系统允许任意迁移（含终态→active 重开），见 docs/todos-lite.md §3.1。
 */
export const TODO_TRANSITIONS: Record<TodoStatus, readonly TodoStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  failed: ['pending', 'cancelled'],
  completed: [], // 参考：终态无出边（但系统不再强制）
  cancelled: [], // 参考：终态无出边（但系统不再强制）
};

/** 执行模式（模型选择，系统只记录）。 */
export type ExecutionMode = 'main_agent' | 'agent' | 'parallel_agent';

/**
 * Quiescent 的原因 —— 账本语义（docs/todos-lite.md §4「收尾信号」）：
 * `quiescent = 不存在 status ∈ {pending, in_progress, failed} 的项`（一个查询）。
 * ready/blocked 派生只退化为展示/lint，不再参与收尾判定。
 * - completed_candidate：会话内有 todo 且全部 terminal（无 pending/in_progress/failed）。
 * - no_work：会话内根本没有 todo（空会话）。
 * - null：非 quiescent（还有未办/在办/失败待处理的活）。
 */
export type QuiescenceReason = 'completed_candidate' | 'no_work';

/** 谁/什么在执行一个 todo（写入 metadata.execution） */
export interface ExecutionInfo {
  agentId: string;
  mode?: ExecutionMode;
  source?: string;
  startedAt?: number;
  /** 并行路径：历史字段，仅记录不再 gate（单进行中门已拆除）。 */
  allowParallel?: boolean;
}

/** 账本层不再有闸门性失败；仅保留 NOT_FOUND（引用不存在的 todo）。 */
export type TransitionError = 'NOT_FOUND';

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
 * 计算 quiescent 的原因（纯函数）。仅在 quiescent 时调用（调用方保证没有
 * pending/in_progress/failed）。completed_candidate 与 no_work 的区分依赖会话内 todo 总数：
 * - 会话为空（无任何 todo）→ no_work；
 * - 会话非空且全 terminal → completed_candidate。
 */
export function computeQuiescenceReason(args: {
  convCount: number;
}): QuiescenceReason {
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
}): TodoRuntime {
  const store = deps.store;

  function getReadyTodos(): Todo[] {
    return store.getAvailableTodos();
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

    // One Canvas 之后不再有内存归档队列。收尾信号（docs/todos-lite.md §4）：
    // quiescent = 不存在 {pending, in_progress, failed} 的项（一个查询）。
    // ready/blocked 仍保留为展示/lint 视图，不再参与收尾判定。
    const quiescent = pending.length === 0 && inProgress.length === 0 && failed.length === 0;

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
            convCount: store.getTodosByConversation(deps.conversationId).length,
          })
        : null,
    };
  }

  function isQuiescent(): boolean {
    return store.getTodosByStatus('pending').length === 0
      && store.getTodosByStatus('in_progress').length === 0
      && store.getTodosByStatus('failed').length === 0;
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
    // 账本语义：claim = 「标注 in_progress + 记录执行者（展示）」，不做任何 gate。
    // 重复 claim / 依赖未完成 / 跨会话并存在途项 都不再阻塞（docs/todos-lite.md §3.3-3.4）。
    const agentId = execution.agentId;
    const executionMeta: TodoExecutionMeta = {
      agentId,
      mode: execution.mode,
      source: execution.source,
      startedAt: execution.startedAt ?? Date.now(),
    };
    const lifecycle = getLifecycle(todo);
    const updated = store.updateTodo({
      id: todoId,
      status: 'in_progress',
      claimedBy: agentId,
      metadata: { execution: executionMeta, lifecycle: lifecycle },
    });
    logger.debug('TodoRuntime', `[claim] todoId=${todoId} agent=${agentId}`);
    return updated ?? todo;
  }

  function completeTodo(todoId: string, result: string): Todo {
    const todo = store.getTodo(todoId);
    if (!todo) {
      throw new TodoRuntimeError('NOT_FOUND', `Todo ${todoId} not found`);
    }
    // 账本语义：模型声明完成即写完成，不校验是否经 in_progress（pending→completed 直通，§3.1）。
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
    // 账本：模型声明失败即写，不校验是否 in_progress。
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
    // 重开：failed/cancelled/completed → 回 pending（终态→active 重开允许）。
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
    // 账本：模型声明放弃即写，不校验阶段。
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
