# packages/core 模块架构分析

> 2026-05-21 深度审查，全部修复后更新。

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

依赖规则：只能向下依赖，同层可互相依赖。**当前无违反。**

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
| `session/` | 1009 | 会话状态聚合（成本/token/拒绝/模型切换） | budget, tasks |
| `connector/` | 6636 | Connector 注册 + 执行器 + 通信基础设施 | permissions, budget, memory |
| `agent/` | ~400 | 工具函数（loadAllTools、loadMemoryContext、buildAgentInstructions） | permissions, skills, memory |

### composition/

| 模块 | 一句话职责 |
|------|-----------|
| `bootstrap.ts` | CoreRuntime 初始化（layout + behavior + datastore + connector + tokenizer） |
| `app/` | createContext（并行加载 6 类资源 → 冻结快照）+ createAgent（完整 Agent 组装编排） |
| `finalize.ts` | Agent 后处理（保存消息 + 记忆提取 + 标题生成 + 成本持久化 + MCP 清理） |
| `inbound/` | 入站 Agent 编排（agent-handler + approval + configure + ConversationResolver） |
| `loaders/` | 6 个 AppModule 适配器（init/snapshot/dispose 生命周期） |

---

## 2. 依赖关系图

```
composition/
  bootstrap       → config, datastore, model, connector
  app/context     → loaders, connector(registry)
  app/create      → session, model, agent-control, middleware, compaction,
                    attachments, memory, agent(tools), system-prompt, budget
  finalize        → memory, compaction, primitives
  inbound/        → app, connector(registry, inbound/types, inbound-processor),
                    memory, permissions, finalize
  loaders/        → skills, subagents, mcp, connector, permissions, memory

modules/
  agent           → permissions, skills, memory                      ← 仅工具函数，无编排
  agent-control   → session, budget
  session         → budget, tasks                                    ← compaction 已解耦（注入）
  compaction      → model, datastore
  connector       → permissions, budget, memory                    ← 已清理，无反向依赖
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
  config          → model, datastore
  model           → config (alias)
```

当前无分层违反。

---

## 3. 已修复的问题

### 3.1 ~~connector/inbound 反向依赖 composition（P0）~~ ✅ 已修复

Agent 编排逻辑（agent-handler、approval-handler、approval-context、configureConnectorInboundRuntime）已从 `modules/connector/` 搬到 `composition/inbound/`。

`modules/connector/` 现在是纯通信层，零 composition 依赖。通信基础设施（gateway、adapters、inbox、responder、crypto、inbound-processor、runtime、types）保留在原位。

### 3.2 ~~两条 Agent 路径的后处理重复（P1）~~ ✅ 已修复

提取 `composition/finalize.ts` 中的 `finalizeAgentRun()` 函数，两条路径共享。同时修复了 agent-handler.ts 中 `costTracker.persistToDB()` double-persist bug。

### 3.3 ~~CompactionConfig 类型错误（P2）~~ ✅ 已修复

`modules/compaction/types.ts` 的 `export type` re-export 不让类型名在本文件可用，添加了 `import type` 修复 3 个 `Cannot find name` 错误。

### 3.4 ~~services/config 的类型 re-export（P2）~~ ✅ 已修复

`services/config/types.ts` 从 7 个 modules 导入 24 个类型做 re-export，违反分层规则。经验证零消费者，整个文件为死代码。已删除文件并清理 `services/config/index.ts` 中对应的 re-export（含 `ToolOutputConfig`）。

### 3.5 ~~resolveModelAlias 放在 subagents 里（P2）~~ ✅ 已修复

`resolveModelAlias()` 已从 `modules/subagents/model-resolver.ts` 移到 `services/model/alias.ts`。参数类型改为独立的 `ModelAliases`，不再依赖 subagents 类型。`MODEL_MAPPING` 一并迁移。

### 3.6 ~~session → compaction 运行时耦合~~ ✅ 已修复

`session/state.ts` 直接 import `compactBeforeStep`、动态 import `manageToolOutputLifecycle` 和 `estimateMessagesTokens`，产生 session→compaction 运行时依赖。

修法：`CompactionResult` 类型移到 `services/config/compaction-types.ts`（共享层），`SessionStateOptions` 新增 `compact` 注入参数，`session/state.ts` 不再 import 任何 compaction 运行时代码。compact 闭包在 `composition/app/create.ts` 中构造并赋值给 `sessionState.compact`。

### 3.7 ~~agent/ 的 15 个依赖~~ ✅ 已修复

`modules/agent/create.ts`（247 行纯组装代码）导入 15 个模块，职责本质上属于 composition 层。

已将组装逻辑合入 `composition/app/create.ts`，`modules/agent/` 仅保留工具函数（`loadAllTools`、`loadMemoryContext`、`buildAgentInstructions`）和类型定义。`modules/agent/create.ts` 已删除。

---

## 4. 遗留问题

当前无已知架构问题。
