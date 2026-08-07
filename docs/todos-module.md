# todos 模块职责说明

`packages/core/src/modules/todos` — Todo 管理系统核心模块。

该模块实现了一个完整的 Todo 生命周期管理，支持依赖关系、Agent 认领、状态机流转与事件订阅，并以 **AI SDK Tool** 的形式暴露给 LLM 调用。

---

## 1. 目录结构总览

```
packages/core/src/modules/todos/
├── index.ts               # 模块入口，统一聚合导出
├── types.ts               # 类型 re-export + 运行时常量/配置
├── store.ts               # TodoStore 内存实现（存储 + 事件）
├── high-water-mark.ts     # 自增 ID 生成器
├── todo-create.ts         # 创建操作
├── todo-update.ts         # 更新 & 状态机操作
├── todo-delete.ts         # 删除操作（软删 + 级联）
├── todo-claim.ts          # 认领 / 释放操作
├── todo-available.ts      # 可用性查询
├── todo-tools/            # AI SDK Tool 封装层
│   ├── index.ts           # 工具聚合 / 工厂 / 名称表
│   ├── todo-create-tool.ts
│   ├── todo-batch-create-tool.ts
│   ├── todo-update-tool.ts
│   ├── todo-delete-tool.ts
│   ├── todo-list-tool.ts
│   ├── todo-get-tool.ts
│   ├── todo-write-tool.ts
│   └── todo-snapshot.ts
└── __tests__/             # 模块测试
```

模块按 **分层** 组织，自底向上为：

| 层 | 位置 | 职责 |
|----|------|------|
| 数据层（primitive） | `../../primitives/datastore/types` | 定义 `Todo` / `TodoStatus` / `TodoStore` 等核心类型 |
| 存储实现层 | `store.ts` | 实现 `TodoStore` 接口（内存存储 + 事件分发） |
| 操作层 | `todo-*.ts` | 纯函数 CRUD / 状态机 / 认领 / 查询 |
| 工具层 | `todo-tools/*.ts` | 用 `ai.tool()` + zod 封装，供 LLM 调用 |
| 渲染层 | `todo-tools/todo-snapshot.ts` | 生成紧凑文本快照（供 ContextInjector 注入上下文） |

---

## 2. 各文件职责

### 2.1 `index.ts` — 模块入口
模块的**统一出口**，聚合导出全部对外 API：
- 类型（`./types`）
- 存储：`InMemoryTodoStore`、`createTodoStore`
- ID 生成：`HighWaterMarkImpl`、`getGlobalHighWaterMark` 等
- 所有操作层函数
- 所有工具层函数与工具名/描述

文件头部注释给出了完整使用示例（创建 → 认领 → 完成 → 查询可用项）。

### 2.2 `types.ts` — 类型与常量
- **Re-export 核心类型**（从 `../../primitives/datastore/types`）：`TodoStatus`、`TodoPriority`、`TodoMetadata`、`Todo`、`TodoCreateInput`、`TodoUpdateInput`、`TodoClaimResult`、`TodoStore`、`AgentStatus`、`TodoEvent`、`TodoEventListener`、`TodoEventType`。
- **常量**：`TODO_ID_PREFIX`（Todo ID 前缀，默认为空）。
- **运行时专属类型**：`TodoListResult`（可用 Todo 列表结果）、`HighWaterMark`（ID 生成器接口）。
- **状态配置**：`STATUS_CONFIG`，将 `TodoStatus` 映射到 `{ label, color, icon }`（供 UI 展示）。

### 2.3 `store.ts` — 内存存储实现
实现 `TodoStore` 接口，是模块的**数据底座**：
- `InMemoryTodoStore` 类：核心存储，以 `Map` 保存 Todo 与 Agent 状态。
  - **CRUD**：`createTodo` / `getTodo` / `getAllTodos` / `getTodosByConversation` / `updateTodo` / `deleteTodo`
  - **状态**：`getRevision`（修订号）、`setAgentBusy` / `getAgentStatus`
  - **依赖**：`getBlockingTodos`（被谁阻塞） / `getBlockedByTodos`（阻塞谁），内部 `unblockDependents` 在完成/删除时解除依赖
  - **认领**：`claimTodo`（含 Agent busy 校验）
  - **查询**：`getAvailableTodos` / `getTodosByStatus` / `getTodosByAgent`
  - **事件**：`subscribe`（返回取消订阅函数）、`emit` / `emitTodoEvent`（内部事件分发）
  - `clearAllTodos`：清空存储
- `createTodoStore(hwm?)`：工厂函数，可选传入 `HighWaterMarkImpl`，返回 `TodoStore`。

### 2.4 `high-water-mark.ts` — ID 生成器
- `HighWaterMarkImpl`：实现 `HighWaterMark` 接口，基于单调递增计数生成唯一数字 ID。
- `parseTodoId(id)`：从 Todo ID 解析出数字部分。
- `createHighWaterMarkFromIds(ids)`：从已有 ID 集合重建（取最大值为起点，避免冲突）。
- 全局单例：`getGlobalHighWaterMark` / `setGlobalHighWaterMark` / `resetGlobalHighWaterMark`。

### 2.5 操作层（纯函数，均以 `TodoStore` 为首参）

**`todo-create.ts` — 创建**
- `createTodo(store, input)`：创建单个 Todo
- `createTodos(store, inputs)`：批量创建
- `createTodoWithDependencies(store, ...)`：创建并附加依赖关系

**`todo-update.ts` — 更新 / 状态机**
- `updateTodo` / `updateTodoStatus`：通用更新
- `setTodoActiveForm` / `clearTodoActiveForm`：活动状态文案
- `completeTodo` / `failTodo` / `stopTodo` / `retryTodo`：状态机流转（完成会解除依赖、失败标记、停止、重试回到 pending）

**`todo-delete.ts` — 删除**
- `deleteTodo` / `deleteTodos`：删除（软删除）
- `deleteTodoWithDependents`：级联删除其依赖项，返回被删 ID 列表
- `removeTodoDependencies`：移除依赖关系

**`todo-claim.ts` — 认领 / 释放**
- `claimTodo(store, todoId, agentId)`：认领（含 busy 校验，返回 `TodoClaimResult`）
- `unclaimTodo` / `forceClaimTodo`：释放 / 强制认领
- `getTodoClaimant` / `isTodoClaimed`：查询认领者 / 是否被认领

**`todo-available.ts` — 可用性查询**
- `getAvailableTodos` / `getAvailableTodosSorted` / `getNextAvailableTodo`：可执行 Todo（依赖已满足、未被认领）
- `getTodosByStatus` / `getAllPendingTodos` / `getAllInProgressTodos` / `getAllCompletedTodos` / `getAllFailedTodos` / `getTodosGroupedByStatus`：按状态筛选
- `getTodoListResult`：组合结果（含依赖信息）
- `findTodosBySubject` / `findTodoBySubject`：按标题搜索

### 2.6 工具层 `todo-tools/` — AI SDK Tool 封装

**`index.ts`** — 工具聚合与工厂：
- `TodoTools` 接口：一个工具集合对象
- `createTodoTools(store)`：为全局场景创建全部工具
- `createTodoToolsForConversation(store, conversationId)`：**为指定会话**创建工具（数据按会话隔离）
- `TODO_TOOL_NAMES` / `TODO_TOOL_DESCRIPTIONS` / `TodoToolName`：工具名与描述注册表
- `getTodoTool` / `getTodoToolNames`：按名取工具 / 列工具名
- 统一 re-export 各 `create*Tool` 工厂及 `*ToolSchema`。

**各工具文件**（`todo-create-tool.ts`、`todo-batch-create-tool.ts`、`todo-update-tool.ts`、`todo-delete-tool.ts`、`todo-list-tool.ts`、`todo-get-tool.ts`、`todo-write-tool.ts`）：
- 每个文件用 `ai.tool()` + zod 定义**输入 schema**（`todoXxxToolSchema`），并导出工具工厂。
- 命名约定：`createXxxTool(store)` 与 `createXxxToolForConversation(store, conversationId)` 两种工厂，后者绑定会话。
- 职责对照：
  - `todo-create-tool`：创建单个 Todo
  - `todo-batch-create-tool`：批量创建（含依赖）
  - `todo-update-tool`：更新状态/文案
  - `todo-delete-tool`：删除（可级联）
  - `todo-list-tool`：列出可用/全部 Todo
  - `todo-get-tool`：查询单个 Todo 详情
  - `todo-write-tool`：综合写入（仅会话版）

**`todo-snapshot.ts` — 渲染层**
- `buildCompactTaskSnapshot(todos, store)`：把 Todo 列表渲染成**紧凑文本快照**（含依赖/认领信息），供上下文注入器使用。

---

## 3. 核心数据模型与状态机

模块 re-export 的核心类型定义在 `../../primitives/datastore/types`，本模块负责组织业务逻辑。

**Todo 生命周期状态机**：
```
pending ──claim──▶ in_progress ──complete──▶ completed
   │                    │
   │                    ├──fail──────▶ failed
   │                    └──stop──────▶ (回退)
   └────retry────────────────────────▶ pending 可重试
```

**依赖模型**：Todo 通过 `blockedBy` / `blocks` 构成**双向链表**，只有依赖全部满足时才 `available`，完成/删除时自动 `unblockDependents`。

**Agent 认领模型**：`claimTodo` 前校验 Agent 是否 busy（`AgentStatus`），防止同一 Agent 并发认领多个任务。

**事件模型**：`store.subscribe(listener)` 订阅 `TodoEvent`，状态变更时触发，返回取消订阅函数。

---

## 4. 设计要点总结

1. **数据与逻辑分离**：类型（primitives）→ 存储实现（store）→ 业务操作（todo-*.ts）→ 工具适配（todo-tools）层层解耦。
2. **纯函数操作层**：所有业务函数以 `TodoStore` 为显式依赖，易于测试与替换存储实现。
3. **会话隔离**：提供 `ForConversation` 版本的存储与工具，支持多会话数据隔离。
4. **LLM 友好**：通过 AI SDK `tool()` 暴露能力，附完整 schema 与描述，供模型自主编排。
5. **唯一 ID**：用高水位线（HighWaterMark）保证单调递增、全局唯一。

---

## 5. 相关测试

`__tests__/` 目录包含：
- `todos.test.ts`：模块核心逻辑测试
- `todo-write-tool.test.ts`：`todo-write-tool` 工具测试

（文档基于对源码的静态分析编写，测试覆盖项以实际文件为准。）
