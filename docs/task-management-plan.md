# 任务管理系统设计方案

> 基于 Claude Code 任务管理系统哲学的设计方案

## 目录

- [1. 背景与动机](#1-背景与动机)
- [2. 数据模型设计](#2-数据模型设计)
- [3. 核心功能实现](#3-核心功能实现)
- [4. 与 Sub-Agent 系统的集成](#4-与-sub-agent-系统的集成)
- [5. 与 Claude Code 的差异对照](#5-与-claude-code-的差异对照)
- [6. 实施路线图](#6-实施路线图)
- [7. UI 组件设计](#7-ui-组件设计)
  - [7.1 组件选型](#71-组件选型)
  - [7.2 TaskPanel 组件设计](#72-taskpanel-组件设计)
  - [7.3 任务状态展示](#73-任务状态展示)
  - [7.4 任务操作](#74-任务操作)
  - [7.5 依赖关系可视化](#75-依赖关系可视化)

---

## 6. 实施路线图

### Phase 1：核心骨架（Week 1）

**目标**：实现任务管理核心功能

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| Task 类型定义 | `tasks/types.ts` | 1h | 无 |
| TaskStore 接口 | `tasks/store.ts` | 1h | types |
| HighWaterMark | `tasks/high-water-mark.ts` | 1h | 无 |
| TaskCreate | `tasks/task-create.ts` | 2h | store |
| TaskUpdate | `tasks/task-update.ts` | 2h | store |
| TaskDelete | `tasks/task-delete.ts` | 1.5h | store |
| claimTask | `tasks/task-claim.ts` | 2h | store |
| getAvailableTasks | `tasks/task-available.ts` | 1h | store |
| **总计** | | **~11.5h** | |

**验收标准**：
- [ ] 所有类型通过 TypeScript 编译
- [ ] claimTask 忙碌检查测试通过
- [ ] 双向链表维护测试通过
- [ ] 高水位标记测试通过

### Phase 2：工具实现（Week 2）

**目标**：实现 Task 工具集

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| TaskCreateTool | `tasks/tools/task-create-tool.ts` | 1.5h | Phase 1 |
| TaskListTool | `tasks/tools/task-list-tool.ts` | 1.5h | Phase 1 |
| TaskUpdateTool | `tasks/tools/task-update-tool.ts` | 2h | Phase 1 |
| TaskGetTool | `tasks/tools/task-get-tool.ts` | 1.5h | Phase 1 |
| TaskStopTool | `tasks/tools/task-stop-tool.ts` | 1.5h | Phase 1 |
| 工具注册表 | `tasks/tools/index.ts` | 0.5h | all |
| **总计** | | **~8.5h** | |

**验收标准**：
- [ ] 所有工具通过类型检查
- [ ] 工具执行测试通过
- [ ] 错误处理测试通过

### Phase 3：Sub-Agent 集成（Week 3）

**目标**：与 Sub-Agent 系统深度集成 + UI 组件实现

| 任务 | 文件 | 工作量 | 依赖 |
|-----|------|-------|------|
| Task 状态同步 | `subagents/task-sync.ts` | 2h | Phase 1-2 |
| 自动调度器 | `subagents/task-scheduler.ts` | 3h | Phase 1-2 |
| TaskPanel 组件 | `components/task-panel.tsx` | 2h | ai-elements |
| TaskDialogs 组件 | `components/task-dialogs.tsx` | 1.5h | ai-elements |
| 依赖关系可视化 | `components/task-dependency-tree.tsx` | 1.5h | Phase 1 |
| 任务操作集成 | `components/task-panel-with-dialogs.tsx` | 1h | above |
| 端到端测试 | `tests/e2e/task-flow.test.ts` | 3h | Phase 1-2 |
| **总计** | | **~14h** | |

**验收标准**：
- [ ] Task 状态与 Sub-Agent 执行同步
- [ ] 自动调度测试通过
- [ ] UI 组件正常显示任务列表
- [ ] 任务操作（claim/complete/stop）正常工作

### 总工作量

| Phase | 时间 | 工作量 | 关键产出 |
|-------|------|-------|---------|
| Phase 1 | Week 1 | ~11.5h | 核心骨架 |
| Phase 2 | Week 2 | ~8.5h | 工具集 |
| Phase 3 | Week 3 | ~14h | Sub-Agent 集成 + UI |
| **总计** | **3 weeks** | **~34h** | **完整系统** |

---

## 7. UI 组件设计

### 7.1 组件选型

选用 [ai-elements](https://elements.ai-sdk.dev/components/queue) 的 `Queue` 组件作为任务管理 UI 的基础组件，原因如下：

| 需求 | Queue 组件支持 |
|-----|---------------|
| 任务列表展示 | `QueueList` + `QueueItem` ✅ |
| 状态指示 | `QueueItemIndicator` (completed 样式) ✅ |
| 标题/描述 | `QueueItemContent` + `QueueItemDescription` ✅ |
| 可折叠分组 | `QueueSection` ✅ |
| 操作按钮 | `QueueItemActions` ✅ |
| 附件/图片 | `QueueItemImage` + `QueueItemFile` ✅ |
| 滚动区域 | `QueueList` 内置 ScrollArea ✅ |

#### 安装依赖

```bash
pnpm add ai-elements
```

### 7.2 TaskPanel 组件设计

```typescript
// src/components/task-panel.tsx

import * as UI from 'ai-elements';
import type { Task } from '@/lib/tasks/types';

interface TaskPanelProps {
  tasks: Task[];
  onClaim: (taskId: string) => void;
  onComplete: (taskId: string, result?: string) => void;
  onStop: (taskId: string, reason?: string) => void;
  onDelete: (taskId: string) => void;
}

export function TaskPanel({
  tasks,
  onClaim,
  onComplete,
  onStop,
  onDelete,
}: TaskPanelProps) {
  // 按状态分组
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const failedTasks = tasks.filter(t => t.status === 'failed');

  return (
    <UI.Queue className="w-full max-w-2xl">
      {/* 进行中的任务 */}
      <TaskSection
        icon={<Spinner className="h-4 w-4 animate-spin" />}
        label="In Progress"
        count={inProgressTasks.length}
        tasks={inProgressTasks}
        actions={[
          { label: 'Complete', onClick: onComplete },
          { label: 'Stop', onClick: onStop },
        ]}
      />

      {/* 待处理任务 */}
      <TaskSection
        icon={<Clock className="h-4 w-4" />}
        label="Pending"
        count={pendingTasks.length}
        tasks={pendingTasks}
        actions={[{ label: 'Claim', onClick: onClaim }]}
        showBlockedBy
      />

      {/* 已完成的任务 */}
      <TaskSection
        icon={<CheckCircle className="h-4 w-4 text-green-500" />}
        label="Completed"
        count={completedTasks.length}
        tasks={completedTasks}
        defaultOpen={false}
      />

      {/* 失败的任务 */}
      {failedTasks.length > 0 && (
        <TaskSection
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          label="Failed"
          count={failedTasks.length}
          tasks={failedTasks}
          defaultOpen={false}
          actions={[{ label: 'Retry', onClick: onClaim }]}
        />
      )}
    </UI.Queue>
  );
}

/**
 * 任务分组组件
 */
interface TaskSectionProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  tasks: Task[];
  defaultOpen?: boolean;
  actions?: { label: string; onClick: (taskId: string) => void }[];
  showBlockedBy?: boolean;
}

function TaskSection({
  icon,
  label,
  count,
  tasks,
  defaultOpen = true,
  actions = [],
  showBlockedBy = false,
}: TaskSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <UI.QueueSection defaultOpen={defaultOpen}>
      <UI.QueueSectionTrigger>
        <UI.QueueSectionLabel icon={icon} count={count} label={label} />
      </UI.QueueSectionTrigger>
      <UI.QueueSectionContent>
        <UI.QueueList>
          {tasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              actions={actions}
              showBlockedBy={showBlockedBy}
            />
          ))}
        </UI.QueueList>
      </UI.QueueSectionContent>
    </UI.QueueSection>
  );
}
```

### 7.3 任务状态展示

#### 7.3.1 状态图标映射

```typescript
const STATUS_CONFIG = {
  pending: {
    icon: '○',  // 空心圆圈
    color: 'text-gray-400',
    indicator: false,  // QueueItemIndicator 的 completed 属性
  },
  in_progress: {
    icon: '◐',  // 半满圆圈（可用旋转动画）
    color: 'text-blue-500',
    indicator: false,
    animation: 'animate-spin',
  },
  completed: {
    icon: '●',  // 实心圆圈
    color: 'text-green-500',
    indicator: true,  // 显示为已完成样式
  },
  failed: {
    icon: '✕',  // X 标记
    color: 'text-red-500',
    indicator: false,
  },
  cancelled: {
    icon: '⊘',  // 取消标记
    color: 'text-gray-400',
    indicator: false,
  },
} as const;
```

#### 7.3.2 任务项渲染

```typescript
// src/components/task-panel.tsx (续)

/**
 * 单个任务项组件
 */
interface TaskItemProps {
  task: Task;
  actions: { label: string; onClick: (taskId: string) => void }[];
  showBlockedBy?: boolean;
}

function TaskItem({ task, actions, showBlockedBy }: TaskItemProps) {
  const statusConfig = STATUS_CONFIG[task.status];
  const isCompleted = task.status === 'completed';

  return (
    <UI.QueueItem>
      {/* 状态指示器 */}
      <UI.QueueItemIndicator completed={isCompleted}>
        {!isCompleted && (
          <span className={statusConfig.color}>{statusConfig.icon}</span>
        )}
      </UI.QueueItemIndicator>

      {/* 任务内容 */}
      <UI.QueueItemContent completed={isCompleted}>
        {/* 主题 + ID */}
        <div className="flex items-center gap-2">
          <span className="font-medium">{task.subject}</span>
          <span className="text-xs text-gray-400">#{task.id}</span>
        </div>

        {/* 进行中的活动 */}
        {task.activeForm && task.status === 'in_progress' && (
          <UI.QueueItemDescription>
            {task.activeForm}
          </UI.QueueItemDescription>
        )}

        {/* 阻塞依赖 */}
        {showBlockedBy && task.blockedBy.length > 0 && (
          <UI.QueueItemDescription>
            <span className="text-amber-600">
              Blocked by: {task.blockedBy.join(', ')}
            </span>
          </UI.QueueItemDescription>
        )}

        {/* 失败原因 */}
        {task.status === 'failed' && task.metadata?.error && (
          <UI.QueueItemDescription>
            <span className="text-red-600">{task.metadata.error}</span>
          </UI.QueueItemDescription>
        )}

        {/* 结果摘要 */}
        {task.metadata?.result && (
          <UI.QueueItemDescription>
            {task.metadata.result}
          </UI.QueueItemDescription>
        )}

        {/* 元数据：优先级、标签 */}
        {(task.metadata?.priority || task.metadata?.tags) && (
          <div className="flex gap-2 mt-1">
            {task.metadata?.priority && (
              <PriorityBadge priority={task.metadata.priority} />
            )}
            {task.metadata?.tags?.map(tag => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}
      </UI.QueueItemContent>

      {/* 操作按钮 */}
      {actions.length > 0 && (
        <UI.QueueItemActions>
          {actions.map((action, i) => (
            <UI.QueueItemAction
              key={i}
              onClick={() => action.onClick(task.id)}
            >
              {action.label}
            </UI.QueueItemAction>
          ))}
        </UI.QueueItemActions>
      )}
    </UI.QueueItem>
  );
}

/**
 * 优先级徽章
 */
function PriorityBadge({ priority }: { priority: 'low' | 'medium' | 'high' }) {
  const colors = {
    low: 'bg-gray-100 text-gray-600',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[priority]}`}>
      {priority}
    </span>
  );
}

/**
 * 标签徽章
 */
function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
      {tag}
    </span>
  );
}
```

### 7.4 任务操作

#### 7.4.1 操作对话框

```typescript
// src/components/task-dialogs.tsx

import { useState } from 'react';

interface ClaimTaskDialogProps {
  taskId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClaimTaskDialog({
  taskId,
  onConfirm,
  onCancel,
}: ClaimTaskDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim Task #{taskId}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CompleteTaskDialogProps {
  taskId: string;
  subject: string;
  onConfirm: (result: string) => void;
  onCancel: () => void;
}

export function CompleteTaskDialog({
  taskId,
  subject,
  onConfirm,
  onCancel,
}: CompleteTaskDialogProps) {
  const [result, setResult] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete Task</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-sm font-medium">Result Summary</label>
          <textarea
            className="w-full mt-1 p-2 border rounded"
            rows={3}
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Brief summary of what was accomplished..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(result)}>Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StopTaskDialogProps {
  taskId: string;
  subject: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function StopTaskDialog({
  taskId,
  subject,
  onConfirm,
  onCancel,
}: StopTaskDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Task</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-sm font-medium">Reason (optional)</label>
          <textarea
            className="w-full mt-1 p-2 border rounded"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this task being stopped?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)}>
            Stop Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### 7.4.2 操作处理集成

```typescript
// src/components/task-panel-with-dialogs.tsx

import { useState } from 'react';
import { TaskPanel } from './task-panel';
import {
  ClaimTaskDialog,
  CompleteTaskDialog,
  StopTaskDialog,
} from './task-dialogs';
import type { Task } from '@/lib/tasks/types';

interface TaskPanelWithDialogsProps {
  tasks: Task[];
  onClaim: (taskId: string) => Promise<void>;
  onComplete: (taskId: string, result: string) => Promise<void>;
  onStop: (taskId: string, reason: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

type DialogType = 
  | { type: 'claim'; taskId: string }
  | { type: 'complete'; taskId: string; subject: string }
  | { type: 'stop'; taskId: string; subject: string }
  | null;

export function TaskPanelWithDialogs(props: TaskPanelWithDialogsProps) {
  const [dialog, setDialog] = useState<DialogType>(null);

  const handleClaim = (taskId: string) => {
    const task = props.tasks.find(t => t.id === taskId);
    if (task) {
      setDialog({ type: 'claim', taskId });
    }
  };

  const handleComplete = (taskId: string) => {
    const task = props.tasks.find(t => t.id === taskId);
    if (task) {
      setDialog({ type: 'complete', taskId, subject: task.subject });
    }
  };

  const handleStop = (taskId: string) => {
    const task = props.tasks.find(t => t.id === taskId);
    if (task) {
      setDialog({ type: 'stop', taskId, subject: task.subject });
    }
  };

  return (
    <>
      <TaskPanel
        {...props}
        onClaim={handleClaim}
        onComplete={handleComplete}
        onStop={handleStop}
      />

      {/* Claim Dialog */}
      {dialog?.type === 'claim' && (
        <ClaimTaskDialog
          taskId={dialog.taskId}
          onConfirm={async () => {
            await props.onClaim(dialog.taskId);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Complete Dialog */}
      {dialog?.type === 'complete' && (
        <CompleteTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          onConfirm={async (result) => {
            await props.onComplete(dialog.taskId, result);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Stop Dialog */}
      {dialog?.type === 'stop' && (
        <StopTaskDialog
          taskId={dialog.taskId}
          subject={dialog.subject}
          onConfirm={async (reason) => {
            await props.onStop(dialog.taskId, reason);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}
```

### 7.5 依赖关系可视化

#### 7.5.1 任务依赖树

当需要展示任务的依赖链时，可以使用缩进+连线的可视化方式：

```tsx
// src/components/task-dependency-tree.tsx

import type { Task } from '@/lib/tasks/types';
import * as UI from 'ai-elements';

interface TaskDependencyTreeProps {
  tasks: Task[];
  rootTaskId: string;
}

export function TaskDependencyTree({
  tasks,
  rootTaskId,
}: TaskDependencyTreeProps) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  const renderTask = (task: Task, depth: number = 0): React.ReactNode => {
    const blockedByTasks = task.blockedBy
      .map(id => taskMap.get(id))
      .filter((t): t is Task => t !== undefined);

    return (
      <div key={task.id} style={{ marginLeft: depth * 24 }}>
        <TaskTreeItem task={task} />
        {blockedByTasks.map(dep => renderTask(dep, depth + 1))}
      </div>
    );
  };

  const rootTask = taskMap.get(rootTaskId);
  if (!rootTask) return null;

  return (
    <div className="space-y-1">
      {renderTask(rootTask)}
    </div>
  );
}

function TaskTreeItem({ task }: { task: Task }) {
  const statusIcon = {
    pending: '○',
    in_progress: '◐',
    completed: '●',
    failed: '✕',
    cancelled: '⊘',
  }[task.status];

  return (
    <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
      <span>{statusIcon}</span>
      <span className="font-medium">{task.subject}</span>
      <span className="text-xs text-gray-400">#{task.id}</span>
    </div>
  );
}
```

#### 7.5.2 依赖关系编辑

在创建/编辑任务时，可以选择依赖任务：

```tsx
// src/components/task-dependency-selector.tsx

import { useState } from 'react';
import type { Task } from '@/lib/tasks/types';

interface TaskDependencySelectorProps {
  tasks: Task[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];  // 排除自己，避免循环依赖
}

export function TaskDependencySelector({
  tasks,
  selectedIds,
  onChange,
  excludeIds = [],
}: TaskDependencySelectorProps) {
  // 过滤可选任务：排除自己及其后代，避免循环依赖
  const availableTasks = tasks.filter(
    t => !excludeIds.includes(t.id)
  );

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Blocked By</label>
      <div className="border rounded p-2 space-y-1 max-h-48 overflow-y-auto">
        {availableTasks.map(task => (
          <label
            key={task.id}
            className="flex items-center gap-2 p-1 hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(task.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selectedIds, task.id]);
                } else {
                  onChange(selectedIds.filter(id => id !== task.id));
                }
              }}
            />
            <span className="text-sm">{task.subject}</span>
            <span className="text-xs text-gray-400">#{task.id}</span>
          </label>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className="text-xs text-gray-500">
          Selected: {selectedIds.join(', ')}
        </div>
      )}
    </div>
  );
}
```

---

## 附录 A：使用示例

### A.1 基本使用

```typescript
import { createTaskStore } from '@/lib/tasks/store';
import { createTaskCreateTool } from '@/lib/tasks/tools/task-create-tool';
import { createTaskListTool } from '@/lib/tasks/tools/task-list-tool';
import { createTaskUpdateTool } from '@/lib/tasks/tools/task-update-tool';

// 创建任务存储
const taskStore = createTaskStore();

// 创建工具
const taskCreateTool = createTaskCreateTool(taskStore);
const taskListTool = createTaskListTool(taskStore);
const taskUpdateTool = createTaskUpdateTool(taskStore);

// Agent 使用
const tools = {
  task_create: taskCreateTool,
  task_list: taskListTool,
  task_update: taskUpdateTool,
};
```

### A.2 任务依赖链

```typescript
// 创建任务 A
const taskA = await tools.task_create.execute({
  subject: 'Design database schema',
});

// 创建任务 B（依赖 A）
const taskB = await tools.task_create.execute({
  subject: 'Implement backend API',
  blockedBy: [taskA.id],
});

// 创建任务 C（依赖 B）
const taskC = await tools.task_create.execute({
  subject: 'Build frontend',
  blockedBy: [taskB.id],
});

// 查看可执行任务（只有 A）
const available = await tools.task_list.execute({ available: true });
// available.tasks = [taskA]

// 完成 A
await tools.task_update.execute({ id: taskA.id, status: 'completed' });

// 现在 B 可执行
const available2 = await tools.task_list.execute({ available: true });
// available2.tasks = [taskB]
```

### A.3 Agent 认领任务

```typescript
// Agent 尝试认领任务
const result = await tools.task_update.execute({
  id: taskB.id,
  status: 'in_progress',
});

if (result.success) {
  console.log(`Agent claimed task ${taskB.id}`);
  // 开始执行任务...
} else {
  console.log(`Claim failed: ${result.message}`);
  // 可能是其他 agent 已经认领
}
```

---

## 附录 B：测试策略

### B.1 单元测试

```typescript
// tests/tasks/core.test.ts

describe('Task System Core', () => {
  test('HighWaterMark increments correctly');
  test('createTask generates unique ID');
  test('claimTask blocks busy agent');
  test('claimTask allows free agent');
  test('deleteTask updates dependency链表');
  test('updateTask to completed unblocks dependents');
  test('getAvailableTasks returns correct tasks');
});
```

### B.2 集成测试

```typescript
// tests/tasks/integration.test.ts

describe('Task System Integration', () => {
  test('Task chain: A -> B -> C, complete in order');
  test('Task chain: A -> B -> C, complete out of order fails');
  test('Parallel agents cannot claim same task');
  test('Task deletion cleans up blocks/blockedBy');
});
```

---

*文档版本: v1.1*  
*最后更新: 2026-04-13*  
*更新内容: 新增第7章 UI 组件设计（基于 ai-elements Queue 组件）*  
*作者: AI Agent 开发工程师*