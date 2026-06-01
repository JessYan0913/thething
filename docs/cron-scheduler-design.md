# 自动化任务系统（Cron Scheduler）设计文档

## 1. 背景与动机

TheThing 作为 AI Agent 框架，需要支持定时自动执行任务的能力：定期数据汇总、定时检查、周期性报告生成等。

已有基础设施：
- **InboundEvent → Inbox → Processor → AgentHandler** 完整入站管道
- **TaskTriggerProtocolAdapter** 专为外部调度器设计的协议适配器
- **SQLiteInboundInbox** 支持幂等、重试、死信的可靠队列

**核心洞察**：调度器只需做一件事——在正确的时间往已有管道里塞一个事件。Agent 执行、对话管理、重试机制全部复用。

## 2. 架构

```
┌─────────────────────────────────────────────────┐
│                  CronScheduler                   │
│  ┌───────────┐    tick (10s)    ┌─────────────┐ │
│  │ CronStore │ ───────────────→ │  fire(job)  │ │
│  │ (SQLite)  │                  └──────┬──────┘ │
│  └───────────┘                         │        │
└────────────────────────────────────────┼────────┘
                                         │ InboundEvent
                                         ▼
                              ┌──────────────────┐
                              │  InboundInbox     │  ← 已有
                              │  (SQLite Queue)   │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ InboundProcessor  │  ← 已有
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ AgentHandler      │  ← 已有
                              │ (创建/恢复对话)    │
                              └──────────────────┘
```

### 关键决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 事件投递 | 直接 publish 到 Inbox | 内部调度无需经过 Gateway 验证层，零 connector 配置 |
| Cron 解析 | 自实现 | 零依赖，~100 行，项目偏好最少依赖 |
| 存储 | 独立 SQLite DB | 与 connector-inbox.db 模式一致 |
| Tick 间隔 | 10 秒 | 分钟级精度足够，CPU 开销≈0 |
| 对话策略 | 可选绑定 conversationId | 支持追加式和独立式 |

### 不做的事

- 秒级调度（Agent 执行本身是秒/分钟级）
- 分布式锁（单进程 SQLite 足够）
- 任务依赖 DAG
- UI 设置页面（本次只做 core + API）
- `@yearly` 等 cron 别名

## 3. 数据模型

### CronJob

```ts
interface CronJob {
  id: string                         // nanoid
  name: string                       // 人类可读名称
  schedule: string                   // 5 字段 cron: "分 时 日 月 周"
  prompt: string                     // 发给 Agent 的消息
  agentType?: string                 // 可选 sub-agent 类型
  conversationId?: string            // 绑定对话（不填则每次新建）
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown> // 扩展字段
}
```

### CronExecution

```ts
interface CronExecution {
  id: string
  jobId: string
  status: 'triggered' | 'completed' | 'failed'
  triggeredAt: number
  completedAt: number | null
  error: string | null
  eventId: string | null             // 关联 InboundEvent ID
}
```

### SQLite Schema

```sql
-- 文件: {dataDir}/cron-jobs.db

CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agent_type TEXT,
  conversation_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE TABLE cron_executions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'triggered',
  triggered_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  event_id TEXT,
  FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_cron_jobs_next_run ON cron_jobs (enabled, next_run_at);
CREATE INDEX idx_cron_executions_job ON cron_executions (job_id, triggered_at DESC);
```

## 4. Cron 表达式解析器

自实现，支持标准 5 字段格式：`分 时 日 月 周`

支持的语法：
- `*` — 通配
- `*/N` — 步进
- `N-M` — 范围
- `N,M,O` — 列表
- 组合 — `1-5,10,*/15`

核心 API：
```ts
function nextOccurrence(expression: string, after: Date): Date
function matches(expression: string, date: Date): boolean
```

## 5. 调度器核心逻辑

```
每 10 秒 tick:
  1. SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= now
  2. 对每个到期任务:
     a. 构造 InboundEvent {
          connectorId: '__cron__',
          protocol: 'task-trigger',
          transport: 'internal',
          channel.id: job.conversationId || 'cron-{job.id}',
          sender: { id: 'cron-scheduler', type: 'bot' },
          message.text: job.prompt,
          agentType: job.agentType
        }
     b. inbox.publish(event)
     c. INSERT INTO cron_executions
     d. UPDATE cron_jobs SET last_run_at = now, next_run_at = next(schedule)
  3. 单个任务失败不影响其他任务
```

## 6. 集成点

### CoreRuntime 扩展

```ts
interface CoreRuntime {
  // ...existing fields
  readonly cronScheduler: CronScheduler | null
}
```

### 生命周期

```
bootstrap()                          → 创建 CronScheduler（不启动）
configureConnectorInboundRuntime()   → 绑定 Agent handler
runtime.cronScheduler.start()        → 启动 tick loop
shutdownRuntime()                    → scheduler.stop() + store.close()
```

### API 路由

```
GET    /api/cron          → 列出所有任务
POST   /api/cron          → 创建任务
GET    /api/cron/[id]     → 任务详情 + 执行记录
PATCH  /api/cron/[id]     → 更新任务
DELETE /api/cron/[id]     → 删除任务
POST   /api/cron/[id]/actions → { action: 'trigger' | 'enable' | 'disable' }
```

## 7. 文件结构

```
packages/core/src/modules/cron/
  ├── types.ts           # 类型定义
  ├── cron-expr.ts       # Cron 表达式解析器
  ├── store.ts           # CronJobStore 接口
  ├── sqlite-store.ts    # SQLite 实现
  ├── scheduler.ts       # 调度器
  └── index.ts           # 公开导出
```
