# 连接器机制成熟度分析报告

> 分析日期:2026-07-17
> 分析范围:
> - Outbound:`packages/core/src/modules/connector/`(executor / factory / template / var-resolver / registry / loader / tool-adapter / audit-logger)
> - Inbound:`packages/core/src/modules/connector/inbound/`、`packages/core/src/composition/inbound/`、`packages/app/app/api/connector/webhooks/`
> - MCP:`packages/core/src/modules/mcp/`、`packages/app/app/api/mcp/`、`packages/app/app/settings/mcp/`、`packages/app/components/mcp-widget.tsx`

## 总体结论

三条链路(outbound HTTP 调用 / inbound 消息接入 / MCP 集成)的**核心路径均端到端可跑通,属于"功能演示可用"阶段**;但治理面(安全、可靠性、审计、测试)大量缺失,并存在若干正在生效的真 bug。粗略评估:核心链路成熟度 ~70%,治理面 ~20%。

---

# 一、Outbound 连接器(YAML → Agent 工具 → HTTP 执行)

## 1.1 架构现状

- **定义**:连接器为单个 YAML 文件(id/name/version/variables/auth/tools),Zod schema 在 `loader.ts:73-97`(`ConnectorFrontmatterSchema`)。变量用 `${{ var_name }}` 语法在加载时由 `var-resolver.ts:20-25` 静态替换。
- **加载**:存在**两条并行加载路径,验证强度不一致**:
  - 路径 A:`loader.ts` → `loader-internal.ts:25-40`,走 `MultiSourceConfigLoader` + Zod 校验。
  - 路径 B:`registry.ts:79-104` `loadConnector()` 直接用 js-yaml 读文件 + 手工类型断言,**完全绕过 Zod 校验**,只检查 `id` 字段存在。
- **注册**:`ConnectorRegistry`(registry.ts:19)持有 `Map<id, ConnectorDefinition>`,支持 `initialize()` / `initializeFromDefinitions()` / `mergeFromDefinitions()` 三种入口。运行时由 `factory.ts:31-60` 组装。
- **转 Agent 工具**:`tool-adapter.ts:109-154` 将 ToolDefinition 的 JSON Schema 转为 Zod,包装成 AI SDK `tool()`,命名 `{connectorId}_{toolName}`,由 `modules/agent/tools.ts:209` 注入。
- **执行**:`executor.ts:46-66` switch 分发。**实际只实现了 `http` 和 `mock` 两种 executor**。HTTP 执行含模板渲染、auth header 解析、custom token 自动刷新(带缓存与并发去重,executor.ts:195-283)、AbortController 超时(默认 10s)。

## 1.2 明显未完成的部分

| 声明位置 | 能力 | 状态 |
|---|---|---|
| types.ts:109/152-164 | sql / script executor | 只有类型无实现,执行必抛 `Unsupported executor type`;Zod schema(loader.ts:52)也只允许 `['http','mock']` |
| types.ts:262 | `allowUnsafeScriptExecutor` | factory 中完全未读取 |
| types.ts:121 | `retryable` | 被加载、被 admin API 展示,但 executor 无任何重试逻辑 |
| types.ts:134-135 | `body_template` / `response_path` | executeHttp 从未读取 |
| types.ts:136 | `HttpExecutorConfig.timeout_ms` | executor.ts:93 只读 `toolDef.timeout_ms`,工具级配置同名字段是死的 |
| types.ts:117 | `output_schema` | 零消费方 |
| types.ts:66,85-87 | auth type `'database'` | Zod enum(loader.ts:18)拒绝 + `resolveAuth`(executor.ts:174-191)不处理 |
| types.ts:79 | `refresh_before_expiry_ms` | 被硬编码 5 分钟(executor.ts:30)覆盖 |
| types.ts:217-223 | `PermissionRule` | 执行路径无任何权限/审批检查 |
| audit-logger.ts:29-30 | `dbPath` / `enablePersistence` | **无任何 SQLite 写入代码**,纯内存环形缓冲(上限 1000 条) |
| loader.ts:81 注释 | `${ENV_VAR}` 环境变量替换 | 注释承诺,未实现 |

其他:

- **审计日志无人调用**:`logToolCall/logTokenRefresh/logAuthFailure/logRetry/logCircuitBreakerTrip` 全仓零调用;`executor.execute()` 完成后不写审计。事件类型 `circuit_breaker_trip`/`retry` 对应的机制(熔断、重试)本身也不存在。
- `registry.dispose()` 是空函数(registry.ts:169-171)。
- `ConnectorRuntimeConfig` 的 `cwd`/`userId`/`appContext`/`model`(types.ts:242-266)在 factory 中均未消费。
- `ConnectorFrontmatter` 定义了两份(types.ts:200-212 手写版 vs loader.ts:99 z.infer 版),registry 用 loader 版,types.ts 版接近死代码。

## 1.3 缺陷与风险

**凭据管理 —— 全线明文**:

- 凭据(api_key/bearer_token/app_secret)是 YAML `variables` 区的明文字符串,`registry.getCredentials()`(registry.ts:111-114)直接返回。无加密、无 keychain、无环境变量间接层。
- App 层 API(`packages/app/app/api/connectors/route.ts:145-158`)把用户提交的凭据**明文写回 YAML 文件**。
- 两条凭据获取路径不一致:`executor.ts:94` 直接用 `connector.variables`,而注入的 `getCredentials` 回调只在 `doRefreshToken`(executor.ts:243)用到;`tool-adapter.ts:16` 的 `getCredentials` option 声明后从未使用。

**变量插值安全问题**:

- `renderTemplate`(template.ts:47-57)把 LLM 生成的 `input` 直接插值进 URL,**无 URL 编码、无域名白名单** —— 存在 SSRF / 参数注入面(executor.ts:118 的 URL 是裸拼接;query param 走 URLSearchParams 是安全的)。
- Header 值同样可被 input 插值(executor.ts:113-116),存在 header 注入面。
- 语法冲突:未解析的 `${{ x }}`(var-resolver.ts:43-48 保留字面量)会被运行时 `template.ts:53` 的 `/\$\{([^}]+)\}/` 部分匹配替换为空串,留下孤立 `}`,产生静默模板损坏。

**可靠性缺失**:

- 无重试、无熔断。
- Token 401 时缓存不失效 —— token 被上游吊销后会持续用坏 token 直到自然过期。
- 错误消息可能包含上游响应体全文(executor.ts:158 `JSON.stringify(data)` 进错误信息),有敏感信息回流给 LLM 的可能。

**权限检查缺失**:connector 工具执行路径(tool-adapter → registry.callTool)**没有任何权限/审批检查**,与 bash/read/write 工具(均接 `checkPermissionRules`)形成反差。

**类型层小 bug**:`tool-adapter.ts:98-103` enum 处理在 default 之后执行且整体覆盖 zodType,带 default 的 enum 字段会丢失默认值。

## 1.4 测试覆盖

**Outbound 侧零测试**。executor(HTTP 执行、token 刷新竞态、超时)、template、var-resolver、registry、tool-adapter、mock executor、audit-logger 均无单测。代码中也没有 TODO/FIXME 标记 —— 未完成状态没有被标注,只能从死代码/死字段推断。

---

# 二、Inbound 消息接入(webhook/WS → inbox → Agent → 回复)

## 2.1 架构现状:链路闭环,但有一处语义断裂

链路:webhook 路由(`packages/app/app/api/connector/webhooks/[connectorId]/route.ts:32`)或飞书 WS 长连接(`packages/app/lib/feishu-long-connection.ts:149`)→ `ConnectorInboundGateway.acceptHttp/acceptExternal`(gateway/inbound-gateway.ts:37,63)→ adapter challenge/verify/decrypt/parse → `inbox.publish`(inbound-gateway.ts:116)→ inbox 订阅分发 → `InboundEventProcessor.handle`(inbound-processor.ts:55)→ `AgentInboundHandler.handle`(composition/inbound/agent-handler.ts:379)→ `ConnectorResponder.respond`(responder/responder.ts:12)通过 connector 的 `inbound.reply` 工具映射回发。装配点:`composition/inbound/configure.ts:26`、`packages/app/lib/runtime.ts:156`。

**关键断裂**:`InboundEventProcessor.processEvent` 捕获所有异常且不重新抛出(inbound-processor.ts:84-90),导致 SQLite inbox 实现的重试/死信机制(sqlite-inbox.ts:188-198)**在实际路径上永远不会触发** —— 处理失败的消息也会被标记为 completed,重试机制形同虚设。

## 2.2 各 Adapter 完成度

### Feishu(最成熟)— adapters/feishu.ts

- HTTP + WebSocket 双通道,统一归一化到 `feishuPayloadToInboundEvent`(feishu.ts:431)。
- **签名验证缺口**:仅在 body 含 `encrypt` 字段时验证(feishu.ts:335-338)—— 未加密模式下不做任何验证(verification token 未校验),伪造请求可直达 Agent。
- **加密模式下 URL 验证会失败**:`challenge` 只检查明文 body(feishu.ts:320-333),飞书开启 encrypt_key 后 challenge 也是加密的,该场景未处理。
- 消息类型:text/image/file/post(富文本)均支持,附件下载完整(feishu.ts:98-274)。但附件下载在 `parse` 阶段、HTTP 响应返回前同步执行,**大文件下载可能超出飞书 3 秒 webhook 时限**,触发飞书重推。
- **重复实现**:core 的 `feishu-ws-client.ts` 和 app 的 `feishu-long-connection.ts` 是同一逻辑的两份拷贝,实际生效的是 app 那份;两者的 `stop()` 都只删引用、**没有真正关闭 WebSocket 连接**(feishu-ws-client.ts:64-70,feishu-long-connection.ts:111-119)。

### WeChat(半成品)— adapters/wechat.ts

- 加解密/签名验证完整(明文 SHA1 + 加密 msg_signature + AES,wechat.ts:25-95),echostr challenge 支持加密模式(wechat.ts:152-178)。
- **只支持文本消息**:非 text 一律映射为 'event'(wechat.ts:240),图片/语音/文件不支持。
- `encryptWechatMessage` 导出后无调用方 —— **被动加密回复未实现**;微信公众号被动回复要求 5 秒内返回 XML,当前 webhook 返回 JSON,微信侧会视为无效响应并重推。
- wechat-kf(微信客服)实际协议需 token 换 sync_msg 拉消息,现实现只是简单解析 XML(wechat.ts:130),真实场景大概率不可用。

### REST API(有意裸奔)— adapters/rest-api-adapter.ts

- `verify()` 恒 true(rest-api-adapter.ts:19-21)—— **公网暴露的 webhook 无任何鉴权**,任何人可触发 Agent 消耗 token。
- fire-and-forget:立即返回 event_id,调用方拿不到处理结果(除非配置 reply 工具回调)。

## 2.3 明显未完成的部分

- Stub/死代码:
  - `composition/inbound/post-process.ts`:仅一个空接口,无实现无使用。
  - `composition/inbound/approval-service.ts`:仅 `PendingApproval` 类型定义,旧审批方案遗留骨架。
  - `composition/inbound/inbound-agent-service.ts`:`DefaultInboundAgentService` 薄包装,实际装配路径(configure.ts:40-43)未使用。
  - sqlite-inbox 的 `heartbeatIntervalMs` 配置项存在(sqlite-inbox.ts:11,34)但**心跳续锁从未实现** —— 长任务锁必然过期。
- **`event.agentType` 被丢弃**:cron 调度器注入了 `agentType`(modules/cron/scheduler.ts:118),但 `AgentInboundHandler` 全文不读取(agent-handler.ts:928-965)—— **cron job 指定的 agent 类型不生效**。
- **`stream ?? stream` 笔误**:agent-handler.ts:628 `for await (const part of streamResult.stream ?? streamResult.stream)` —— 自己 fallback 自己(原为 `fullStream`,commit 7828aed 改坏),疑似应为 `fullStream ?? stream`。
- **无 bot 消息过滤**:feishu adapter 标记了 `sender.type === 'bot'`(feishu.ts:467)但无消费方检查,机器人在群里可能形成自我回复循环。
- Responder 只支持纯文本回复(responder.ts:12-36),无卡片/图片/富文本出站能力。

## 2.4 可靠性风险

- **生产用 SQLite inbox**(factory.ts:45-47),具备幂等(INSERT OR IGNORE)、指数退避重试、死信、可见性超时 —— 但如 2.1 所述,processor 吞异常使整套机制不可达。
- **可见性超时 60s vs Agent 运行分钟级**:锁过期后 `recoverExpiredLocks`(sqlite-inbox.ts:245-257)把仍在处理的消息重置为 pending 再次派发;并发重复执行只靠两层进程内防线:`claimInboundEvent` 10 分钟内存去重(agent-handler.ts:292-306)和 `withConversationLock`(agent-handler.ts:308)。**进程重启后这两层失效,长任务会被重复执行**。
- **吞吐上限约 1 条/秒**:`dispatchPending` 每次只取 LIMIT 1 且处理完不续取(sqlite-inbox.ts:161-175),仅靠 1s 轮询驱动。
- completed/dead 记录**永不清理**(无 DELETE 语句),表无限增长;幂等依赖保留历史行属有意为之,但缺 TTL 清理。
- **去重 key 不一致**:memory inbox 用 `connectorId:protocol:externalEventId`(memory-inbox.ts:19),SQLite 用含 transport 的 `event.id`(sqlite-inbox.ts:53)—— 同一条飞书消息同时从 HTTP 和 WS 进来会被 SQLite 当成两条。
- Memory inbox:`seenEventKeys` 永不清理(内存泄漏);队满时会丢弃最老的 pending 消息(memory-inbox.ts:27-32)。
- 回复失败仅记日志(inbound-processor.ts:208-210),Agent 已产出的结果丢失、无补发。

## 2.5 Approval(审批)与 inbound 的结合:基本完整,细节粗糙

挂起/恢复式审批(approval-context.ts)设计完整:保存 ModelMessage 执行现场 → SQLite 持久化跨重启(approval-context.ts:59-65,115-136)→ 用户回复关键词恢复(agent-handler.ts:397-429)→ 在现场追加 approval-response 续跑(agent-handler.ts:524-534)。permissions.json 自动 allow/deny(agent-handler.ts:712-727)、session 内已批准工具复用、本地文件工具共享审批 scope 均已实现。问题:

- **关键词检测是朴素子串匹配**(approval-context.ts:207-218):有挂起状态时,含"好"/"行"/"可以"/"ok"/"no" 的任何普通消息都会被误判为审批回复;同时含批准和拒绝词的消息("好的,不要删了")先命中 deny 分支。
- 审批提示文案称"超时将自动拒绝"(approval-handler.ts:61),实际**过期只是静默清除状态**,无通知;过期后回复"同意"会被当普通消息触发全新 Agent run。
- `approval-handler.ts:71-93` 的 `parseApprovalResponse` 与 `approval-context.ts:210` 的 `detectApprovalResponse` 是重复实现。
- 挂起 TTL 5 分钟偏短(IM 场景用户常延迟回复)。

## 2.6 测试覆盖:薄弱且已腐化

仅 2 个测试文件,**当前全部有失败**(已实际运行验证):

- `__tests__/agent-handler-approval.test.ts`:**5/5 全部失败** —— mock 提供 `fullStream` 而代码已改读 `.stream`(即 2.3 的笔误),且 handler 重构为注入式 `createAgent` 后测试仍 mock 旧模块路径。
- `__tests__/gateway.test.ts`:1/5 失败("accepts duplicate external ids")—— fake connector 用 `test-service` 协议但 gateway 已无通用协议 adapter 注册(inbound-gateway.ts:25-34 只注册 feishu/wechat×3/rest-api),疑似移除通用 adapter 时的回归。

零覆盖区域:wechat 加解密/签名、feishu 签名验证与 challenge、SQLite inbox(重试/死信/可见性超时)、rest-api adapter、responder 模板渲染、附件下载、approval 过期路径。

---

# 三、MCP 集成(服务器配置、工具加载、MCP Apps 渲染)

## 3.1 传输方式与生命周期管理

- 支持 4 种传输:`stdio` / `sse` / `http` / `streamable-http`(types.ts:7,16-22);`streamable-http` 实际降级映射为 `http`(registry.ts:251-254)。stdio 有较完善的桌面端适配:登录 shell 解析用户 PATH 和命令绝对路径(loader.ts:29-90),继承代理环境变量(registry.ts:236-241)。
- 连接超时:单服务器默认 15s(registry.ts:23,注意 types.ts:28 注释写的是 10000,与实现不一致),`connectAll` 整体 30s 硬超时(registry.ts:47)。
- **无自动重连**:`reconnectAttempts` 字段在失败时递增(registry.ts:143-151)但**无任何代码消费它做退避重连** —— 半成品。重连只发生在 `/api/mcp/proxy` 和 `/api/mcp/resource` 被调用时的惰性重试(proxy/route.ts:72-74)。
- **无健康检查/心跳**:连接建立后 server 崩溃,registry 状态不感知,snapshot 仍显示 connected。
- `alwaysLoad` 语义为"失败即抛错阻塞",但 `connectAll` 外层 catch 吞掉错误只打日志(registry.ts:79-84),实际拦不住启动。
- 应用启动后台异步 connectAll,API 路由通过 `waitForMcpReady()` 等待(packages/app/lib/runtime.ts:142-153,208-212)—— 这部分设计合理。

## 3.2 工具加载与 Agent 集成

- agent 侧集成在 `modules/agent/tools.ts:143-193`:优先复用共享 registry,工具按 `mcp__<server>__<tool>` 命名注册,每个工具经 `wrapMcpToolWithOutputHandler` 包装。
- **tool-wrapper 只做输出预算管理/持久化**(tool-wrapper.ts:31-87)—— 大输出落盘替换,保留 structuredContent/image 等非文本部分。**没有审批、没有执行超时、没有重试**。
- **MCP 工具完全绕过审批体系**:`TOOLS_WITH_APPROVAL` 只含 bash/read_file/write_file/edit_file(agent-control/tool-approval.ts:65),`runSmartDecision` default 分支对 MCP 工具返回 `undefined`(不启用审批直接执行);permissions/rules.ts 中也无 `mcp__` 模式匹配。**这是安全层面最大的缺口**。
- 工具过滤支持 include/exclude(registry.ts:258-274),配置层可用但无 UI。
- `getAllToolsWithAppVisibility()` 区分 app-only 工具(registry.ts:186-201),但 **appVisible 集合全代码库无消费方** —— app-only 工具也会暴露给模型,与 MCP Apps 规范不符。

## 3.3 mcp-config-store 存储与凭据安全

- 纯 JSON 文件存储,遵循 Dot Agents 协议:用户级 `~/.agents/mcp.json`,项目级 `{cwd}/.agents/mcp.json`,项目覆盖用户(mcp-config-store.ts:24-38;loader 侧 4 级合并见 loader.ts:104-141)。
- **凭据全部明文**:stdio 的 `env`(常含 API key)和 http/sse 的 `headers`(常含 Bearer token)原样写入 JSON(mcp-config-store.ts:51-60),无 keychain/加密/环境变量引用机制。
- 前端不打码:McpDetail 的 JSON 编辑器把 env/headers 明文回显(McpDetail.tsx:107-116);对比 ConnectorsDetail 对 secret/token/password 有 password 输入框遮蔽(ConnectorsDetail.tsx:248-255),MCP 侧没有等价处理。
- 写入无文件锁/原子写,并发写有覆盖风险(mcp-config-store.ts:136-144);读文件失败静默吞掉(mcp-config-store.ts:130-132),配置损坏时用户无感知。

## 3.4 MCP Apps 渲染链路

链路是通的,属于"能用的 MVP":Chat.tsx 对 `dynamic-tool` 且名称以 `mcp__` 开头的 part 渲染 `McpAppToolPart`(Chat.tsx:1487-1509)→ 探测 `/api/mcp/tool-meta` 拿 `_meta.ui.resourceUri`(带模块级缓存,mcp-app-tool-part.tsx:19-34)→ `McpWidget` 经 `/api/mcp/resource` 拉 HTML → Blob URL + iframe + AppBridge 握手 → `sendToolInput/Partial`、`sendToolResult` 流式下发(mcp-widget.tsx:296-324)→ App 内工具调用经 `/api/mcp/proxy` 回源。

注:仓库中不存在 `mcp-app-sandbox` / `mcp-app-host` 源码目录(仅 .next 产物残留),渲染通过 `@modelcontextprotocol/ext-apps` 的 `AppBridge` + iframe 实现。

**链路缺口**:

- **iframe 沙箱形同虚设**:`sandbox="allow-scripts allow-same-origin"` + 同源 Blob URL(mcp-widget.tsx:393)—— 第三方 MCP App HTML 可访问父窗口 DOM/存储。
- `/api/mcp/proxy` **无鉴权、无工具白名单**,iframe 内可调用该 server 的任意工具(proxy/route.ts:27-100)。
- displayMode 只支持 inline,`onrequestdisplaymode` 硬编码返回 inline(mcp-widget.tsx:261-264)。
- fetch 代理注入只取 `pathname`,会丢 query string(mcp-widget.tsx:159);`serverUrl` prop 无调用方传入。
- 主题变化不通知 iframe(hostContext.theme 只在初始化时取一次,mcp-widget.tsx:202)。
- App 回传消息只提取 text 转发(mcp-app-tool-part.tsx:69-78),不支持结构化内容。

**mcp-widget.tsx 当前未提交改动**(约 +130 行):① 放大/还原全屏切换(expand 状态、Esc 还原、CSS scale 保持 AppBridge 连接);② console.debug 噪音过滤;③ 顺带修复 fetch 代理注入丢弃前序处理结果的小 bug。

## 3.5 前端设置页功能缺口

已有:列表+搜索、JSON 粘贴批量导入(兼容 Claude Desktop 格式)、连接测试、删除(带确认)、详情页 JSON 编辑保存、工具列表展示、5 秒轮询未连接服务器(McpSettings.tsx:373-378)。缺口:

- **无表单式编辑** —— 增改全靠手写/粘贴 JSON。
- **无启停开关** —— `enabled` 只能在 JSON 里改;`autoConnect=false` 的服务器没有手动连接按钮。
- **无 OAuth 支持** —— 远程 server 只能手填 headers token,无授权流程、无 token 刷新。
- **无工具级开关** —— `tools.include/exclude` 配置存在但 UI 只读展示(McpDetail.tsx:530-557)。
- **无 user/project 层级选择** —— POST 固定写入用户级,UI 不显示配置来源文件。
- 改名保存走 DELETE+POST 两步非原子(McpDetail.tsx:375-386),中间失败会丢配置。
- API 路由 cwd 参数不一致:列表用 `process.cwd()`(api/mcp/route.ts:73),单个查询用 `layout.resourceRoot`(route.ts:31)。
- Connectors 设置页相对更完整(上传/AI 生成/变量编辑含敏感值遮蔽/删除),但同样无启停 toggle(enabled 仅展示,ConnectorsSettings.tsx:75)。

## 3.6 Stub/死代码与测试覆盖

**Stub/死代码**:

- `loadMcpFile` 空 stub,直接返回 `[]`(loader.ts:239-245)。
- `LoadMcpsOptions.sources/dirs` 参数被接收但完全忽略(loader.ts:96-102,224-233)。
- `DEFAULT_MCP_LOADER_CONFIG` 的 `maxServers: 50` / `enableCache` 无实现(types.ts:88-101)。
- `McpServerConfigSchema`(zod)无任何调用方 —— API POST 只检查 name 和 transport.type(api/mcp/route.ts:98)。
- `elicitation.handler` 类型存在(types.ts:34-40)且 registry 会注册(registry.ts:112-117),但全代码库无人提供 handler —— elicitation 实际不可用。
- `getMcpServerConfig` 的 `_configDir` 参数被忽略(mcp-config-store.ts:183)。

**测试覆盖:非常薄**。仅 `__tests__/mcp.test.ts` 一个文件(179 行),全部是离线状态测试(构造函数、空 snapshot、类型断言),无连接测试、loader 多层合并测试、config-store CRUD 测试、tool-wrapper 输出处理测试。前端组件和 API 路由零测试。

---

# 四、汇总:待完善工作清单(按优先级)

## 🔴 P0 — 正在生效的 Bug

| # | 问题 | 位置 |
|---|------|------|
| 1 | processor 吞掉所有异常,SQLite inbox 重试/死信机制永远不触发 | inbound-processor.ts:84-90 |
| 2 | `stream ?? stream` 笔误(应为 `fullStream ?? stream`),同时导致审批测试 5/5 失败 | agent-handler.ts:628 |
| 3 | cron 指定的 `agentType` 被丢弃,不生效 | agent-handler.ts:928-965 |
| 4 | 两个 inbound 测试文件腐化失败(5/5 + 1/5),无 CI 门禁 | inbound/__tests__/ |
| 5 | 飞书未加密模式不做任何验证;加密模式 URL challenge 会失败 | feishu.ts:320-338 |
| 6 | 无 bot 消息过滤,群聊可能形成机器人自我回复循环 | feishu.ts:467 |

## 🔴 P0 — 安全缺口

1. MCP / connector 工具完全绕过审批体系,任意有副作用的工具无需确认直接执行。
2. 凭据全线明文(connector YAML 明文回写;MCP env/headers 明文存储且前端明文回显)。
3. MCP Apps iframe 沙箱失效(`allow-scripts allow-same-origin` + 同源 Blob URL);`/api/mcp/proxy` 无鉴权无白名单。
4. REST API webhook 无任何鉴权,公网暴露后任何人可触发 Agent 消耗 token。
5. 模板插值无消毒:LLM input 裸拼 URL/header,存在 SSRF / 注入面;`${{ }}` 与 `${ }` 双重渲染语法冲突会静默损坏模板。

## 🟡 P1 — 可靠性

- inbox 可见性超时 60s vs Agent 分钟级运行 → 重复执行;心跳续锁配置存在但未实现。
- MCP 无自动重连、无健康检查;`alwaysLoad` 失败被吞。
- inbox 吞吐上限 ~1 条/秒;completed/dead 记录无 TTL 清理;HTTP/WS 双通道去重 key 不一致。
- 飞书附件下载同步阻塞 webhook 响应,可能超 3 秒时限;WS client `stop()` 不真正关闭连接。
- 回复失败无补发;审计日志假持久化且零调用;connector 无重试/熔断;token 401 缓存不失效。

## 🟡 P1 — 功能半成品

- 微信:只支持文本;被动回复协议不符(需 5 秒内返回 XML,现返回 JSON);wechat-kf 大概率不可用。
- 审批交互:关键词朴素子串匹配易误判;"超时自动拒绝"文案与静默过期实际行为不符;TTL 5 分钟偏短;两处重复实现。
- "类型先行、实现缺席"死代码清理或补实现:sql/script executor、retryable、body_template/response_path/output_schema、`${ENV_VAR}` 替换、MCP elicitation、app-only 工具过滤。
- Responder 只支持纯文本,无卡片/图片/富文本出站。
- connector 双加载路径验证强度统一(registry 直读 YAML 绕过 Zod)。

## 🟢 P2 — 产品化缺口

- MCP 设置页:表单式编辑、启停 toggle、工具级开关、OAuth、user/project 层级选择、原子改名。
- Connectors 设置页:启停 toggle。
- MCP Apps:fullscreen displayMode、主题同步、结构化内容回传。

## 测试:接近于零,需系统性补齐

- Outbound 全链路零测试。
- Inbound 仅 2 个文件且当前全部有失败,需先修复再扩展(wechat 加解密、feishu 签名、SQLite inbox 重试/死信)。
- MCP 仅 1 个离线测试文件;前端与 API 路由零测试。

## 建议推进顺序

1. **先修 P0 bug**(吞异常、stream 笔误、agentType、修复测试)—— 工作量小,修完让重试机制和测试门禁真正生效。
2. **补安全底线**:工具接入审批体系、REST webhook 鉴权、飞书 verification token 校验、iframe 沙箱整改。
3. **可靠性**:心跳续锁、MCP 重连、微信被动回复协议。
4. **产品化**:OAuth、启停开关、表单编辑。
