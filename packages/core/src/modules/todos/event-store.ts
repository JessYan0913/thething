/**
 * 事件化快照 store 的模块面入口。
 *
 * 实现位于 services/datastore/todo-event-store.ts（层依赖：services 可被 modules 引用，
 * sqlite store 也复用同层实现）；此处仅做再导出，保持模块面路径不变
 * （docs/todos-lite.md §5.5 的 SnapshotTodoStore 统一实现）。
 */
export {
  SnapshotTodoStore,
  MemoryTodoEventSink,
  createTodoStore,
  withTodoReason,
  serializeTodos,
  deserializeTodos,
} from '../../services/datastore/todo-event-store';
export type {
  TodoEventSink,
  TodoSnapshotEvent,
  TodoEventReason,
} from '../../services/datastore/todo-event-store';