# 连接器入站第一性原理设计

> 本文档从第一性原理定义 Connector Gateway 的入站侧。
> 它有意将平台入口与 Agent 执行分离，确保 IM/webhook 集成不会改变正常的 Web 聊天体验。

## 目标

连接器入站模块只为一件事而存在：

```
外部平台输入 -> 可信内部事件 -> 可靠移交 -> 可寻址回复
```

除此之外的内容都不属于入站模块的核心目的。

入站模块不是 Agent 运行时，不是会话领域，也不是审批状态机。它是把外部平台流量转换为内部事件的边界，并提供一种回复到同一个外部位置的方式。

## 非目标

- 不改变 Web 聊天的消息流、UI 行为、审批体验或会话存储语义。
- 不让 Web 聊天依赖连接器入站队列、webhook 适配器或回复策略。
- 不把 Agent 执行、标题生成、记忆提取、成本持久化或长流程状态放进入站协议层。
- 默认单服务器部署不要求 Redis/Kafka。
- 不假设一种平台类型就等于一个连接器实例。

## 基础事实

| 事实 | 推论 |
|---|---|
| Webhook 平台要求快速确认。 | HTTP/WS 入口必须快速移交工作并返回。 |
| Agent 执行可能持续数秒或数分钟。 | 入口接收与后续处理必须解耦。 |
| 外部平台使用不同的签名、加密、事件形状和回复 API。 | 协议适配器必须可插拔。 |
| 一个项目可能为同一平台配置多个连接器。 | 事件需要同时包含 `connectorId` 和 `protocol`。 |
| 回复必须回到原始外部频道或消息。 | 事件需要持久的 `replyAddress`。 |
| 服务端可能通过 HTTP webhook 或长连接接收事件。 | 入站模块必须支持多种传输方式。 |
| Web 聊天已经是一等本地用户体验。 | 连接器入站必须复用核心服务，同时不改变 Web 聊天行为。 |
| 审批是执行暂停，不是 webhook 关注点。 | 审批状态属于应用/运行时持久化，而不是协议入口。 |

## 层边界

| 层 | 拥有 | 不拥有 |
|---|---|---|
| `packages/server` | Hono 路由、WebSocket/长连接启动、进程环境、HTTP 响应 | 协议解析细节、Agent 执行 |
| `core/extensions/connector/inbound` | 校验、解密、解析、幂等、事件规范化、收件箱发布、回复寻址 | 会话创建、Agent 循环、审批恢复 |
| `core/extensions/connector` | 连接器注册表、凭据、工具调用、回复工具执行 | 聊天领域行为 |
| `core/application/inbound-agent` | 用例：消费入站事件、运行 Agent、发送回复 | 平台特定 webhook/WS 处理 |
| `core/runtime` 和 `core/api` | `createAgent`、`AppContext`、DataStore、消息、成本、记忆、权限 | 外部平台协议处理 |
| `packages/web` | Web 聊天 UI 和浏览器交互模型 | 连接器入站机制 |

## 高层流程

```text
HTTP webhook 或平台长连接
  -> 服务端传输适配器
  -> InboundGateway.accept(...)
  -> ProtocolAdapter.verify/decrypt/parse(...)
  -> IdempotencyGuard.reserve(...)
  -> InboundInbox.publish(event)
  -> 快速确认平台请求

后台消费者
  -> InboundAgentService.handle(event)
  -> ConversationResolver.resolve(event)
  -> AgentRunner.run(...)
  -> Responder.respond(event.replyAddress, output)
```

前半部分是连接器入站。后半部分是使用核心运行时能力的应用服务。

## 标准事件模型

当前的 `InboundMessageEvent` 形状应演进为显式表达连接器实例身份、协议身份和回复寻址。

```ts
export interface InboundEvent {
  id: string
  connectorId: string
  protocol: 'feishu' | 'wecom' | 'wechat-mp' | 'wechat-kf' | string
  transport: 'http' | 'websocket' | 'test' | string
  externalEventId: string
  channel: {
    id: string
    type?: string
  }
  sender: {
    id: string
    name?: string
    type: 'user' | 'bot'
  }
  message: {
    id: string
    type: 'text' | 'image' | 'file' | 'event' | string
    text?: string
    raw?: unknown
  }
  replyAddress: ReplyAddress
  receivedAt: number
}

export interface ReplyAddress {
  connectorId: string
  protocol: string
  channelId: string
  messageId?: string
  threadId?: string
  raw?: unknown
}
```

`connectorId` 标识已配置的连接器实例。`protocol` 标识如何解释平台载荷。这样可以避免在同一部署中存在多个飞书或微信连接器时发生破坏性行为。

## 建议目录结构

```text
packages/core/src/extensions/connector/inbound/
  index.ts
  types.ts
  gateway/
    inbound-gateway.ts
    http-request.ts
  adapters/
    protocol-adapter.ts
    wechat-adapter.ts
    feishu-http-adapter.ts
    feishu-ws-adapter.ts
    test-adapter.ts
  crypto/
    wechat-crypto.ts
    feishu-crypto.ts
  inbox/
    inbound-inbox.ts
    memory-inbox.ts
    sqlite-inbox.ts
  responder/
    responder.ts
    reply-strategy.ts
    wechat-reply-strategy.ts
    feishu-reply-strategy.ts
```

面向 Agent 的应用代码应位于 `connector/inbound` 之外：

```text
packages/core/src/application/inbound-agent/
  inbound-agent-service.ts
  conversation-resolver.ts
  agent-runner.ts
  approval-service.ts
  post-process.ts
```

## 入站网关

网关协调平台适配器和收件箱。它不依赖 Agent。

```ts
export interface InboundGateway {
  acceptHttp(request: InboundHttpRequest): Promise<InboundAcceptResult>
  acceptExternal(input: ExternalInboundInput): Promise<InboundAcceptResult>
}

export interface InboundAcceptResult {
  accepted: boolean
  status: number
  body?: string | Record<string, unknown>
  eventId?: string
  reason?: string
}
```

职责：

- 从路径、连接器 id 或服务端提供的元数据解析连接器配置。
- 选择协议适配器。
- 校验签名和 token。
- 在需要时解密载荷。
- 将平台载荷解析为 `InboundEvent`。
- 执行幂等预占。
- 将已接受的事件发布到 `InboundInbox`。
- 返回适合该平台的 challenge/ack/error 响应。

## 协议适配器

```ts
export interface ProtocolAdapter {
  readonly protocol: string
  verify(input: AdapterInput, config: ConnectorInboundConfig): Promise<boolean>
  decrypt?(input: AdapterInput, config: ConnectorInboundConfig): Promise<AdapterInput>
  parse(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundEvent>
  challenge?(input: AdapterInput, config: ConnectorInboundConfig): Promise<InboundAcceptResult | null>
}
```

适配器可以了解平台协议规则，但不能创建会话或运行 Agent。

## 收件箱

收件箱是快速入口与慢速处理之间的持久化边界。

```ts
export interface InboundInbox {
  publish(event: InboundEvent): Promise<PublishResult>
  subscribe(handler: (event: InboundEvent) => Promise<void>): Unsubscribe
  getStats(): InboundInboxStats
}
```

默认实现：

- `MemoryInbox` 用于测试和本地开发。
- `SQLiteInbox` 作为服务端默认实现，因为项目已有基于 SQLite 的持久化能力。
- Redis Streams 或其他队列仅用于多实例部署。

当前的 fire-and-forget 队列要么应成为真正的异步调度器，要么应获得真实队列语义：持久化状态、重试、可见性超时和可观测失败。

### Inbox 与 core 记忆系统的区别

这里的 `Inbox` 是“收件箱/队列”，不是 Agent 的记忆系统。

| 名称 | 属于 | 保存什么 | 生命周期 | 目的 |
|---|---|---|---|---|
| `MemoryInbox` | connector inbound | 进程内待处理 `InboundEvent` | 进程退出即丢失 | 测试、本地开发、无持久化快速验证 |
| `SQLiteInbox` | connector inbound | 持久化待处理 `InboundEvent` 和处理状态 | 跨进程重启保留 | webhook 快速 ack 后可靠移交后台处理 |
| core 记忆系统 | runtime/application | 用户偏好、长期事实、可供 Agent 检索的上下文 | 会话或长期存储策略决定 | 让 Agent 后续对话能利用历史信息 |

两者名字里都可能出现 `memory`，但语义完全不同：

- `MemoryInbox` 的 memory 指内存队列实现，关注事件是否被处理。
- core 记忆系统的 memory 指 Agent 可用的语义记忆，关注未来推理和上下文召回。
- 入站队列不应被 Agent 检索；Agent 记忆也不应承担 webhook 可靠投递职责。

## 回复器

回复器将内部输出转换为平台回复。

```ts
export interface Responder {
  respond(address: ReplyAddress, message: OutboundMessage): Promise<RespondResult>
}

export interface ReplyStrategy {
  readonly protocol: string
  buildToolCall(address: ReplyAddress, message: OutboundMessage): ToolCallRequest
}
```

回复器在内部使用 `ConnectorRegistry.callTool`。应用服务不应根据 `feishu`、`wecom` 或 `wechat-mp` 分支处理；它们应调用 `Responder.respond(...)`。

## 入站 Agent 应用服务

应用服务消费标准入站事件，并使用现有核心运行时。

```ts
export interface InboundAgentService {
  handle(event: InboundEvent): Promise<void>
}
```

职责：

- 为连接器频道解析或创建会话。
- 使用 DataStore 追加入站用户消息。
- 通过 `createAgent({ context, ... })` 创建 Agent。
- 消费 Agent 流。
- 使用现有运行时服务持久化助手消息、成本、记忆和标题。
- 通过 `Responder` 发送最终回复。

该服务可以依赖 `AppContext`、`DataStore`、`createAgent` 和 `Responder`。入站网关不能依赖这些能力。

## 会话策略

最简单的默认策略可以保持为：

```text
conversationId = connector:<connectorId>:channel:<channelId>
```

但这必须被视为策略，而不是协议事实。该策略应隔离在 `ConversationResolver` 中，以便未来模式支持：

- 每个频道一个会话；
- 每个用户加频道一个会话；
- 显式的新线程命令；
- 平台线程映射。

改变该策略不得影响 Web 聊天会话 id。

## 审批策略

审批是 Agent 执行暂停，不是入站协议功能。

审批持久化应位于 DataStore 或运行时拥有的存储中，而不是 `connector/inbound` 中。

审批记录必需字段：

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

回复匹配规则：

1. 如果平台回复引用了审批消息或包含审批 id，则使用该 id。
2. 如果解析出的会话中恰好只有一个待审批项，则允许简单文本批准或拒绝。
3. 如果存在多个待审批项，不要猜测。要求用户指出具体审批项。
4. 如果回复含义不明确，默认不执行任何操作。

这能在不改变 Web 聊天审批体验的前提下保持安全性。

## Web 聊天兼容性

该设计必须把 Web 聊天体验作为不变量来维护。

规则：

- Web 聊天继续调用现有聊天 API 和 `createAgent` 路径。
- Web 聊天消息不得经过连接器入站收件箱。
- 连接器入站会话策略必须带命名空间，不能与 Web 聊天会话 id 冲突。
- 连接器特定的审批文本解析只能对源自连接器的事件运行。
- 共享运行时改进只有在与 Web 聊天行为兼容时才允许。
- DataStore schema 增加必须是追加式迁移；不得重写现有消息格式。
- 后台连接器处理不得阻塞聊天、会话、权限、记忆或文件相关的 Web 请求。

## 服务端集成

HTTP webhook 路由应变薄：

```ts
app.post('/api/connector/webhooks/:handler', async c => {
  const result = await runtime.connectorInbound.acceptHttp(toInboundHttpRequest(c))
  return toHonoResponse(result)
})
```

飞书长连接也应通过同一个网关路由：

```ts
await runtime.connectorInbound.acceptExternal({
  connectorId: 'feishu',
  protocol: 'feishu',
  transport: 'websocket',
  raw: data,
})
```

服务端仍可拥有环境变量和进程生命周期。它不应重复实现事件规范化逻辑。

## 运行时构造

`CoreRuntime` 最终应暴露一个连接器入站运行时对象：

```ts
export interface ConnectorInboundRuntime {
  gateway: InboundGateway
  inbox: InboundInbox
  responder: Responder
  startConsumer(service: InboundAgentService): void
  stopConsumer(): void
}
```

`bootstrap()` 可以初始化注册表和存储。是否启动入站消费者由服务端决定，因为服务端拥有模型凭据和部署生命周期。

## 实现后设计审查

当前实现已经移除了旧的 `InboundMessageEvent`、旧入站队列和旧 webhook handler 兼容层。目标状态是：

```text
packages/server
  -> ConnectorInboundGateway
  -> InboundEvent
  -> InboundInbox
  -> InboundAgentService
  -> Responder(replyAddress)
```

这条链路中不应再出现“新事件转旧事件再处理”的桥接。所有入站消费者都应直接消费 `InboundEvent`，所有回复都应通过 `ReplyAddress` 寻址。

### 已解决的结构问题

- 服务端 HTTP webhook 路由只负责把 Hono request 转成 `InboundHttpRequest`，不再解析飞书、微信或测试服务载荷。
- 飞书长连接通过 `acceptExternal(...)` 进入同一个网关，不再在 server 中手写标准事件。
- `AgentInboundHandler` 和 `InboundEventProcessor` 直接处理 `InboundEvent`。
- `ConnectorRuntime` 不再暴露旧 `eventQueue` / `eventProcessor` 双轨字段；运行时边界应围绕 `ConnectorInboundRuntime` 和入站应用服务组织。
- `connectorId` 和 `protocol` 明确分离，允许同一协议存在多个 connector 实例。

### 仍不合理的设计点

#### 1. SQLiteInbox 还不是真正可靠队列

当前 `SQLiteInbox` 已经有 `pending`、`processing`、`completed`、`failed` 状态，但还缺少可靠队列的关键语义：

- 没有 `attempts` 重试次数；
- 没有 `nextAttemptAt` 延迟重试时间；
- 没有 `lockedUntil` 或 worker lease；
- 没有可见性超时；
- 没有死信状态；
- 没有按失败原因可观测地重放或丢弃。

如果进程在事件处于 `processing` 时崩溃，该事件可能永久卡住。`SQLiteInbox` 应进一步演进为单机可靠队列，而不是“带状态的 fire-and-forget”。

建议事件表演进为：

```ts
interface InboxRecord {
  id: string
  connectorId: string
  protocol: string
  externalEventId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead'
  payload: InboundEvent
  attempts: number
  maxAttempts: number
  nextAttemptAt: number
  lockedUntil?: number
  lastError?: string
  queuedAt: number
  updatedAt: number
}
```

处理规则：

1. 订阅者只领取 `status = pending` 且 `nextAttemptAt <= now` 的事件。
2. 领取时设置 `status = processing` 和 `lockedUntil = now + visibilityTimeoutMs`。
3. 处理成功后标记 `completed`。
4. 处理失败后增加 `attempts`，未超过上限则回到 `pending` 并设置退避时间。
5. 超过上限后标记 `dead`。
6. 启动或轮询时将超时的 `processing` 事件回收为 `pending`。

#### 2. 幂等边界和 inbox 发布不是原子操作

当前高层流程中有：

```text
IdempotencyGuard.reserve(...)
InboundInbox.publish(event)
```

如果幂等记录写入成功，但 inbox 写入失败，那么同一个外部事件再次进入时会被识别为重复，导致事件丢失。

更合理的模型是让 inbox 自己承担幂等唯一约束：

```text
UNIQUE(connectorId, protocol, externalEventId)
```

`publish(event)` 应在一个 SQLite 事务中完成：

1. 尝试插入事件；
2. 如果唯一键冲突，返回 duplicate；
3. 如果插入成功，事件进入 pending。

这样 `IdempotencyGuard` 可以被收敛为 inbox 的一部分，或者只保留为跨队列实现的接口抽象。

#### 3. Webhook 路由必须以 connectorId 为主键

路径只包含 handler 或 protocol 时，例如：

```text
/api/connector/webhooks/feishu
```

在多飞书、多微信公众号、多企业微信应用场景下无法唯一定位 connector 实例。按 handler 查找第一个 connector 是不稳定行为。

建议服务端入口改为：

```text
/api/connector/webhooks/:connectorId
```

网关解析规则：

1. `connectorId` 来自路径或服务端显式元数据；
2. `protocol` 来自 connector 配置的 `inbound.protocol` 或 `inbound.handler`；
3. 不允许仅凭 protocol 选择 connector；
4. 如果 connector 未启用 inbound，返回 404 或 403。

这能保证“一个平台类型不等于一个 connector 实例”成为代码不变量。

#### 4. Responder 不应硬编码协议分支

当前 `Responder` 仍通过内置策略理解 `feishu`、`wecom`、`wechat-mp`、`wechat-kf`。这比把分支放在 Agent 应用服务中好，但仍然要求新增协议时修改 core 代码。

更好的方向是把回复工具声明放入 connector 配置：

```yaml
inbound:
  enabled: true
  protocol: feishu
  webhook_path: /api/connector/webhooks/feishu-work
  reply:
    tool: reply_message
    input:
      reply_context: "$replyAddress"
      text: "$message.text"
```

Responder 的职责应变为：

1. 根据 `replyAddress.connectorId` 找 connector；
2. 读取 connector inbound reply 配置；
3. 把 `ReplyAddress` 和 `OutboundMessage` 映射为 `ToolCallRequest`；
4. 调用 `ConnectorRegistry.callTool(...)`。

协议专用策略可以保留为插件，但不应是默认扩展路径。

#### 5. 出站工具调用契约仍是旧命名

入站事件已经使用 `connectorId`、`replyAddress` 等 camelCase 模型，但工具调用仍是：

```ts
export interface ToolCallRequest {
  connector_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}
```

这会在核心内部继续传播 snake_case 双轨。建议内部模型演进为：

```ts
export interface ConnectorToolCall {
  connectorId: string
  toolName: string
  input: Record<string, unknown>
}
```

如果 YAML、HTTP 模板或外部 API 需要 snake_case，应在 executor 或模板边界转换，而不是污染 core 内部接口。

#### 6. ConnectorRegistry 职责过重

当前 `ConnectorRegistry` 同时负责：

- 扫描和加载 YAML；
- 环境变量替换；
- 保存 connector 定义；
- 查找工具；
- 熔断；
- 重试；
- 审计；
- executor 选择；
- executor 创建；
- script executor 安全开关。

这使它既是 registry，又是 invoker，又是 execution runtime。后续建议拆分为：

| 组件 | 职责 |
|---|---|
| `ConnectorLoader` | 读取和校验 YAML |
| `CredentialResolver` | 凭据解析和环境注入 |
| `ConnectorRegistry` | 保存和查询 connector 定义 |
| `ToolInvoker` | 处理重试、熔断、审计 |
| `ExecutorRouter` | 根据 executor 类型选择执行器 |
| `Executor` | 只执行一种工具调用 |

#### 7. core 包仍直接读取 `process.env`

`ConnectorRegistry` 在加载 YAML 时直接读取 `process.env` 替换凭据。core 作为库不应假设进程环境存在，也不应隐藏凭据来源。

建议改为显式注入：

```ts
export interface ConnectorRuntimeConfig {
  env?: Record<string, string | undefined>
  credentialProvider?: CredentialProvider
}
```

server/cli 可以读取环境变量并传入 core。这样测试、桌面应用、嵌入式运行时和多租户部署都能有清晰边界。

#### 8. 入站 Agent 应用服务仍需要继续拆分

虽然 Agent 执行已经不在协议网关里，但当前 `AgentInboundHandler` 仍然承担太多职责：

- 会话解析；
- 用户消息持久化；
- 审批回复检测；
- 挂起现场恢复；
- Agent 创建；
- Agent stream 消费；
- assistant 消息构造；
- 文件写入结果拼接；
- 记忆提取；
- 标题生成；
- 成本持久化。

建议逐步拆到：

```text
application/inbound-agent/
  inbound-agent-service.ts
  conversation-resolver.ts
  approval-service.ts
  agent-runner.ts
  message-writer.ts
  post-process.ts
```

`InboundAgentService` 只编排这些服务，不直接包含完整执行循环。

#### 9. 审批状态仍是内存状态

审批是运行时暂停，不是 webhook 协议功能。但它必须可靠，因为用户可能数分钟后才回复审批。纯内存 Map 的问题是：

- 进程重启会丢审批；
- 多实例无法共享；
- 无法审计；
- 无法列出待审批项；
- 无法处理多个待审批项的明确选择。

审批状态应落到 DataStore 或运行时持久化存储。字段应以本文前面的 `PendingApproval` 为准，并保存 `replyAddress`。

#### 10. HTTP executor 的模板语言边界不清

connector YAML 里存在 `${input.xxx}`、`${token}`、`$json(...)` 等模板表达式。它们目前更像字符串替换能力，而不是明确的受限模板语言。

后续应定义模板能力边界：

- 允许读取哪些变量；
- 是否允许函数；
- 函数白名单是什么；
- 缺失变量如何处理；
- 输出类型如何保留；
- 是否允许访问 credentials；
- 错误是否在加载期发现。

长期方向应是受限表达式解析或模板 AST，而不是随处做字符串替换。

### 低优先级清理

- `inbound/feishu-crypto.ts` 和 `inbound/crypto/feishu-crypto.ts` 目录语义重复，应物理移动到 `inbound/crypto/` 后删除根目录文件。
- `webhook-config.ts` 仍以 handler 为主视角，后续应改为按 `connectorId` 获取 inbound config。
- `test-adapter` 可以保留兼容测试载荷字段，但标准测试载荷应使用 `channelId`、`senderId`、`messageId` 等 camelCase 字段。
- `IdempotencyGuard` 数据表字段仍叫 `connector_type`，如果继续独立存在，应改为 `connector_id` 和 `protocol`。

## 出站设计原则

连接器出站并不等于“Agent 工具调用”。出站有两类能力：

1. Agent 主动调用 connector tool，例如查数据、发通知、创建工单；
2. 入站事件处理完成后，系统按 `replyAddress` 回复原平台位置。

两者共享底层 executor，但不应共享上层语义。

建议区分：

```ts
export interface ConnectorToolCall {
  connectorId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ConnectorReplyCall {
  replyAddress: ReplyAddress
  message: OutboundMessage
}
```

`ConnectorRegistry.callTool(...)` 面向通用工具调用；`Responder.respond(...)` 面向可寻址回复。应用服务不应把回复伪装成普通工具选择逻辑。

## 下一阶段设计决策

优先级建议：

1. 先把 `SQLiteInbox` 做成真正可靠队列：事务幂等、重试、可见性超时、死信。
2. 把 webhook 路由从 `:handler` 改为 `:connectorId`，消除多实例歧义。
3. 把 Responder 的 reply tool 映射下沉到 connector YAML，移除硬编码协议策略。
4. 把审批状态迁移到 DataStore，移除内存挂起状态。
5. 拆分 `ConnectorRegistry` 的加载、凭据、调用、执行职责。
6. 将出站内部工具调用类型从 snake_case 迁移到 camelCase。

这组改动完成后，Connector Gateway 的边界会更稳定：

```text
入站协议边界：可信接收、协议规范化、可靠移交
应用执行边界：会话、审批、Agent、消息、成本、记忆
出站执行边界：通用工具调用、可寻址回复、凭据和 executor
```

## 迁移计划

1. 添加新的事件类型和适配器接口。
2. 删除旧的 `InboundMessageEvent`、旧入站队列和旧 webhook handler 兼容层。
3. 将 crypto 文件移动到 `inbound/crypto`，不改变行为。
4. 引入 `InboundGateway`，并让服务端 webhook 路由调用它。
5. 用 `acceptExternal` 替换直接构造飞书 WS 事件的逻辑。
6. 引入 `Responder`，并从应用服务中移除协议分支逻辑。
7. 将 Agent 处理移动到 `application/inbound-agent` 并继续拆分执行、审批、后处理。
8. 用运行时/DataStore 支持的存储替换内存中的暂停审批状态。
9. 将 `SQLiteInbox` 演进为真正可靠队列。
10. 添加兼容性测试，证明 Web 聊天 API 和消息持久化保持不变。

## 必需测试

- 微信和飞书的 webhook challenge 仍返回平台特定的 challenge 响应。
- 重复的外部消息 id 会被接受，但不会被处理两次。
- HTTP webhook 快速返回，而 Agent 处理在之后发生。
- 飞书 WS 和飞书 HTTP 生成相同的标准事件形状。
- 使用同一协议的多个连接器仍可通过 `connectorId` 区分。
- Responder 根据 `replyAddress` 调用正确的连接器工具。
- 连接器审批回复不会在普通 Web 聊天中触发。
- 现有 Web 聊天会话创建、消息保存/加载和 Agent 回复流程保持不变。

## 关键决策

入站模块应是 Connector Gateway 的入口边界，而不是入站 Agent 运行时。它的稳定职责是：

1. 可信接收；
2. 协议规范化；
3. 可靠移交；
4. 可寻址回复。

Agent 执行、审批恢复、会话、记忆、标题生成和成本持久化属于应用/运行时服务。这些服务可以消费入站事件，同时不改变 Web 聊天用户体验。
