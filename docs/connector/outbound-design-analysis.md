# 出站连接器设计分析

> 分析日期: 2026-07-18
> 分析范围: `packages/core/src/modules/connector/` (executor / factory / template / var-resolver / registry / loader / tool-adapter / audit-logger)
>
> 基于 [mechanism-analysis.md](mechanism-analysis.md) 的出站部分深入展开。

---

## 总体判断

**"YAML 定义连接器 → 自动转换为 Agent 工具 → HTTP 执行"这条核心路径的设计是合理的。** 把外部 API 封装成 Agent 可调用的 tool，统一走 YAML 声明 + 模板渲染 + 认证管理，这个模式没问题。

但出站的处境和入站不同：入站是"设计假设和实际负载错配"，出站是**"核心路径只做到 MVP，治理面完全空白，且有一层关键能力——流式执行——整个缺失"**。

---

## 一、当前设计中做得好的部分（应该保留）

### 1. 声明式 YAML 定义 + 自动工具注册

Connector = 一个 YAML 文件，声明 id/name/auth/tools，框架自动完成：
- Zod schema 校验（loader 路径）
- 变量静态替换（`${{ var_name }}` 在加载时解析）
- JSON Schema → Zod → AI SDK `tool()` 转换
- `{connectorId}_{toolName}` 命名空间隔离

这个"声明即工具"的模式降低了接入新 API 的门槛。

### 2. Token 管理设计合理

`executor.ts:195-283` 的 token 刷新机制：提前 5 分钟刷新 + 并发去重（`refreshingPromises` Map 确保多个并发请求只发一次刷新）+ 内存缓存。这个设计是对的，微信/飞书的 2 小时 token 场景靠这个机制能正常工作。

### 3. 模板引擎有一定表达能力

`template.ts` 支持 `{{path.to.value}}` 插值、`$path` 直引用（保留原始类型）、`$json()` / `$jsonEscape()` 序列化、`{{timestamp}}` / `{{uuid}}` 内置函数。`renderObject` 递归遍历整个对象做渲染，能处理嵌套的 body/headers。

### 4. 入站回复复用出站执行

`ConnectorResponder.respond()` 通过 `registry.callTool()` 走同一套执行管道发回复。凭据、模板、超时控制统一管理，不是单独搞一条回复通道。这个复用是好的。

---

## 二、需要重做的设计

### 2.1 执行模型：只有 Request-Response，缺少流式能力

**这是出站最关键的架构缺口。**

当前模型：

```
Agent 决策调 tool → tool-adapter.execute() → registry.callTool()
  → executor.execute() → executeHttp() → fetch() + await response.json()
  → 返回完整 result → Agent 收到 tool result → 继续推理
```

全程是"一发一等一收"。对大多数 API 调用场景这没问题，但有一个场景被堵死了：**Agent 生成回复文字后，通过 connector 流式发送到 IM 平台**。

具体来说，当前飞书 connector 的 `inbound.reply` 工具走的是：

```
Agent 完成全部推理（可能几分钟）
  → agent-handler 拼接完整 responseText
  → sendReply(event, finalResponse)  ← 一次性
  → responder.respond() → registry.callTool() → executor.executeHttp()
  → fetch(飞书发消息 API, { body: JSON.stringify({ content: finalResponse }) })
```

用户在飞书端等了 5 分钟，突然收到一大段文字。没有任何"正在输入..."的中间状态。

**飞书支持两种流式体验**：

| 方式 | 做法 | 体验 |
|------|------|------|
| A. 占位消息 + 多次更新 | 先发"正在思考..."拿到 `message_id` → 多次调"更新消息"API 替换内容 | 用户看到消息逐段变长 |
| B. WebSocket 流式卡片 | 通过已有的飞书 WS 长连接，发 `streaming` 类型卡片 | 原生打字机效果 |

**框架需要新增的能力**：

```
1. ConnectorToolExecutor 新增 streaming executor
   - toolDef.executor = 'http-streaming'（或现有 http executor 扩展 streaming 模式）
   - executeStream() 返回 AsyncIterable<ToolCallStreamChunk>
   - 每个 chunk 可以是 text_delta / tool_result / error
   
2. Responder 新增流式回复
   - respondStream(address, messageStream: AsyncIterable<OutboundMessage>)
   - 内部调 registry.callToolStreaming() → executor.executeStream()
   - executor 实现具体平台协议：
     - 飞书 A 方案：先调"发送消息"API 拿 message_id → 每个 chunk 调"更新消息"API
     - 飞书 B 方案：通过 WS 长连接发送流式卡片帧

3. OutboundMessage 扩展
   - 当前只有 { type: 'text', text: '...' }
   - 需支持 { type: 'text_delta', text: '...', messageId?: string }
   - 以及 stream_start / stream_end 生命周期事件

4. Agent Handler 分两阶段回复
   - 阶段 1: Agent 开始推理时 → respondStream.start() → 拿到平台 message_id
   - 阶段 2: 消费 text-delta 时 → respondStream.write({ text: deltaText })
   - 阶段 3: Agent 完成 → respondStream.end({ finalText })
```

**设计决策点**：

- streaming executor 是独立 executor 类型（`http-streaming`），还是给现有 `http` executor 加 `streaming: true` 选项？建议后者——对 YAML 定义者来说，"这个 HTTP 调用支持流式"比"这是另一种 executor"更自然。
- 流式 chunk 的粒度由谁控制？Agent text-delta 每 10-50ms 出一个 token，飞书 API 不可能这个频率更新。需要在 framework 层做 throttling（每 500ms 或每 50 个字符攒一批发）。

---

### 2.2 凭据管理：全线明文

**现状**: 凭据（api_key / bearer_token / app_secret）是 YAML `variables` 区的明文字符串。

两条关键路径都在裸写：

- **加载路径**: `registry.getCredentials()` ([registry.ts:111-114](registry.ts#L111-L114)) 直接返回 `connector.variables`，上游 `executor.ts:94` 直接用。
- **写入路径**: App 层 API 把用户提交的凭据**明文写回 YAML 文件**（`packages/app/app/api/connectors/route.ts:145-158`）。

这与 MCP 的凭据明文问题是同一类问题，但 connector 更严重——MCP 至少是 JSON 文件放在 `~/.agents/` 下，connector YAML 文件在项目目录里，**会被 git commit**。

**改进方向**:

```
优先级从低到高：

1. 环境变量间接层（最快）
   - variables 支持 ${ENV_VAR} 语法（loader.ts:81 注释已承诺但未实现）
   - YAML 里写 api_key: ${FEISHU_APP_SECRET}，加载时替换

2. 本地 keychain（macOS Keychain / Windows Credential Manager）
   - 写入时凭据进 keychain，YAML 里只存引用 key
   - 读取时从 keychain 取

3. 加密存储（跨平台兼容方案）
   - 对 keychain 不可用的平台，用 SQLite + SQLCipher 加密存储
```

---

### 2.3 安全：模板注入 + 审批绕过

**模板注入**:

`renderTemplate` ([template.ts:47-57](template.ts#L47-L57)) 把 LLM 生成的 `input` 直接插值进 URL 和 header：

- URL 裸拼接（[executor.ts:118](executor.ts#L118)）：`const url = renderTemplate(toolConfig.url, ctx)` — LLM 可以把 URL 改向任意域名
- Header 值可被 input 控制（[executor.ts:113-116](executor.ts#L113-L116)） — 存在 header 注入面
- query params 走 URLSearchParams 是安全的，但 URL path 部分是裸拼

**双重渲染语法冲突**:

两个渲染阶段用了两种相似但不兼容的语法：

| 阶段 | 语法 | 引擎 | 时机 |
|------|------|------|------|
| 1 | `${{ var_name }}` | var-resolver.ts | YAML 加载时 |
| 2 | `${path}` / `{{path}}` | template.ts | 运行时 |

未解析的 `${{ x }}`（变量表中找不到的）会被保留为字面量，进入阶段 2 时 `template.ts:53` 的 `/\$\{([^}]+)\}/` 正则会匹配到 `${{ x }}` 的内部部分，替换为空串，留下孤立 `}`。**这是静默模板损坏。**

**审批绕过**:

connector 工具执行路径（tool-adapter → registry.callTool → executor.execute）**完全没有权限/审批检查**。对比 bash/read_file/write_file/edit_file 都接入了 `checkPermissionRules` 和审批机制。任何 connector 定义的 tool 都会被 Agent 直接调用。

**改进方向**:

- URL 模板渲染需加域名白名单校验（在 connector YAML 中声明 `allowed_domains`）
- Header 插值应限定为 `credentials` 和 `token` 上下文，禁止 `input` 写入任意 header
- 两种渲染语法统一或至少做到互斥——建议阶段 2 的 `${}` 语法改成不匹配双花括号
- connector 工具接入审批体系（与 bash/write 同级）

---

### 2.4 可靠性：类型先行、实现缺席

types.ts 中声明了大量可靠性相关的字段，但执行路径完全没用：

| 声明位置 | 能力 | 实际状态 |
|----------|------|---------|
| `ToolDefinition.retryable` | 工具可重试 | 被加载、被 admin API 展示，executor 无任何重试逻辑 |
| `HttpExecutorConfig.body_template` | 请求体模板 | executor 从未读取 |
| `HttpExecutorConfig.response_path` | 响应路径提取 | executor 从未读取 |
| `ToolDefinition.output_schema` | 输出 schema | 零消费方 |
| `AuthConfig.refresh_before_expiry_ms` | 提前刷新时间 | 被硬编码 5 分钟覆盖（[executor.ts:30](executor.ts#L30)） |
| `PermissionRule` | 权限规则 | 执行路径无任何检查 |
| `ConnectorRuntimeConfig.allowUnsafeScriptExecutor` | script executor 开关 | factory 中完全未读取 |
| `ConnectorRuntimeConfig.cwd/userId/appContext/model` | 运行时配置 | factory 中均未消费 |

此外：

- **401 时缓存不失效**: token 被上游吊销后，会持续用坏 token 直到自然过期
- **错误消息泄露**: `executor.ts:158` 把上游响应体全文 `JSON.stringify(data)` 塞进错误信息 → 回流给 LLM
- **审计日志是空壳**: `AuditLogger` 有完整 API（logToolCall/logTokenRefresh/logAuthFailure/logRetry/logCircuitBreakerTrip），但全仓零调用。`enablePersistence` 和 `dbPath` 参数被接收但**无任何 SQLite 写入代码**——纯内存环形缓冲 1000 条上限
- **sql / script executor 不存在**: types.ts 声明了完整的 `SqlExecutorConfig` 和 `ScriptExecutorConfig`，但 executor.ts switch 只处理 `http` 和 `mock`，Zod schema（[loader.ts:52](loader.ts#L52)）也只允许 `['http', 'mock']`

**改进方向**: 这些不是设计问题，是"承诺了但没做"。要么实现，要么从类型层删掉，避免给代码读者虚假信心。

---

### 2.5 加载路径双轨制

存在两条加载路径，验证强度不一致：

| | 路径 A（loader.ts → loader-internal.ts） | 路径 B（registry.ts loadConnector） |
|---|---|---|
| 触发场景 | 应用层通过 `scanConnectorDirs` 加载 | Registry 直接读 YAML 文件 |
| 校验 | Zod `ConnectorFrontmatterSchema` 全量校验 | `js-yaml` + 手工类型断言，**完全绕过 Zod** |
| 变量替换 | loader-internal 中做 | `resolveConnectorVars` 做 |
| 字段缺省 | Zod `.default()` 填默认值 | 手工 `??` 填默认值（不完整） |

路径 B 只检查 `id` 字段存在，auth/tools/inbound 字段如果写错了不会报错，静默地用半损坏的定义注册。这是**同一份数据有两种不同的校验标准**——典型的"两条路径各自演化"的结果。

**改进方向**: 统一到路径 A。路径 B 的 `loadConnector()` 也应该走 Zod parse，最差也要在最后做一次 `ConnectorFrontmatterSchema.safeParse()`。

---

### 2.6 双份类型定义

`ConnectorFrontmatter` 定义了两份：

- [types.ts:200-212](types.ts#L200-L212)：手写 interface
- [loader.ts:99](loader.ts#L99)：`z.infer<typeof ConnectorFrontmatterSchema>`

registry 用 loader 版（`import type { ConnectorFrontmatter } from './loader'`），types.ts 的手写版几乎死代码。两份定义需要手动保持同步，已经出现偏差——手写版不含 `scopes` 和 `sourcePath`。

**改进方向**: 删除 types.ts 中的手写版，全仓统一用 `z.infer` 版。

---

## 三、不需要改的部分

- **声明式 YAML 定义模式**: 对简单 HTTP API 接入场景非常合适
- **Token 刷新 + 并发去重**: 设计正确，微信/飞书 2 小时 token 场景够用
- **JSON Schema → Zod → AI SDK tool 转换**: 自动化的 tool 注册链路清晰
- **回复复用出站**: 入站回复走 connector tool call 的复用设计是对的
- **Mock executor**: 开发调试有用，保留

---

## 四、与入站问题的对比

| 维度 | 入站 | 出站 |
|------|------|------|
| 核心链路 | 正常，有 bug | 正常，MVP 级别 |
| 最关键的缺口 | 锁模型 vs Agent 时长错配 | **流式执行能力整个缺失** |
| 安全 | REST webhook 零鉴权、飞书签名缺口 | 凭证明文、模板注入、审批绕过 |
| 可靠性 | 重试/死信被 bug 架空 | 重试/熔断/审计全是空壳 |
| 类型 vs 实现 | 基本匹配 | 大量"类型先行、实现缺席" |
| 修复工数量级 | bug 修几行，设计改几处 | 流式能力是全新 feature，其他补全中等工数 |

---

## 五、总结

出站的核心骨架——"YAML 声明 → 自动转 Agent 工具 → HTTP 执行"——没问题。问题在三个层面：

| 层级 | 问题 | 性质 |
|------|------|------|
| 能力缺失 | 没有流式执行，IM 场景用户无法体验逐字输出 | 需要新架构层 |
| 安全空白 | 凭证明文 + 模板注入 + 审批绕过 | 需要填充治理面 |
| 声明未实现 | retryable / output_schema / sql executor / 审计 / 熔断等 | 要么实现，要么删类型 |

**优先级建议**:

1. **安全底线先补**: 凭据加密/环境变量间接层、URL 域名白名单、审批接入——这些是"现在就可能被利用"的问题
2. **清理死代码**: 删掉未实现的类型声明（sql/script executor、retryable 等），或者明确标记为 `@unimplemented`
3. **流式执行**: 为飞书场景新增 streaming executor + streaming responder，这是用户体验的最大提升点，但工数量级远超前两项
