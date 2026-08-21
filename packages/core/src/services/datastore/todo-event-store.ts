// ============================================================
// SnapshotTodoStore — 事件化快照账本（docs/todos-lite.md §5.5）
// ============================================================
// 参照 pi（earendil-works/pi）的 todo 机制重构的存储核心：
//
// 传播方向（单向，主键坐标 = 会话 + seq）：
//   mutation ──(改内存副本)──> append 全量快照事件 ──> revision++ ──> emit TodoEvent
//   启动：取每会话最后一条 snapshot event → 重建内存快照（快照即全量，无需重放历史）
//
// 关键属性：
// - **全量快照事件**：每次 mutation 向事件日志追加一份该会话「完整」todos 快照；
//   不写增量、不做 diff、不覆盖旧事件——restore 后从最后一条推导出确定终态，
//   重复/漂移/多权威副本在结构上不存在（D1）。
// - **编号 = 创建时物化**：`number` 在 create 时分配（会话内 MAX+1），随快照持久化、
//   永不复用；模型面引用一律 `#N`（D2）。不再是派生位置。
// - **权威全量 / 展示紧凑**：事件表持全量；工具/画布默认看活跃（D3）。
// - 同一进程内单写者假设（docs/todos-lite.md §5.5）：并发写不保证事务串行。
//
// TodoStore 接口保持不动——所有现有调用方（runtime / 工具 / 面板 / downgrade）
// 无需感知内部已改为事件存储。

import { nanoid } from 'nanoid';
import type {
  Todo,
  TodoStore,
  TodoCreateInput,
  TodoUpdateInput,
  TodoClaimResult,
  TodoStatus,
  TodoEvent,
  TodoEventType,
  TodoEventListener,
} from '../../primitives/datastore/types';
import { logger } from '../../primitives/logger';

// ============================================================
// 事件模型
// ============================================================

/** 写方标签（审计用，不参与状态推导）。 */
export type TodoEventReason =
  | 'todo-tool'
  | 'agent-delegation'
  | 'approval'
  | 'run-downgrade'
  | 'api'
  | 'backfill'
  | 'clear'
  | 'test'
  | 'migration';

/** 一条持久化的快照事件（payload = 全量 todos 序列化）。 */
export interface TodoSnapshotEvent {
  /** 全局单调序号（内存 sink：自增；SQLite sink：AUTOINCREMENT 主键）。 */
  seq: number;
  conversationId: string;
  reason: TodoEventReason;
  /** JSON.stringify(Todo[]) 全量快照 */
  payload: string;
  createdAt: number;
  runId?: string | null;
}

/** 事件持久化后端：内存 sink 由本文件提供；SQLite sink 在 datastore/sqlite/todo-store.ts。 */
export interface TodoEventSink {
  /** 追加一条快照事件（不可变，仅追加）。 */
  append(event: Omit<TodoSnapshotEvent, 'seq'>): void;
  /** 返回全部已持久化事件（seq 升序）。启动重建用。 */
  loadAll(): TodoSnapshotEvent[];
}

// ============================================================
// 序列化
// ============================================================

export function serializeTodos(todos: Todo[]): string {
  return JSON.stringify(todos);
}

export function deserializeTodos(payload: string): Todo[] {
  return JSON.parse(payload) as Todo[];
}

// ============================================================
// 内存事件 sink（InMemory store 的后端，测试/单进程无持久化场景）
// ============================================================

export class MemoryTodoEventSink implements TodoEventSink {
  private events: TodoSnapshotEvent[] = [];
  private seq = 0;

  append(event: Omit<TodoSnapshotEvent, 'seq'>): void {
    this.events.push({ ...event, seq: ++this.seq });
    if (this.events.length > 1000) {
      // 仅限内存场景：避免测试期无限增长；SQLite 后端无此限制。
      this.events = this.events.slice(-500);
    }
  }

  loadAll(): TodoSnapshotEvent[] {
    return this.events;
  }
}

// ============================================================
// SnapshotTodoStore — 统一实现（InMemory 与 SQLite 共用）
// ============================================================

export class SnapshotTodoStore implements TodoStore {
  private todosById = new Map<string, Todo>();
  private byConversation = new Map<string, Todo[]>();
  private listeners = new Set<TodoEventListener>();
  private revision = 0;
  /** 下一条事件的写方标签（审计）。写方经 withTodoReason 设置；缺省 'todo-tool'。 */
  private writerReason: TodoEventReason = 'todo-tool';
  /**
   * 会话级编号高水位（D2「永不复用」）：create 时 +1，硬删除/clear 不回落。
   * 重建时以最后一条快照的最大编号为基座（快照内已含终态与取消行，编号天然保序）。
   */
  private nextNumberByConversation = new Map<string, number>();

  constructor(private sink: TodoEventSink) {
    this.rebuildFromSink();
  }

  /** 供 withTodoReason 使用的写方标签注入点（不在 TodoStore 接口内）。 */
  setWriterReason(reason: TodoEventReason): void {
    this.writerReason = reason;
  }

  getWriterReason(): TodoEventReason {
    return this.writerReason;
  }

  getRevision(): number {
    return this.revision;
  }

  // ============================================================
  // 内存快照：重建 / 提交
  // ============================================================

  /**
   * 启动重建：每会话取**最后一条**快照事件（快照即全量，无需重放历史）。
   * revision 基座 = 已持久化事件的 max seq（单调，跨重启不回落）。
   */
  private rebuildFromSink(): void {
    const lastByConv = new Map<string, TodoSnapshotEvent>();
    let maxSeq = 0;
    for (const ev of this.sink.loadAll()) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      lastByConv.set(ev.conversationId, ev);
    }
    this.todosById.clear();
    this.byConversation.clear();
    this.nextNumberByConversation.clear();
    for (const ev of lastByConv.values()) {
      const todos = deserializeTodos(ev.payload);
      this.byConversation.set(ev.conversationId, todos);
      for (const t of todos) this.todosById.set(t.id, t);
      // 高水位 = 快照内最大编号 + 1（终态/取消行占号，重建后 continue 不再复用）
      this.nextNumberByConversation.set(
        ev.conversationId,
        todos.reduce((m, t) => Math.max(m, t.number), 0) + 1,
      );
    }
    this.revision = maxSeq;
  }

  /** 提交：把某会话当前全量快照 append 为一条事件 + revision++。 */
  private commit(conversationId: string, emits: Array<{ type: TodoEventType; todo: Todo; metadata?: Record<string, unknown> }>): void {
    const todos = this.byConversation.get(conversationId) ?? [];
    this.sink.append({
      conversationId,
      reason: this.writerReason,
      payload: serializeTodos(todos),
      createdAt: Date.now(),
    });
    this.revision++;
    for (const e of emits) this.emit(e.type, e.todo, e.metadata);
  }

  // ============================================================
  // TodoStore 实现
  // ============================================================

  createTodo(input: TodoCreateInput): Todo {
    const now = Date.now();
    const id = `todo-${nanoid(8)}`;

    const blockedBy = input.blockedBy ?? [];
    const existing = this.byConversation.get(input.conversationId) ?? [];

    // blockedBy 项必须存在且同会话
    for (const depId of blockedBy) {
      const dep = this.todosById.get(depId);
      if (!dep) {
        throw new Error(`BlockedBy todo ${depId} does not exist`);
      }
      if (dep.conversationId !== input.conversationId) {
        throw new Error(`Cannot create dependency across conversations`);
      }
    }

    // 编号创建时物化：高水位 +1，永不复用（D2）——硬删除/clear 不回落。
    const number = this.nextNumberByConversation.get(input.conversationId) ?? 1;
    this.nextNumberByConversation.set(input.conversationId, number + 1);

    const todo: Todo = {
      id,
      number,
      conversationId: input.conversationId,
      subject: input.subject,
      status: 'pending',
      claimedBy: null,
      activeForm: null,
      blockedBy,
      blocks: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      metadata: input.metadata ?? {},
    };

    // blockedBy 父项写回 blocks 逆索引
    for (const depId of blockedBy) {
      const parent = this.todosById.get(depId)!;
      parent.blocks = [...parent.blocks, id];
    }

    this.todosById.set(id, todo);
    this.byConversation.set(input.conversationId, [...existing, todo]);
    this.commit(input.conversationId, [{ type: 'todo:created', todo }]);

    return todo;
  }

  getTodo(id: string): Todo | undefined {
    return this.todosById.get(id);
  }

  getAllTodos(): Todo[] {
    return Array.from(this.todosById.values());
  }

  getTodosByConversation(conversationId: string): Todo[] {
    return (this.byConversation.get(conversationId) ?? []).slice();
  }

  updateTodo(input: TodoUpdateInput): Todo | undefined {
    const todo = this.todosById.get(input.id);
    if (!todo) return undefined;

    const oldStatus = todo.status;
    const now = Date.now();

    // blockedBy 变更：从旧父项解挂、向新父项挂接（校验新项存在）
    if (input.blockedBy !== undefined) {
      for (const oldDepId of todo.blockedBy) {
        const oldParent = this.todosById.get(oldDepId);
        if (oldParent) oldParent.blocks = oldParent.blocks.filter((b) => b !== todo.id);
      }
      for (const newDepId of input.blockedBy) {
        const newParent = this.todosById.get(newDepId);
        if (!newParent) {
          throw new Error(`BlockedBy todo ${newDepId} does not exist`);
        }
        if (!newParent.blocks.includes(todo.id)) newParent.blocks.push(todo.id);
      }
      todo.blockedBy = input.blockedBy;
    }

    const wasActive = todo.status === 'in_progress';
    if (input.status !== undefined) todo.status = input.status;
    if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
      todo.completedAt = now;
      todo.claimedBy = null;
    }
    if (input.subject !== undefined) todo.subject = input.subject;
    if (input.activeForm !== undefined) todo.activeForm = input.activeForm;
    if (input.claimedBy !== undefined) todo.claimedBy = input.claimedBy;
    if (input.metadata !== undefined) todo.metadata = { ...todo.metadata, ...input.metadata };
    todo.updatedAt = now;

    const emits: Array<{ type: TodoEventType; todo: Todo; metadata?: Record<string, unknown> }> = [
      { type: 'todo:updated', todo },
    ];
    if (input.status !== undefined && input.status !== oldStatus) {
      switch (input.status) {
        case 'completed':
          emits.push({ type: 'todo:completed', todo });
          break;
        case 'failed':
          emits.push({ type: 'todo:failed', todo });
          break;
        case 'cancelled':
          emits.push({ type: 'todo:cancelled', todo });
          break;
      }
    }

    this.commit(todo.conversationId, emits);
    return todo;
  }

  deleteTodo(id: string): boolean {
    const todo = this.todosById.get(id);
    if (!todo) return false;

    // 从 blockedBy 父项解挂
    for (const depId of todo.blockedBy) {
      const parent = this.todosById.get(depId);
      if (parent) parent.blocks = parent.blocks.filter((b) => b !== id);
    }
    // 下游依赖者移除对该项的 blockedBy
    for (const depId of todo.blocks) {
      const dep = this.todosById.get(depId);
      if (dep) dep.blockedBy = dep.blockedBy.filter((b) => b !== id);
    }

    this.todosById.delete(id);
    const conv = (this.byConversation.get(todo.conversationId) ?? []).filter((t) => t.id !== id);
    this.byConversation.set(todo.conversationId, conv);

    this.commit(todo.conversationId, [{ type: 'todo:deleted', todo }]);
    return true;
  }

  claimTodo(todoId: string, agentId: string): TodoClaimResult {
    const todo = this.todosById.get(todoId);
    if (!todo) {
      return { success: false, message: `Todo ${todoId} not found` };
    }
    // 账本语义：claim = 标注 in_progress + 记录执行者（展示），不做任何 gate
    // （不查 busy、不要求 pending、不判依赖、不拒重复认领），见 docs/todos-lite.md §3.4。
    todo.claimedBy = agentId;
    todo.status = 'in_progress';
    todo.updatedAt = Date.now();

    this.commit(todo.conversationId, [{ type: 'todo:claimed', todo, metadata: { agentId } }]);
    return { success: true, todo };
  }

  getAvailableTodos(): Todo[] {
    return this.getAllTodos().filter((todo) => {
      if (todo.status !== 'pending') return false;
      if (todo.claimedBy) return false;
      return todo.blockedBy.every((b) => this.todosById.get(b)?.status === 'completed');
    });
  }

  getTodosByStatus(status: TodoStatus): Todo[] {
    return this.getAllTodos().filter((t) => t.status === status);
  }

  getTodosByAgent(agentId: string): Todo[] {
    return this.getAllTodos().filter((t) => t.claimedBy === agentId);
  }

  getBlockingTodos(todoId: string): Todo[] {
    const todo = this.todosById.get(todoId);
    if (!todo) return [];
    return todo.blocks.map((id) => this.todosById.get(id)).filter((t): t is Todo => t !== undefined);
  }

  getBlockedByTodos(todoId: string): Todo[] {
    const todo = this.todosById.get(todoId);
    if (!todo) return [];
    return todo.blockedBy.map((id) => this.todosById.get(id)).filter((t): t is Todo => t !== undefined);
  }

  subscribe(listener: TodoEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clearAllTodos(): void {
    // 每会话 append 一条空快照（重建后为空），保留历史事件。
    for (const convId of Array.from(this.byConversation.keys())) {
      if ((this.byConversation.get(convId) ?? []).length === 0) continue;
      this.byConversation.set(convId, []);
      this.sink.append({
        conversationId: convId,
        reason: 'clear',
        payload: '[]',
        createdAt: Date.now(),
      });
      this.revision++;
    }
    this.todosById.clear();
  }

  // ============================================================
  // 事件广播（接口兼容；与旧 store 行为一致）
  // ============================================================

  private emit(type: TodoEventType, todo: Todo, metadata?: Record<string, unknown>): void {
    const event: TodoEvent = { type, todo, timestamp: Date.now(), metadata };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('SnapshotTodoStore', 'Error in todo event listener:', error);
      }
    }
  }
}

/**
 * 在写方标签下执行一段 todo 变更，供事件审计标 reason。
 * 例：withTodoReason(store, 'run-downgrade', () => downgradeUnsettledInProgress(...))
 * store 非 SnapshotTodoStore 时降级为直接调用（reason 恒为默认）。
 */
export function withTodoReason<T>(store: TodoStore, reason: TodoEventReason, fn: () => T): T {
  if (store instanceof SnapshotTodoStore) {
    const prev = store.getWriterReason();
    store.setWriterReason(reason);
    try {
      return fn();
    } finally {
      store.setWriterReason(prev);
    }
  }
  return fn();
}

/**
 * 创建内存后端快照 store（测试/无持久化场景）。
 * 签名与旧 createTodoStore 兼容（忽略 hwm 参数；编号不再依赖 HWM）。
 */
export function createTodoStore(_hwm?: unknown): SnapshotTodoStore {
  return new SnapshotTodoStore(new MemoryTodoEventSink());
}