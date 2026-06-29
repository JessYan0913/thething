# Dot Agents 协议合规：Cron → tasks/

## 目标

将 TheThing 现有的 cron 调度系统（SQLite 驱动）迁移为符合 Dot Agents 协议的 `tasks/<name>/task.md` 声明式文件格式。

协议规格：https://dotagentsprotocol.com/

---

## 现状

TheThing 的 cron 系统：

```
modules/cron/
├── types.ts           # CronJob, CronJobStore 接口
├── cron-expr.ts       # 5 字段 cron 表达式解析器
├── sqlite-store.ts    # SQLiteCronJobStore（cron-jobs.db）
├── scheduler.ts       # CronScheduler（tick 间隔调度）
└── index.ts
```

- 任务存储在 SQLite `cron-jobs.db` 中
- 使用标准 5 字段 cron 表达式（`*/5 * * * *`、`0 9 * * 1-5` 等）
- 通过 `createCronTool()` 暴露 CRUD 操作给 Agent
- 调度器通过 `inbox.publish()` 触发任务

## 协议要求

协议定义 `tasks/<name>/task.md`：

```markdown
---
kind: task
id: daily-code-review
name: Daily Code Review
intervalMinutes: 60
enabled: true
runOnStartup: false
profileId: abc-123
---

Review all open pull requests and
summarize their status. Check for
any failing CI pipelines.
```

### 协议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `"task"` | 固定值 |
| `id` | string | 任务唯一标识 |
| `name` | string | 人类可读名称 |
| `intervalMinutes` | integer | 运行间隔（分钟） |
| `enabled` | boolean | 是否启用 |
| `runOnStartup` | boolean | 启动时是否立即运行 |
| `profileId` | string | 关联的 Agent profile ID |

Body：任务描述 / Agent prompt。

---

## 差异分析

### 1. 调度精度

| TheThing | 协议 |
|---|---|
| 5 字段 cron 表达式 | `intervalMinutes`（固定分钟） |
| 支持 `0 9 * * 1-5`（工作日上午 9 点） | 仅支持 `60`（每 60 分钟） |

协议用简化的固定间隔，TheThing 用完整的 cron 表达式。**这是最大的设计差异**。

**方案**：在 `task.md` frontmatter 中增加本地扩展字段 `schedule`，保留 cron 表达式能力：

```markdown
---
kind: task
id: daily-standup
name: 每日站会提醒
intervalMinutes: 1440
schedule: "0 9 * * 1-5"    # TheThing 扩展：5 字段 cron
enabled: true
profileId: product-manager
---
```

### 2. 存储方式

| TheThing | 协议 |
|---|---|
| SQLite 数据库（`cron-jobs.db`） | 文件系统（`tasks/<name>/task.md`） |
| 运行时 CRUD 通过 SQL | 文件 CRUD 通过前端/skill |
| 无版本控制 | git 友好 |

**方案**：双源并存。文件作为权威来源（source of truth），SQLite 作为运行时缓存。启动时从文件加载并同步到 SQLite。

### 3. CronJob → Task 字段映射

| CronJob | Task frontmatter | 说明 |
|---|---|---|
| `id` | `id` | 直接映射 |
| `name` | `name` | 直接映射 |
| `schedule`（cron expr） | `intervalMinutes` + `schedule`（扩展） | `schedule` 在协议基础上扩展，保留 cron 能力 |
| `prompt` | body | 任务 body 作为 Agent prompt |
| `agentType` | `profileId` | 关联的 Agent |
| `enabled` | `enabled` | 直接映射 |
| `conversationId` | — | 协议无此字段，可存 metadata |
| `lastRunAt` / `nextRunAt` | — | 运行时状态，不写入文件 |

---

## 实施步骤

### Phase 1：读取（新增 `modules/tasks/`）

**新增文件**：

| 文件 | 内容 |
|---|---|
| `packages/core/src/modules/tasks/types.ts` | `TaskFrontmatterSchema`（Zod），`Task` 接口 |
| `packages/core/src/modules/tasks/loader.ts` | `createMultiSourceLoader` 扫描 `.agents/tasks/<name>/task.md` |
| `packages/core/src/modules/tasks/index.ts` | 模块入口 |

**改动现有文件**：

| 文件 | 改动 |
|---|---|
| `modules/cron/types.ts` | `CronJob` 增加 `source: 'sqlite' \| 'task-file'` 字段 |
| `modules/cron/scheduler.ts` | `register(task: Task): CronJob` 方法：读取 task.md 注册为 CronJob |
| `composition/loaders/index.ts` | 在 `loadAll()` 中增加 tasks 加载步骤 |
| `composition/bootstrap.ts` | 在启动时序中调用 tasks 加载 |

### Phase 2：写入（cron tool 同步）

| 文件 | 改动 |
|---|---|
| `modules/tools/cron.ts` | create/update/delete 操作同时写入 `tasks/<name>/task.md` |
| | create：新建 `.agents/tasks/<id>/task.md` |
| | update：重写 `task.md` frontmatter |
| | delete：删除 `task.md` |

### Phase 3：迁移

| 步骤 | 内容 |
|---|---|
| 从 SQLite 导出 | 将现有 `cron-jobs.db` 中的任务导出为 `tasks/<name>/task.md` |
| 验证 | 确认文件加载后调度行为与之前一致 |
| 降级 SQLite | SQLite 仅作为运行时状态缓存（`nextRunAt`、`lastRunAt`），文件为权威来源 |

---

## 影响范围

- **新增 ~200 行代码**
- **新增 3 个文件**（types.ts、loader.ts、index.ts）
- **修改 5 个现有文件**
- **零破坏性变更**：现有 SQLite 任务继续工作，新增文件任务并行
- 协议 `intervalMinutes` 与 TheThing cron 表达式的兼容方案需确认后再实施
