# Connector 全局问题解决方案

> 本文档针对整个 connector 模块，而不是只针对入站 webhook。
> 目标是把 connector 从“能跑的集成代码”整理成边界清晰、可扩展、可恢复、可审计的 Gateway 子系统。

## 结论

当前 connector 最大的问题不是某一个 bug，而是概念边界混在一起：

```text
connector 实例
  + 平台协议
  + HTTP/WS 传输
  + YAML 加载
  + 凭据解析
  + token 刷新
  + 工具路由
  + executor 执行
  + webhook 入站
  + Agent 执行
  + 审批恢复
  + 回复发送
  + 审计/重试/熔断
```

这些职责目前集中在 `ConnectorRegistry`、入站 handler、server 路由和若干单例初始化函数里，导致新增平台、排查故障、保证可靠性和做安全审计都变难。

新的设计应把 connector 重新定义为三个边界：

```text
配置边界：加载、校验、凭据解析、connector 实例注册
入站边界：外部事件可信接收、协议规范化、可靠移交、可寻址回复
出站边界：标准工具调用、认证、执行、重试、熔断、审计
```

Agent、会话、记忆、标题生成、成本、审批恢复属于应用/运行时服务，不属于协议网关。

## 基础事实

| 事实 | 设计推论 |
|---|---|
| 一个平台协议可以有多个 connector 实例。 | 所有运行时路由必须以 `connectorId` 为主键，`protocol` 只是解释载荷的方式。 |
| Webhook/长连接入口必须快速 ack。 | 入站接收必须和 Agent 执行解耦，中间需要可靠 inbox。 |
| 回复必须回到原始外部位置。 | 标准事件必须携带 `replyAddress`，应用服务不能猜平台。 |
| Agent 工具调用和 webhook 回复都走外部 API。 | 两者可以共享底层 executor，但上层语义必须分开。 |
| connector YAML 可能包含凭据、模板和执行配置。 | 加载期必须做 schema 校验、凭据解析和模板安全边界。 |
| core 是库，不应假设进程环境。 | `process.env`、cwd、单例生命周期应由 server/cli 注入。 |
| 单机部署可以用 SQLite。 | SQLite 可以作为默认可靠队列/审计/审批存储，但必须有真实队列语义。 |
| script/sql/http executor 都可能触达敏感资源。 | executor 必须有明确安全策略、参数化边界和审计记录。 |

## 当前问题清单

### 1. ConnectorRegistry 职责过重

`ConnectorRegistry` 当前同时负责：

- 扫描 YAML；
- 读取文件；
- 替换环境变量；
- 保存 connector 定义；
- 查找工具；
- 创建 token manager；
- 管理熔断；
- 管理重试；
- 调用审计；
- 选择 executor；
- 创建 executor；
- 执行 script/http/sql/mock 工具。

这使它既是 loader，又是 registry，又是 invoker，又是 execution runtime。后果是：加载配置、调用工具、替换凭据和执行安全策略互相耦合，新增能力时很容易继续往 registry 里堆逻辑。

### 2. 配置加载路径存在双轨

现在同时存在：

- `loader.ts` 中的 zod schema 和 `loadConnectors(...)` 代理；
- `registry.ts` 中自己读取 YAML、替换环境变量、手工构造 `ConnectorDefinition`。

这意味着 schema 不一定真正约束 runtime 使用的配置。文档、类型、加载器和 registry 可能逐渐漂移。

### 3. connector 身份和协议身份仍混用

历史设计里 webhook 路由使用 `:handler`：

```text
/api/connector/webhooks/:handler
```

并允许通过 `inbound.handler` 找第一个匹配 connector。这个模型无法正确支持多个飞书应用、多个微信公众号或多个企业微信应用。

正确模型应是：

```text
connectorId = 已配置的 connector 实例
protocol = feishu | wecom | wechat-mp | ...
transport = http | websocket | ...
```

不允许仅凭 `protocol` 或 `handler` 选择 connector 实例。

### 4. 运行时初始化有新旧两套

当前有较新的 `createConnectorRuntime(...)`，也有带单例和废弃注释的 `initConnectorGateway(...)` / `getConnectorInboundRuntime(...)` 路径。server 仍通过全局单例获取 inbound runtime。

后果：

- 生命周期不清楚；
- 测试容易串状态；
- 多项目、多 cwd、多实例运行会互相影响；
- 关闭和资源释放不可靠；
- core 继续间接依赖进程级状态。

### 5. core 仍直接读取 process.env

`ConnectorRegistry` 替换 YAML 变量时直接读取 `process.env`。script executor 也直接读取 `CONNECTOR_ENABLE_SCRIPT_EXECUTOR`。

core 作为库应只接收显式注入的环境和值。server/cli 可以读取环境变量，但读取动作不应藏在 core 内部。

### 6. 入站幂等和 inbox 发布不是原子边界

当前入站流程仍是：

```text
IdempotencyGuard.isDuplicate(...)
InboundInbox.publish(event)
```

如果幂等记录写入成功，但 inbox 写入失败，同一个外部事件再次进入时会被判重，事件就丢了。

幂等应收敛到 inbox 的事务写入里：

```sql
UNIQUE(connector_id, protocol, external_event_id)
```

`publish(event)` 在同一个事务中完成“判重 + 入队”。

### 7. SQLiteInbox 还不是真正可靠队列

当前 `SQLiteInbox` 有 `pending`、`processing`、`completed`、`failed`，但没有：

- `attempts`；
- `max_attempts`；
- `next_attempt_at`；
- `locked_until`；
- visibility timeout；
- dead-letter；
- 可重放/丢弃操作；
- worker lease。

如果进程在 `processing` 状态崩溃，事件可能永久卡住。它现在更接近“带状态的异步分发器”，不是可靠队列。

### 8. server 仍理解旧 webhook handler 语义

server webhook route 仍叫 `/:handler`，并在 gateway 找不到时调用 `getWebhookConfigByHandler(handler)` 做旧式提示。server 应只负责 HTTP 转换和生命周期，不应理解 handler 查找规则。

### 9. 飞书长连接硬编码 connectorId

飞书 WS 当前使用：

```ts
connectorId: 'feishu'
protocol: 'feishu'
```

这仍然假设“飞书协议只有一个 connector 实例”。长连接启动应来自 connector 配置列表，而不是环境变量固定启动一个 `feishu`。

### 10. Responder 仍硬编码协议策略

`ConnectorResponder` 内置 `FeishuReplyStrategy` 和 `WechatReplyStrategy`。这虽然比把协议分支放在 Agent handler 里更好，但新增协议仍要改 core 代码。

回复映射应由 connector YAML 声明：

```yaml
inbound:
  enabled: true
  protocol: feishu
  reply:
    tool: send_message
    input:
      receive_id: "$replyAddress.channelId"
      text: "$message.text"
```

Responder 应按 `replyAddress.connectorId` 找配置并构造标准工具调用。

### 11. 出站工具调用仍使用旧 snake_case 契约

当前内部类型：

```ts
interface ToolCallRequest {
  connector_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}
```

入站事件已经是 `connectorId` / `replyAddress`，出站仍是 snake_case，会在 core 内部制造双轨。snake_case 可以存在于 YAML 或外部 API 边界，内部模型应统一 camelCase。

### 12. HTTP executor 模板语言边界不清

HTTP executor 同时支持：

- `{{input.xxx}}`
- `${input.xxx}`
- `${input.xxx|default}`
- `${input.xxx.yyy}`
- `$input.xxx`
- `@input.xxx`
- `$json(input.xxx)`
- `$jsonEscape(input.xxx)`
- `{{credentials.xxx}}`
- `${credentials.xxx}`
- `{{token}}`
- `${token}`

这些能力目前是分散的字符串替换，不是一个定义清晰的模板语言。风险包括：

- 缺失变量静默变空；
- 类型保留规则不一致；
- credentials 暴露范围不清；
- 加载期无法发现错误；
- 特殊函数继续膨胀；
- JSON 字符串和 JSON 对象容易混淆。

### 13. token/auth 模型过度特殊化

`custom` auth 默认由 TokenManager 处理，但 HTTP executor 又把 custom token 塞进 `Authorization: Bearer ...`。很多平台实际要求 token 放在 query 参数或特定字段里。

此外 HTTP executor 内部还有独立 `tokenCache`，和 `TokenManager` 的缓存不是同一个抽象。token 获取、缓存、渲染和注入方式需要统一。

### 14. script executor 不应作为普通 executor 存在

script executor 即使默认禁用，启用后仍是 `new Function()`。这不是可靠沙箱。对于 connector 这种读取 YAML 配置并访问外部系统的模块，脚本执行是高风险能力。

长期方向：

- 默认移除普通 script executor；
- 如果确实需要，只能在隔离进程或受限 worker 中运行；
- 需要显式 capability、超时、资源限制和审计；
- 不能靠 core 内部读取环境变量开关。

### 15. SQL executor 需要参数化边界

SQL executor 如果依赖 query template 拼接输入，就需要明确：

- 只允许读还是允许写；
- 输入如何绑定为参数；
- `max_rows` 如何强制执行；
- 多语句是否禁止；
- 连接 id 如何授权；
- 查询失败如何审计。

SQL connector 的风险等级高于普通 HTTP connector，不能只靠 YAML 字段表达安全性。

### 16. AgentInboundHandler 仍然是应用层巨石

`AgentInboundHandler` 现在承担：

- 会话解析；
- 消息持久化；
- 审批检测；
- 挂起状态保存；
- Agent 创建；
- stream 消费；
- steps 转 UIMessage；
- assistant 消息构造；
- 文件写入结果拼接；
- 记忆提取；
- 标题生成；
- 成本持久化。

这些不属于 connector 协议边界，应拆到 application/runtime 层。connector inbound 只应把标准事件交给应用服务。

### 17. 审批状态仍是内存状态

审批挂起状态使用进程内 Map。问题：

- 进程重启丢失；
- 多实例不共享；
- 无法审计；
- 无法列出待审批；
- 多个待审批项无法可靠选择；
- TTL 只在内存里生效。

审批状态应持久化到 DataStore 或 connector runtime storage，且保存 `replyAddress`。

### 18. AuditLogger 没有真正持久化闭环

`AuditLogger` 有 `dbPath` 和 `enablePersistence` 选项，但当前主要行为仍是内存数组。审计如果不能跨进程保留，就无法用于问题追踪、安全审计和生产排障。

### 19. 错误模型不可观测

不同层返回的错误有：

- 字符串 error；
- HTTP status；
- `reason`；
- executor `success: false`；
- thrown Error；
- console 日志。

缺少统一错误码、重试分类和审计字段。结果是调用方不知道错误是配置错误、认证错误、平台限流、临时网络错误、不可重试业务错误，还是安全策略拒绝。

### 20. 文档仍有旧模型残留

旧文档中仍存在 `connector_type`、`InboundMessageEvent`、`ReplyContext`、`/webhooks/{connector_type}` 等模型。这些与当前标准 `InboundEvent` / `ReplyAddress` 方向不一致，后续应标记废弃或迁移到新文档。

## 目标架构

### 总体结构

```text
packages/server
  ├─ HTTP webhook route
  ├─ platform long-connection lifecycle
  └─ env/process lifecycle injection

packages/core/src/extensions/connector
  ├─ config
  │   ├─ schema
  │   ├─ loader
  │   ├─ normalizer
  │   └─ credential resolver interfaces
  ├─ registry
  │   └─ connector definition lookup only
  ├─ inbound
  │   ├─ gateway
  │   ├─ protocol adapters
  │   ├─ inbox
  │   └─ responder
  ├─ outbound
  │   ├─ tool invoker
  │   ├─ executor router
  │   ├─ auth/token
  │   └─ executors
  ├─ runtime
  │   ├─ createConnectorRuntime
  │   └─ lifecycle
  └─ observability
      ├─ audit log
      ├─ errors
      └─ metrics

packages/core/src/application/inbound-agent
  ├─ inbound-agent-service
  ├─ conversation-resolver
  ├─ approval-service
  ├─ agent-runner
  ├─ message-writer
  └─ post-process
```

### 核心数据流

```text
入站：
HTTP/WS
  -> server transport adapter
  -> ConnectorInboundGateway
  -> ProtocolAdapter
  -> InboundEvent
  -> ReliableInbox.publish(event)
  -> quick ack
  -> InboundAgentService.handle(event)
  -> Responder.respond(replyAddress, message)

出站：
Agent tool call
  -> ConnectorToolInvoker
  -> ConnectorRegistry lookup
  -> Auth/Token resolution
  -> ExecutorRouter
  -> Executor
  -> Audit/Retry/CircuitBreaker
  -> ToolResult

回复：
InboundAgentService
  -> Responder
  -> connector.inbound.reply mapping
  -> ConnectorToolInvoker
  -> Executor
```

## 关键模型

### ConnectorDefinition

connector 配置应区分实例身份、入站协议、出站工具和运行策略：

```ts
export interface ConnectorDefinition {
  id: string
  name: string
  version: string
  enabled: boolean
  protocol?: string
  credentials?: Record<string, string>
  auth?: ConnectorAuthConfig
  inbound?: ConnectorInboundDefinition
  tools: ConnectorToolDefinition[]
}

export interface ConnectorInboundDefinition {
  enabled: boolean
  protocol: string
  transports?: Array<'http' | 'websocket'>
  webhookPath?: string
  reply?: ConnectorReplyDefinition
}

export interface ConnectorReplyDefinition {
  tool: string
  input: Record<string, unknown>
}
```

不再使用 `handler` 作为核心身份。可以在迁移期读取旧字段，但 normalize 后必须得到 `inbound.protocol`。

### ConnectorToolCall

内部出站调用改为 camelCase：

```ts
export interface ConnectorToolCall {
  connectorId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ConnectorToolResult {
  ok: boolean
  data?: unknown
  error?: ConnectorError
  metadata: {
    connectorId: string
    toolName: string
    durationMs: number
    attempts: number
  }
}
```

旧 `ToolCallRequest` 可在 API 边界临时适配，但不应继续作为内部主类型。

### ConnectorError

所有层统一错误结构：

```ts
export interface ConnectorError {
  code:
    | 'CONNECTOR_NOT_FOUND'
    | 'CONNECTOR_DISABLED'
    | 'TOOL_NOT_FOUND'
    | 'CONFIG_INVALID'
    | 'AUTH_FAILED'
    | 'TOKEN_REFRESH_FAILED'
    | 'SIGNATURE_INVALID'
    | 'DUPLICATE_EVENT'
    | 'QUEUE_UNAVAILABLE'
    | 'EXECUTOR_TIMEOUT'
    | 'EXECUTOR_FAILED'
    | 'RATE_LIMITED'
    | 'CIRCUIT_OPEN'
    | 'POLICY_DENIED'
  message: string
  retryable: boolean
  cause?: unknown
  metadata?: Record<string, unknown>
}
```

这样重试、审计、HTTP 响应和 UI 展示都能共享同一语义。

## 解决方案

### 1. 拆分 ConnectorRegistry

目标组件：

| 组件 | 职责 |
|---|---|
| `ConnectorConfigLoader` | 读取 YAML、调用 schema 校验、返回 raw config |
| `ConnectorConfigNormalizer` | 把旧字段迁移为新字段，生成 `ConnectorDefinition` |
| `CredentialResolver` | 解析 env/secret store/项目凭据，不直接读 `process.env` |
| `ConnectorRegistry` | 保存和查询 connector 定义，不执行工具 |
| `ConnectorToolInvoker` | 工具调用编排：校验、重试、熔断、审计 |
| `ExecutorRouter` | 根据 executor 类型选择 executor |
| `Executor` | 单一 executor 只负责执行一种外部调用 |

`ConnectorRegistry.callTool(...)` 应迁移为：

```ts
runtime.outbound.invoke({
  connectorId,
  toolName,
  input,
})
```

迁移期可以保留 `registry.callTool(...)` 代理到 `ToolInvoker`，但 registry 本身不再拥有执行逻辑。

### 2. 统一配置加载

唯一入口：

```ts
const raw = await loader.load(configDir)
const definitions = raw.map(normalizer.normalize)
const validated = definitions.map(schema.parse)
registry.registerMany(validated)
```

规则：

- YAML schema 只在一个地方定义。
- registry 不再自己读文件。
- 缺失必需字段在加载期失败。
- 缺失凭据默认不静默替换为空，除非字段显式允许 optional。
- 加载结果包含 `sourcePath`，方便报错定位。
- 旧字段如 `handler`、`webhook_path` 在 normalizer 中迁移，并给出 deprecation warning。

### 3. 显式注入环境和凭据

core 接口：

```ts
export interface ConnectorRuntimeConfig {
  cwd: string
  configDir: string
  dataDir: string
  env?: Record<string, string | undefined>
  credentialProvider?: CredentialProvider
  appContext?: AppContext
  model?: ConnectorModelConfig
}

export interface CredentialProvider {
  resolve(connectorId: string, key: string): Promise<string | undefined>
}
```

server/cli 负责：

```ts
createConnectorRuntime({
  cwd,
  configDir,
  dataDir,
  env: process.env,
  credentialProvider,
})
```

core 不直接读取 `process.env`。

### 4. 收敛到单一 runtime 生命周期

保留：

```ts
createConnectorRuntime(config)
initializeConnectorRuntime(runtime)
disposeConnectorRuntime(runtime)
```

废弃并删除：

- `initConnectorGateway(...)`
- `getConnectorRegistry(...)` 进程级缓存
- `getConnectorInboundRuntime(...)` 全局单例
- `configureIdempotencyGuard(...)` / `getIdempotencyGuard(...)` 单例路径

server 应持有 runtime 实例，并通过依赖注入传给 routes 和 long-connection manager。

### 5. webhook 入口改为 connectorId

HTTP 路由：

```text
POST /api/connector/webhooks/:connectorId
GET  /api/connector/webhooks/:connectorId
```

server 转换为：

```ts
runtime.inbound.gateway.acceptHttp({
  connectorId,
  method,
  path,
  query,
  headers,
  body,
  transport: 'http',
})
```

gateway 规则：

1. 只用 `connectorId` 查 connector；
2. `protocol` 从 `connector.inbound.protocol` 读取；
3. connector 不存在、禁用或未启用 inbound，返回 404/403；
4. 不再按 handler 扫描 connector；
5. challenge、verify、decrypt、parse 全部由 protocol adapter 完成。

### 6. 长连接由 connector 配置驱动

飞书 WS 不应硬编码 `connectorId: 'feishu'`。server 启动时扫描：

```text
enabled connectors where inbound.enabled
  and inbound.protocol = feishu
  and inbound.transports includes websocket
```

每个 connector 实例启动自己的长连接客户端，凭据来自该 connector 的 credentials。

### 7. SQLiteInbox 变成可靠队列

表结构：

```sql
CREATE TABLE connector_inbox_events (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  last_error TEXT,
  queued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(connector_id, protocol, external_event_id)
);
```

处理规则：

1. `publish(event)` 事务插入，唯一键冲突返回 duplicate。
2. worker 领取 `pending` 且 `next_attempt_at <= now` 的事件。
3. 领取时设置 `processing` 和 `locked_until`。
4. 成功后标记 `completed`。
5. 失败后递增 `attempts`，未达上限回到 `pending` 并设置退避。
6. 达上限后标记 `dead`。
7. 周期性回收 `locked_until < now` 的 processing 事件。
8. 提供 `requeueDead(eventId)` 和 `discard(eventId)` 管理能力。

`IdempotencyGuard` 对入站事件可删除或只作为非 inbox 实现的接口，不再单独先写。

### 8. Responder 改为配置驱动

Responder 流程：

```text
replyAddress.connectorId
  -> registry.getDefinition(connectorId)
  -> connector.inbound.reply
  -> render mapping with { replyAddress, message }
  -> outbound.invoke({ connectorId, toolName, input })
```

协议内置 strategy 只作为 fallback 或 adapter plugin，不应是新增协议的主要路径。

### 9. 出站执行拆分

`ConnectorToolInvoker` 编排：

```text
validate connector/tool enabled
  -> validate input schema
  -> resolve auth/token
  -> circuit breaker check
  -> retry policy
  -> executor.execute
  -> audit log
  -> normalized result/error
```

executor 不关心 registry、不关心重试、不关心审计，只负责执行。

### 10. 定义模板语言

建议使用受限模板 AST，而不是继续扩展正则替换。

最小能力：

```text
$input.path
$credentials.key
$token
$replyAddress.path
$message.path
$env.key
$json(value)
$string(value)
```

规则：

- 默认缺失变量是加载期或执行期错误，不静默变空。
- 只有明确字段能访问 credentials。
- URL、headers、query、body 的类型渲染规则分开。
- body 中完整引用保留原类型，字符串插值返回字符串。
- 函数白名单固定。
- 模板在加载期 parse，执行期只 evaluate。

### 11. 统一 auth/token 注入

auth 配置应表达 token 放在哪里：

```ts
export interface TokenInjection {
  in: 'header' | 'query' | 'body' | 'template-only'
  name?: string
  scheme?: 'Bearer' | 'raw'
}
```

示例：

```yaml
auth:
  type: token
  token:
    url: https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
    method: POST
    response_field: tenant_access_token
    expires_in_field: expire
    inject:
      in: template-only
```

HTTP executor 不再默认把 custom token 放进 Authorization。

### 12. script executor 降级为隔离能力

短期：

- 默认删除生产配置中的 script executor 使用；
- 保留类型但加载期要求 `runtime.capabilities.allowUnsafeScriptExecutor === true`；
- 不从 `process.env` 读取开关。

长期：

- 使用独立进程/worker；
- 禁止访问 fs/process/network，除非显式 capability；
- 限制 CPU、内存、时间；
- 输入输出只走 JSON；
- 全量审计。

### 13. SQL executor 参数化

SQL 工具配置改为：

```yaml
executor: sql
executor_config:
  connection_id: energy_db
  mode: read
  statement: |
    SELECT * FROM meter WHERE id = :meterId LIMIT :limit
  parameters:
    meterId: "$input.meterId"
    limit: "$input.limit"
  max_rows: 100
```

规则：

- 禁止字符串拼接 SQL；
- 参数必须绑定；
- `mode: read` 时禁止写语句；
- `max_rows` 强制追加或执行后截断；
- 多语句默认禁止；
- 写操作必须有审批或 policy。

### 14. 拆分 InboundAgentService

目标目录：

```text
packages/core/src/application/inbound-agent/
  inbound-agent-service.ts
  conversation-resolver.ts
  approval-service.ts
  agent-runner.ts
  message-writer.ts
  post-process.ts
```

职责：

| 服务 | 职责 |
|---|---|
| `InboundAgentService` | 编排标准入站事件处理 |
| `ConversationResolver` | connector channel 到 conversationId 的策略 |
| `ApprovalService` | 检测、保存、恢复审批 |
| `AgentRunner` | 创建 agent、消费 stream、返回结构化结果 |
| `MessageWriter` | 保存 user/assistant/tool parts |
| `PostProcessService` | 记忆、标题、成本等后台任务 |

connector/inbound 不再包含完整 Agent 执行循环。

### 15. 审批持久化

表或 DataStore 记录：

```ts
export interface PendingApproval {
  id: string
  conversationId: string
  connectorEventId?: string
  replyAddress: ReplyAddress
  pausedModelMessages: unknown[]
  accumulatedSteps: unknown[]
  responseText: string
  writtenFiles: Array<{ path: string; content: string }>
  approvedTools: string[]
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'expired'
  createdAt: number
  expiresAt: number
}
```

审批回复匹配：

1. 优先按审批消息引用或审批 id；
2. 同一会话只有一个 pending 时允许“同意/拒绝”简写；
3. 多个 pending 时要求用户明确选择；
4. 不明确时默认不执行。

### 16. 审计持久化

审计表：

```sql
CREATE TABLE connector_audit_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  connector_id TEXT,
  tool_name TEXT,
  event_id TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  message TEXT NOT NULL,
  duration_ms INTEGER,
  metadata TEXT
);
```

必须记录：

- config load success/failure；
- inbound accepted/rejected/duplicate；
- inbox retry/dead-letter；
- token refresh；
- tool call success/failure；
- circuit breaker open/close；
- policy denied；
- approval created/approved/denied/expired。

### 17. 文档收敛

旧文档处理：

- `connector-gateway-design-v2.md` 标记为历史设计；
- `connector-inbound-first-principles-design.md` 保留作为入站专项设计；
- 本文作为全局改造主文档；
- 后续实现以本文的身份模型、runtime 生命周期和边界划分为准。

## 目标目录建议

```text
packages/core/src/extensions/connector/
  config/
    schema.ts
    loader.ts
    normalizer.ts
    credentials.ts
  registry/
    registry.ts
  runtime/
    runtime.ts
    lifecycle.ts
  inbound/
    types.ts
    gateway/
    adapters/
    inbox/
    responder/
  outbound/
    types.ts
    tool-invoker.ts
    executor-router.ts
    auth/
    token/
    executors/
      http.ts
      sql.ts
      mock.ts
  observability/
    audit-log.ts
    errors.ts
    metrics.ts
```

实际迁移时可以保留旧路径再逐步移动，但新代码应按这个职责边界写。

## 迁移计划

### 当前实施状态

已实施：

- HTTP webhook route 改为 `:connectorId`，server 不再按 `handler` 分支解析协议。
- `ConnectorInboundGateway` 不再按 handler 扫描 connector；HTTP 入站用 `connectorId` 查实例，`protocol` 来自 connector 配置。
- 入站幂等收敛到 inbox 发布边界；gateway 不再先写独立 `IdempotencyGuard`。
- `SQLiteInbox` 增加事务唯一约束、`attempts`、`max_attempts`、`next_attempt_at`、`locked_until`、visibility timeout、重试和 dead-letter。
- `MemoryInbox` 改为按 `connectorId:protocol:externalEventId` 判重。
- Responder 优先读取 `connector.inbound.reply` 映射；协议策略只作为显式 fallback/plugin。
- 内部新增 `ConnectorToolCall` camelCase 类型，`ConnectorRegistry.callTool(...)` 支持新旧调用模型。
- 飞书长连接优先按 connector 配置启动，并使用对应 `connectorId` 进入 gateway。
- `bootstrap()` 直接创建 `ConnectorRuntime`，server 通过 `CoreRuntime.connectorRuntime` 绑定入站 Agent handler。
- server connector tools/admin/test/webhook/Feishu WS 路径不再调用 core 全局 connector 单例。
- Agent 工具装配通过 `AppContext.runtime.connectorRegistry` 获取 connector 工具，不再在正常路径中重新获取全局 registry。
- `ConnectorRegistry` 的主路径通过 `ConnectorRuntimeConfig.env` 接收环境变量快照，不再自行读取 `process.env` 替换 YAML 占位符。
- script executor 启用改为 `allowUnsafeScriptExecutor` 显式 runtime capability，主路径不再读取 `CONNECTOR_ENABLE_SCRIPT_EXECUTOR`。

仍待实施：

- 删除或降级导出全局 `initConnectorGateway(...)` / `getConnectorRegistry(...)` 兼容 API；当前正常 server/runtime/Agent 路径已不再依赖它们。
- 拆分 `ConnectorRegistry` 的 loader、registry、invoker、executor router 职责。
- 将 YAML 加载统一到单一 schema/normalizer；清理 deprecated `webhook-config`、credential store、multi-sql helper 中仍存在的 `process.env` 读取。
- 把 `AgentInboundHandler` 拆成 application 层服务，并持久化审批状态。
- 定义受限模板语言，重构 token/auth 注入、SQL 参数化和 script executor 隔离。
- 将 AuditLogger 的 SQLite 持久化闭环补齐。

### 阶段 1：固定身份模型和 runtime 生命周期

1. 将 webhook route 改为 `/:connectorId`。
2. gateway 删除按 handler 扫描 connector 的逻辑。
3. 飞书 WS 从 connector 配置启动，不再硬编码 `feishu`。
4. server 持有 `ConnectorRuntime` 实例，不再通过 core 全局单例取 runtime。
5. core 删除或隔离废弃的 `initConnectorGateway(...)` 路径。

验收：

- 两个同协议 connector 可以同时存在；
- webhook 能准确进入对应 connector；
- 测试之间不共享 connector 单例状态。

### 阶段 2：可靠 inbox 和幂等事务化

1. 改造 `SQLiteInbox` 表结构。
2. `publish(event)` 事务内完成唯一约束判重和入队。
3. 增加 worker lease、重试、退避、dead-letter。
4. 删除入站路径上的独立 `IdempotencyGuard` 预写。
5. 增加 inbox 管理和测试。

验收：

- 进程在 processing 中崩溃后事件能恢复；
- 重复外部事件不会处理两次；
- inbox 写入失败不会生成幂等假阳性；
- 失败事件可重试并最终进入 dead-letter。

### 阶段 3：拆分出站执行

1. 引入 `ConnectorToolCall` / `ConnectorToolResult`。
2. 新增 `ConnectorToolInvoker`。
3. `ConnectorRegistry.callTool(...)` 改为兼容代理。
4. executor 不再由 registry 直接创建和编排。
5. 审计、重试、熔断移到 invoker。

验收：

- registry 只做查询；
- 工具调用错误码统一；
- HTTP/mock/sql executor 测试能单独运行；
- 旧 API 临时可用但内部不再传播 snake_case。

### 阶段 4：配置和凭据加载收敛

1. 用唯一 zod schema 校验 connector YAML。
2. normalizer 迁移旧字段。
3. `CredentialResolver` 显式注入 env/secret provider。
4. 缺失必需凭据在加载期或调用前报结构化错误。
5. 删除 registry 内部 YAML 读取和 `process.env` 读取。

验收：

- schema、类型和 runtime 使用同一配置模型；
- 缺失凭据不会静默变空；
- core 单元测试无需设置真实 `process.env`。

### 阶段 5：Responder 配置化

1. YAML 增加 `inbound.reply`。
2. Responder 根据 connector 配置渲染 reply tool input。
3. 协议策略降为 fallback/plugin。
4. 移除 Agent handler 中所有协议回复分支。

验收：

- 新平台回复不需要改 core 代码；
- `replyAddress` 是应用服务唯一需要理解的回复信息。

### 阶段 6：Agent 入站应用服务拆分

1. 将会话解析、审批、Agent runner、消息写入、后处理拆分。
2. 审批状态迁移到 DataStore/runtime storage。
3. 后台任务变为可观测任务，不只依赖 `setImmediate`。

验收：

- `AgentInboundHandler` 不再包含完整 stream loop；
- 审批重启后仍可恢复；
- 多 pending 审批能明确处理；
- Web 聊天审批行为不被 connector 特化逻辑污染。

### 阶段 7：模板、安全和审计

1. 定义并实现受限模板 parser/evaluator。
2. token injection 配置化。
3. script executor 隔离或移除。
4. SQL executor 参数化。
5. AuditLogger 真正持久化。

验收：

- 模板错误可定位到 connector 文件和字段；
- credentials 访问范围可审计；
- SQL 无字符串拼接注入路径；
- 审计记录跨进程可查询。

## 必需测试

### 配置测试

- YAML schema 拒绝缺失 `id`、非法 executor、非法 inbound protocol。
- 旧字段 `handler` 能被 normalizer 迁移并给出 warning。
- 缺失必需 credential 不会静默替换为空字符串。

### 入站测试

- `POST /api/connector/webhooks/:connectorId` 路由到正确 connector。
- 同协议多个 connector 不互相串。
- 飞书 HTTP 和 WS 生成相同标准事件模型。
- 微信 challenge 和飞书 challenge 仍返回平台要求格式。
- 重复 `externalEventId` 不重复处理。
- processing 崩溃后 visibility timeout 能回收。
- 超过重试上限进入 dead-letter。

### 出站测试

- `ConnectorToolInvoker` 对 disabled connector、missing tool、auth failure、timeout 返回统一错误码。
- retry 只重试可重试错误。
- circuit breaker open 后不调用 executor。
- HTTP executor token 注入位置符合配置。
- SQL executor 使用参数绑定。
- script executor 默认不可用。

### 回复测试

- Responder 根据 `replyAddress.connectorId` 找 reply 配置。
- reply 映射能访问 `replyAddress` 和 `message`。
- 新协议只通过 YAML 配置即可回复。

### 应用服务测试

- connector 入站消息创建命名空间 conversationId，不影响 Web 聊天会话。
- 审批 pending 持久化后重启仍能恢复。
- 多个 pending 审批时简单“同意”不会误执行。
- 记忆提取、标题生成、成本持久化失败不影响最终回复发送。

## 非目标

- 不把 Web 聊天消息改造成 connector 入站事件。
- 不让 connector inbox 承担 Agent 语义记忆职责。
- 不要求第一阶段支持分布式队列；SQLite 是单机默认实现。
- 不在协议 adapter 中创建会话或运行 Agent。
- 不在 server 中实现平台协议解析。

## 最终目标状态

完成后 connector 的代码关系应变成：

```text
server
  -> owns runtime lifecycle
  -> passes HTTP/WS inputs to connector runtime

connector inbound
  -> verifies/decrypts/parses
  -> writes reliable InboundEvent inbox
  -> exposes Responder by replyAddress

application inbound-agent
  -> consumes InboundEvent
  -> resolves conversation
  -> runs Agent
  -> persists messages/approvals/cost/memory
  -> calls Responder

connector outbound
  -> invokes connector tools
  -> resolves auth/token
  -> executes via typed executors
  -> retries/circuit-breaks/audits

connector config
  -> validates YAML
  -> resolves credentials
  -> registers connector definitions
```

这时 connector 模块的核心不变量是：

1. `connectorId` 是实例身份；
2. `protocol` 是协议解释方式；
3. `replyAddress` 是回复寻址能力；
4. inbox 是可靠移交边界；
5. registry 只注册，不执行；
6. outbound invoker 只执行标准工具调用；
7. Agent 应用服务消费标准事件，不理解平台协议。
