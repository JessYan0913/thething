/**
 * In-memory TodoStore — 事件化快照账本（事件落内存，见 services/datastore/todo-event-store.ts）。
 *
 * 旧版（HighWaterMark id + 每方法增量写）已废弃：编号改为创建时物化的 `#N`、
 * 状态以「全量快照事件」为唯一持久化，内存为该 store 实例的唯一权威。
 * 接口与旧版完全一致（createTodoStore / InMemoryTodoStore 均零参构造），调用方无需改动。
 */
import { SnapshotTodoStore, MemoryTodoEventSink } from '../../services/datastore/todo-event-store';
import type { TodoEventSink } from '../../services/datastore/todo-event-store';

export { SnapshotTodoStore, MemoryTodoEventSink } from '../../services/datastore/todo-event-store';
export type { TodoEventSink } from '../../services/datastore/todo-event-store';

/** In-memory 事件化快照 store（测试/会话内运行默认）。 */
export class InMemoryTodoStore extends SnapshotTodoStore {
  constructor(sink?: TodoEventSink) {
    super(sink ?? new MemoryTodoEventSink());
  }
}

/** 创建一个内存后端事件化快照 store。签名与旧 createTodoStore 兼容（hwm 参数已废弃忽略）。 */
export function createTodoStore(_hwm?: unknown): InMemoryTodoStore {
  return new InMemoryTodoStore();
}