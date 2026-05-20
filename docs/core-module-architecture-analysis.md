# packages/core 模块架构分析

> 2026-05-20 深度审查。本文只回答三个问题：每个模块是什么、模块间怎么连的、哪里坏了怎么修。

## 1. 分层与模块清单

```
composition/     编排层 — bootstrap、AppContext、加载器、入站编排
    ↓
modules/         领域层 — 16 个运行时模块
    ↓
services/        基础设施层 — config、datastore、model、scanner
    ↓
primitives/      原语层 — constants、logger、clock、parser、paths、datastore 接口
```

依赖规则：只能向下依赖，同层可互相依赖。**当前有 2 处违反。**

### primitives/

| 模块 | 一句话职责 |
|------|-----------|
| `constants` | 全局技术常量（token 字节比、默认目录名、tokenizer 地址） |
| `logger` | 条件日志（debug/warn/error） |
| `clock/` | 可 mock 时钟接口 |
| `datastore/` | DataStore 纯接口（Conversation/Message/Summary/Cost/Task Store） |
| `parser/` | 文件解析（frontmatter、yaml、json + Zod 校验） |
| `paths/` | 路径计算纯函数 |

### services/

| 模块 | 一句话职责 | 依赖 |
|------|-----------|------|
| `scanner/` | 多源文件扫描 + 优先级合并 + 缓存 | primitives |
| `datastore/` | SQLite DataStore 实现 | primitives |
| `model/` | 模型工厂 + 上下文限制/能力查询 + 定价 | primitives |
| `config/` | BehaviorConfig 构建 + LayoutConfig 解析 | model, datastore |

### modules/

| 模块 | 行数 | 一句话职责 | 关键依赖 |
|------|------|-----------|----------|
| `tasks/` | 2244 | 任务 CRUD + 状态机 + AI SDK 工具 | primitives only |
| `budget/` | 1082 | 工具输出大小管理（截断/持久化/预览替换） | config |
| `skills/` | 425 | 技能加载（.md frontmatter）+ 预算格式化 | scanner |
| `permissions/` | 756 | 权限规则 CRUD + 命令匹配 + 路径校验 | scanner, config |
| `memory/` | 1214 | 记忆扫描/LLM 提取/相关性匹配/索引管理 | config, clock |
| `mcp/` | 843 | MCP 服务注册 + 连接管理 + 工具包装 | budget, scanner |
| `tools/` | 1055 | 9 个工具工厂（bash/read/write/edit/glob/grep/skill/ask/search） | permissions, skills |
| `attachments/` | 543 | skill listing 注入消息 | skills |
| `middleware/` | 384 | 3 个 AI SDK 中间件（成本/遥测/护栏） | session(cost) |
| `compaction/` | 2219 | 3 层压缩（lifecycle→context-window→retry）+ 初始预算检查 | model, datastore |
| `subagents/` | 2595 | 子代理注册/路由/执行 + 内置代理 + 递归防护 | tasks |
| `system-prompt/` | 1553 | 8 个 section 工厂拼装系统提示 | skills, subagents, permissions, memory |
| `agent-control/` | 154 | Agent 管道（步骤预处理 + 停止条件） | session, budget |
| `session/` | 1009 | 会话状态聚合（成本/token/拒绝/模型切换） | compaction, budget, tasks |
| `connector/` | 6636 | Connector 注册 + 执行器 + 入站子系统 | permissions, budget, memory, **composition** |
| `agent/` | 722 | Agent 创建编排（组装所有模块） | **15 个模块** |

### composition/

| 模块 | 一句话职责 |
|------|-----------|
| `bootstrap.ts` | CoreRuntime 初始化（layout + behavior + datastore + connector + tokenizer） |
| `app/` | createContext（并行加载 6 类资源 → 冻结快照）+ createAgent（消费快照创建 Agent） |
| `loaders/` | 6 个 AppModule 适配器（init/snapshot/dispose 生命周期） |
| `inbound-agent/` | 入站 Agent 编排接口（ConversationResolver + ApprovalService） |

---

## 2. 依赖关系图

```
composition/
  bootstrap       → config, datastore, model, connector
  app/context     → loaders, connector(registry)
  app/create      → agent
  loaders/        → skills, subagents, mcp, connector, permissions, memory
  inbound-agent/  → connector/inbound(types)

modules/
  agent           → session, model, agent-control, middleware, compaction, attachments,
                    memory, tools, tasks, subagents, mcp, connector, skills, permissions,
                    system-prompt, budget                           ← 15 个依赖
  agent-control   → session, budget
  session         → compaction, budget, tasks
  compaction      → model, datastore
  connector       → permissions, budget, memory,
                    ██ composition/app, composition/inbound-agent   ← 反向依赖（P0）
  system-prompt   → skills, subagents, permissions, memory
  subagents       → tasks
  tools           → permissions, skills
  attachments     → skills
  middleware      → session
  mcp             → budget
  memory          → config, clock
  budget          → config
  skills          → scanner
  permissions     → scanner, config
  tasks           → (primitives only)

services/
  config          → model, datastore,
                    ██ modules/* (type re-export)                   ← 层级违反（P2）
```

`██` 标记的是违反分层规则的依赖。

---

## 3. 必须修的问题

### 3.1 connector/inbound 反向依赖 composition（P0）

**问题：**

```typescript
// modules/connector/inbound/agent-handler.ts — modules 层
import { createAgent } from '../../composition/app'        // ← 向上依赖

// modules/connector/factory.ts — modules 层
import { DefaultConversationResolver } from '../../composition/inbound-agent'  // ← 向上依赖
```

connector 模块里混进了 Agent 编排逻辑（创建 Agent、运行对话、管理审批流）。这些是 composition 层的职责，不是通信基础设施的职责。

**修法：** 沿职责线切开。

connector/inbound/ 只留通信管道：
```
modules/connector/inbound/
├── gateway/       协议入口（HTTP/WS 接入）
├── adapters/      协议适配（飞书、微信验签解密解析）
├── inbox/         消息队列（内存 + SQLite 持久化）
├── responder/     回复派发
├── crypto/        加解密工具
└── types.ts       InboundEvent, ReplyAddress, OutboundMessage
```

Agent 编排逻辑搬到 composition：
```
composition/inbound/
├── agent-handler.ts       ← 从 connector 搬来（核心：创建 Agent + 运行 + 审批）
├── inbound-processor.ts   ← 从 connector 搬来（编排处理流程）
├── factory.ts             ← 从 connector 搬来（入站运行时组装）
├── conversation-resolver.ts
├── approval-service.ts
└── post-process.ts
```

修完后的依赖方向：
```
composition/inbound → composition/app (createAgent)       ✅ 同层
composition/inbound → connector/inbound (inbox, responder) ✅ 上→下
connector/inbound   → primitives                           ✅ 只依赖底层
```

connector 变成纯通信层，不知道 Agent 是什么。换任何消费者（日志记录器、转发器）都能复用。

### 3.2 两条 Agent 路径的后处理重复（P1）

Server 有两条 Agent 路径：

| | 直接 API (`routes/chat.ts`) | Connector 入站 (`agent-handler.ts`) |
|-|---------------------------|--------------------------------------|
| 响应模式 | 流式 SSE（逐 token 推） | 完整回复（跑完后发消息） |
| 协议 | 标准 HTTP | 飞书/微信私有协议 |
| 交互 | Web UI 可弹对话框审批 | 只能发文本 |

这两条路径**不能合并**（流式 vs 完整回复是本质差异），但它们各自独立实现了相同的后处理：

```
保存消息 → 提取记忆 → 生成标题 → 持久化成本 → 清理 MCP
```

**修法：** 提取一个函数，不需要新模块、新接口、新架构图。

```typescript
// composition/finalize.ts

export async function finalizeAgentRun(opts: {
  dataStore: DataStore
  messages: UIMessage[]
  conversationId: string
  sessionState: SessionState
  mcpRegistry: McpRegistry
  model: LanguageModel
  isNewConversation: boolean
  memoryBaseDir?: string
  userId?: string
}): Promise<void> {
  await opts.dataStore.messageStore.saveMessages(opts.conversationId, opts.messages)

  setImmediate(() => {
    extractMemoriesInBackground(opts.model, opts.messages, opts.memoryBaseDir, opts.userId)
    if (opts.isNewConversation) {
      generateConversationTitle(opts.model, opts.messages, opts.dataStore, opts.conversationId)
    }
    opts.sessionState.costTracker.persistToDB()
    opts.mcpRegistry.disconnectAll()
  })
}
```

两条路径各自 import 这个函数：

```typescript
// routes/chat.ts — 流式路径
const result = await createAgent(context, opts)
// ... 流式推送 ...
onFinish: () => finalizeAgentRun({ dataStore, messages, ... })

// agent-handler.ts — 入站路径
const result = await createAgent(context, opts)
// ... 跑完拿到完整文本 ...
await finalizeAgentRun({ dataStore, messages, ... })
await responder.respond(event.replyAddress, text)
```

新增 connector（Telegram、Discord）时，只需实现收发逻辑，后处理一行 `finalizeAgentRun()` 搞定。

---

## 4. 应该修但不紧急的问题

### 4.1 agent/ 的 15 个依赖（P1，可选）

`modules/agent/create.ts` 导入 15 个模块，只有 722 行——它本质是个组装器。这个职责更适合 composition 层。

如果执行 3.1 的搬迁，可以顺便把 agent 的组装逻辑上移到 `composition/app/create.ts`，让 `modules/agent/` 只保留三个工具函数：

- `loadAllTools()` — 加载全部工具
- `loadMemoryContext()` — 加载记忆上下文
- `buildAgentInstructions()` — 构建系统提示

**不做也不会坏。** agent 作为"已知的编排中心"是可以接受的，只要团队知道它的特殊地位。

### 4.2 session → compaction 的类型耦合（P1，可选）

```typescript
// session/state.ts
import { compactBeforeStep } from '../compaction'
import { CompactionConfig } from '../compaction/types'
```

目前不构成运行时循环，但 session 直接 import compaction 的函数和类型会让后续拆分变难。

修法：`CompactionConfig` 等共享类型下沉到 `services/config/compaction-types.ts`（文件已存在）。`compactBeforeStep` 改为通过 `createSessionState` 参数注入。

### 4.3 services/config 的类型 re-export（P2）

`services/config/types.ts` 从 7 个 modules 导入类型做 re-export。全是 type-only，不影响运行时，但打破分层约束。

修法：删掉 `services/config/types.ts` 的 modules 层 re-export。统一入口放包顶层 `index.ts`。

### 4.4 resolveModelAlias 放在 subagents 里（P2）

`session/model-switching.ts` 从 `subagents/model-resolver` 导入 `resolveModelAlias`。模型别名解析是通用能力，不属于子代理。

修法：移到 `services/model/`。一个函数挪个位置，10 分钟。

### 4.5 CompactionConfig 双重定义（P2）

`services/config/compaction-types.ts` 和 `modules/compaction/types.ts` 各自定义了同名类型。

修法：合并为一份放 `services/config/compaction-types.ts`，compaction 模块从这里导入。

> P2 的问题不需要设计，直接提 PR 修。
