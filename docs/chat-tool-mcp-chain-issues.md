# Chat、工具调用与 MCP 全链路问题清单

> 分析日期：2026-07-17  
> 范围：`packages/app` Chat 前后端、`packages/core` Agent/Tool/MCP、审批、流恢复和持久化链路  
> 状态说明：分析时 `packages/app/components/Chat.tsx` 与 `packages/app/app/api/chat/route.ts` 存在未提交修改；本文记录的是当前工作区状态，不代表 `main` 分支已提交状态。

## 修复状态（2026-07-17）

| ID | 状态 | 处理方式 |
|---|---|---|
| C1 | ✅ 已修复 | 删除 Chat.tsx 中未定义符号的死分支，改用现有 `McpWidget`（经新组件 `mcp-app-tool-part.tsx` 接入）；同步清理 `core/src/index.ts` 中 14 个指向已删除 MCP App 实现的陈旧导出 |
| C2 | ✅ 已修复 | 不再调用 `/api/mcp-app-host`；App 内工具调用统一走 `McpWidget` → `/api/mcp/proxy?server=<serverName>` |
| C3 | ✅ 已修复 | `POST /api/chat` 的 `createAgent()` 调用传入 `writerRef` |
| C4 | ✅ 已修复 | `tool-wrapper.ts` 仅替换 text part，保留 `structuredContent`、image/resource 等非文本内容与扩展字段 |
| C5 | ⏸ 未修复 | 按决策本轮跳过，MCP 工具审批策略另行设计 |
| C6 | ✅ 已修复 | 采用消息驱动恢复：新增 `collectPendingApprovals()`，加载历史消息后从最后一条 assistant 消息的 `approval-requested` parts 重建 ApprovalPanel / 问题面板；不引入 suspendedStateStore 写入 |
| C7 | ✅ 已修复 | `onEnd` 改为工厂 `createOnEnd(inputMessageCount)`，首次传 `finalMessages.length`，重试传 `retryResult.messages.length` |
| C8 | ✅ 已修复 | 服务端 `onEnd → finalizeAgentRun` 为唯一写入权威；移除前端 `onFinish` 自动 PATCH 及 `/api/chat` 的 PATCH handler（`ai@7` UI 流 `onEnd` 带 `isAborted`，中断时也触发，停止场景仍由服务端保存） |
| C9 | ✅ 已修复 | 删除 `addChunk`/`clearChunks` 死写入；保留 `completeRun`（conversations 路由仍查询运行状态）。core 中 store 的 chunk 接口暂保留，后续可清理 |
| C10 | ✅ 已修复 | 渲染边界从 qualified name（`mcp__server__tool`）解析 serverName/baseToolName，显式传入 `McpWidget`，App 内调用始终路由到触发该 App 的 server |
| C11 | ✅ 已校准 | 本文档所引用的 `mcp-app-implementation-summary.md`、`mcp-apps-gap-analysis.md` 已在提交 13c68a6 中删除（引用失效）；且 `packages/app/components/mcp-widget.tsx` 实际存在（原文"当前工作区不存在"表述有误），本次修复即复用了该组件 |

修复过程中额外发现并处理（原清单遗漏）：

- **`@/lib/agent-context` 模块缺失**：`/api/mcp/proxy`、`/api/mcp/resource`、`/api/mcp/tool-meta` 三个路由都导入该模块但文件不存在（运行时必然 500）。已新建 `packages/app/lib/agent-context.ts`（`getServerContext` + `waitForMcpReady`）。
- **`McpWidget` 自身缺陷**：`packages/app` 缺少 `@modelcontextprotocol/ext-apps`、`@modelcontextprotocol/sdk` 依赖（已补）；`bridge.app.registerTool` 在 ext-apps 1.7.4 中不存在（已移除拦截逻辑）；`sendToolInput` 参数应为 `{ arguments }`（已修）；发送 input/result 此前依赖 ref 时序（首挂载永远发不出去），改为 `initialized` 事件驱动；补充 `sendToolResult` 下发。
- **仓库 `typecheck` 脚本失效**：`tsc` bin 被 `@typescript/native`（TypeScript 7 原生预览）遮蔽，对所有文件误报 TS1127。本次验证使用 `node node_modules/typescript/bin/tsc6 --noEmit`（app、core 均通过）。脚本本身未改动，待另行决策。
- 顺带修复了 `Chat.tsx`（`addToolApprovalResponse().catch` 类型、`DynamicToolUIPart` 断言）与 `ConversationSidebar.tsx`（`KeyboardEvent` 泛型）的预先存在类型错误，使 typecheck 归零。

## 总览

当前主链路已经具备基本结构：

```text
Chat UI
  → POST /api/chat
  → createAgent
  → ToolLoopAgent
  → 普通工具 / MCP 工具 / 子 Agent
  → UIMessageChunk
  → Resumable Stream
  → SSE
  → useChat
  → 消息与工具 UI
  → 消息、标题和成本持久化
```

但当前实现存在若干确定的链路断点，以及需要进一步验证的可靠性和安全边界问题。

| ID | 问题 | 严重度 | 类型 |
|---|---|---:|---|
| C1 | MCP App 前端符号缺少导入或定义 | P0 | 编译阻断 |
| C2 | MCP App 调用不存在的 `/api/mcp-app-host` | P0 | 运行时断链 |
| C3 | 主 Chat 创建 Agent 时未传入 `writerRef` | P1 | 子 Agent 流式事件断链 |
| C4 | MCP Wrapper 丢弃结构化及非文本结果 | P1 | MCP App/多模态数据丢失 |
| C5 | MCP 工具默认不进入统一审批 | P1 | 安全边界缺口 |
| C6 | Web Chat 待审批状态没有写入恢复 Store | P1 | 刷新/重启恢复不完整 |
| C7 | Context Length 重试使用错误的消息切片基准 | P1 | 消息可能不保存 |
| C8 | 消息存在服务端与前端双保存路径 | P2 | 竞态/重复写入风险 |
| C9 | Chunk 存在两套持久化机制但恢复职责不一致 | P2 | 架构与维护风险 |
| C10 | MCP App API 无法从当前调用参数可靠解析服务器 | P1 | 路由信息缺失 |
| C11 | 现有 MCP 文档与当前代码状态冲突 | P2 | 文档失真 |

---

## C1. MCP App 前端符号缺少导入或定义

**严重度：P0**

### 证据

`Chat.tsx` 使用了以下符号：

- `AppRendererProps`
- `CallToolResult`
- `McpUiOpenLinkResult`
- `McpAppSlot`
- `McpAppSlotProps`
- `loadResource`

使用位置：

- [`Chat.tsx:769-792`](../packages/app/components/Chat.tsx#L769-L792)
- [`Chat.tsx:1413-1424`](../packages/app/components/Chat.tsx#L1413-L1424)

当前文件顶部没有这些符号的 import，文件内也没有对应定义。

### 影响

- TypeScript 编译可能直接失败。
- MCP App 渲染分支无法工作。
- 即使运行环境跳过类型检查，运行到该分支时也可能出现 `ReferenceError`。

### 建议

1. 明确当前采用哪套 MCP App 渲染实现。
2. 从真实组件模块导入 `McpAppSlot`、类型和 `loadResource`；或者删除尚未完成的分支。
3. 先运行应用包的 typecheck/build，确认所有未解析符号。

### 验证

- App 包 TypeScript 检查通过。
- 调用带 `toolMetadata.app` 的 MCP 工具时能够进入渲染分支。
- 浏览器控制台无未定义符号错误。

---

## C2. MCP App 调用不存在的 `/api/mcp-app-host`

**严重度：P0**

### 证据

前端 MCP App handler 请求：

```ts
fetch('/api/mcp-app-host', {
  method: 'POST',
  body: JSON.stringify({ action: 'call-tool', ...params }),
})
```

位置：[`Chat.tsx:769-775`](../packages/app/components/Chat.tsx#L769-L775)。

当前 API 目录存在：

- [`/api/mcp/proxy`](../packages/app/app/api/mcp/proxy/route.ts)
- [`/api/mcp/resource`](../packages/app/app/api/mcp/resource/route.ts)
- [`/api/mcp/tool-meta`](../packages/app/app/api/mcp/tool-meta/route.ts)

但不存在：

```text
packages/app/app/api/mcp-app-host/route.ts
```

### 影响

MCP App 内部调用工具时会请求 404，App UI 即使成功渲染，也不能完成交互式工具调用。

### 建议

二选一，并保持单一协议：

1. 实现 `/api/mcp-app-host`，统一处理 `read-resource` 和 `call-tool`；或
2. 把前端 handler 改为调用现有 `/api/mcp/proxy?server=...`，并适配其 JSON-RPC 请求格式。

不建议同时维护两套无明确边界的 App Host API。

### 验证

- MCP App 内触发 `onCallTool`。
- Network 面板确认请求不是 404。
- API 能调用目标 MCP Server 的 `client.callTool()`。
- `CallToolResult` 原样返回 App。

---

## C3. 主 Chat 创建 Agent 时未传入 `writerRef`

**严重度：P1**

### 证据

Chat Route 创建了：

```ts
const writerRef: { current: SubAgentStreamWriter | null } = { current: null };
```

位置：[`route.ts:126`](../packages/app/app/api/chat/route.ts#L126)。

UI Stream 创建后又设置：

```ts
writerRef.current = writer;
```

位置：[`route.ts:373-376`](../packages/app/app/api/chat/route.ts#L373-L376)。

但是 [`route.ts:138-159`](../packages/app/app/api/chat/route.ts#L138-L159) 调用 `createAgent()` 时没有传入 `writerRef`。

`createAgent()` 只有收到 `options.writerRef` 才会继续传给 `loadAllTools()`：

- [`create.ts:205-225`](../packages/core/src/composition/app/create.ts#L205-L225)
- [`tools.ts:118-132`](../packages/core/src/modules/agent/tools.ts#L118-L132)

未传入时，子 Agent 工具使用新的 `{ current: null }`，与 Route 中后续绑定的 writer 不是同一个引用。

### 影响

以下子 Agent 流事件可能无法发送到前端：

```text
data-sub-text-delta
data-sub-tool-call
data-sub-tool-result
```

前端虽然实现了 `data-sub-*` 和 SubAgent 展示逻辑，但服务端事件写入端没有连通。

### 建议

调用 `createAgent()` 时传入同一个 `writerRef`：

```ts
await createAgent({
  ...,
  writerRef,
});
```

需要同时确认 Agent 创建早于 writer 绑定不是问题：子 Agent 实际执行发生在 UI Stream 启动后，此时 `writerRef.current` 应已设置。

### 验证

- 调用 `agent` 或 `parallel_agent` 工具。
- 确认前端实时收到子 Agent 文本、工具调用和结果事件。
- 确认不是等主工具完成后才一次性出现摘要。

---

## C4. MCP Wrapper 丢弃结构化及非文本结果

**严重度：P1**

### 证据

MCP 包装器先从原始结果中提取所有 text part，然后返回一个全新的结果：

```ts
return {
  content: [{ type: 'text', text: processed.content }],
  isError: result.isError ?? false,
};
```

位置：[`tool-wrapper.ts:47-74`](../packages/core/src/modules/mcp/tool-wrapper.ts#L47-L74)。

该实现只保留：

- 合并后的文本；
- `isError`。

可能被丢弃的字段包括：

- `structuredContent`；
- image content；
- resource content；
- audio 或其他扩展 content；
- MCP Result 的其他扩展字段。

工具定义本身因为使用 `{ ...tool }`，其 `toolMetadata.app` 可以保留；但工具执行结果并没有原样保留。

### 影响

- MCP App 可能拿不到用于初始化 UI 的 `structuredContent`。
- 多模态 MCP 工具结果会退化或丢失。
- App 渲染依赖的工具结果与 MCP Server 原始响应不一致。

### 建议

只替换需要压缩的 text part，保留原结果和其他 content：

```ts
return {
  ...result,
  content: originalContent.map(part =>
    part.type === 'text' ? processedTextPart : part
  ),
};
```

如果多个 text part 被合并，应明确合并策略，避免破坏原顺序和语义。

### 验证

至少覆盖：

1. 纯文本 MCP Tool Result；
2. `structuredContent`；
3. text + image/resource 混合结果；
4. 大文本持久化后，非文本字段仍存在；
5. MCP App 可以读取完整 `toolResult`。

---

## C5. MCP 工具默认不进入统一审批

**严重度：P1**

### 证据

统一审批只显式处理：

```text
bash
read_file
write_file
edit_file
```

见：

- [`tool-approval.ts:64-65`](../packages/core/src/modules/agent-control/tool-approval.ts#L64-L65)
- [`tool-approval.ts:198-234`](../packages/core/src/modules/agent-control/tool-approval.ts#L198-L234)

其他工具，包括：

```text
mcp__<server>__<tool>
```

默认返回 `undefined`。

### 影响

除非 MCP Tool Definition 自己声明审批要求，否则统一的：

- `smart`
- `auto-review`
- `full-trust`

模式不会对 MCP 工具形成清晰、统一的审批边界。

有外部副作用的 MCP 工具，例如创建工单、发送消息、修改云资源，可能绕过用户预期的审批流程。

### 建议

设计 MCP 工具审批策略，而不是简单地全部批准或全部询问。可考虑：

1. MCP 配置为每个 server/tool 声明 `allow`、`ask`、`deny`；
2. 默认只读工具自动批准，未知副作用工具请求用户审批；
3. 使用 qualified name 匹配权限规则；
4. `full-trust` 才对全部 MCP 工具放行；
5. MCP App 内直接调用工具也必须有独立的权限策略，不能因为调用来自 iframe 就绕过审批。

### 验证

- 分别测试无副作用和有副作用 MCP 工具。
- 三种 approval mode 的行为与 UI 文案一致。
- Permission Rule 能按 `mcp__server__tool` 精确匹配。

---

## C6. Web Chat 待审批状态没有写入恢复 Store

**严重度：P1**

### 证据

前端会调用：

```text
GET /api/chat/pending-approvals
```

见 [`Chat.tsx:951-980`](../packages/app/components/Chat.tsx#L951-L980)。

该端点读取 `suspendedStateStore`：

[`pending-approvals/route.ts:10-53`](../packages/app/app/api/chat/pending-approvals/route.ts#L10-L53)。

但当前代码搜索显示，`setSuspendedState()` 的写入路径主要位于 Connector 入站 Agent：

[`agent-handler.ts:781`](../packages/core/src/composition/inbound/agent-handler.ts#L781)。

`POST /api/chat` 主链路在产生 `approval-requested` 时没有看到对应的 `suspendedStateStore` 写入。

### 影响

- API 本身存在，但 Web Chat 刷新或桌面应用重启后可能拿不到待审批数据。
- 前端恢复逻辑看似完整，实际 Store 中可能没有该会话状态。
- 流恢复能恢复已经产生的 Chunk，但不等同于恢复可继续提交的审批状态。

### 建议

明确采用哪种恢复模型：

1. **消息驱动恢复**：持久化包含 `approval-requested` 的 assistant UIMessage，刷新后从消息历史重建审批 UI；或
2. **Suspended State 恢复**：主 Chat 在审批暂停时写入完整待审批状态，响应后清理。

避免只实现读取端而没有写入端。

### 验证

1. 触发工具审批；
2. 审批前刷新页面；
3. 重启服务或桌面应用；
4. 审批面板仍可恢复；
5. 批准后 Agent 能从正确消息上下文继续；
6. 已响应状态会从 Store 清理。

---

## C7. Context Length 重试使用错误的消息切片基准

**严重度：P1**

### 证据

正常完成时，新增 assistant 消息通过以下逻辑提取：

```ts
const newAssistantMessages = completedMessages.slice(llmMessages.length);
```

位置：[`route.ts:239`](../packages/app/app/api/chat/route.ts#L239)。

但发生 `context_length_error` 后，第二次流实际使用的是压缩后的：

```ts
retryResult.messages
```

见 [`route.ts:299-325`](../packages/app/app/api/chat/route.ts#L299-L325)。

压缩后的消息数量可能小于 `llmMessages.length`，而 `onEndHandler` 仍按原始数量切片。

此外，首次正常请求实际传入的是 `finalMessages`，而切片基准使用 `llmMessages.length`。当前附件替换通常不改变消息数量，但变量语义仍不准确。

### 影响

Context Length Retry 成功生成回答后，仍可能：

- 切掉新增 assistant 消息；
- 误判为 0 个有效 assistant 消息；
- 跳过 `finalizeAgentRun()`；
- 服务端不保存回答、标题和成本。

### 建议

让每次 `createAgentUIStream()` 对应自己的输入消息数量，并传给结束处理器，例如：

```ts
const createOnEnd = (inputMessageCount: number) =>
  async ({ messages: completedMessages }) => {
    const newAssistantMessages = completedMessages.slice(inputMessageCount);
  };
```

正常调用使用 `finalMessages.length`，重试调用使用 `retryResult.messages.length`。

### 验证

- 构造超过上下文上限、能通过压缩重试成功的会话。
- 确认回答出现在 UI。
- 刷新页面后回答仍存在。
- MessageStore、标题和成本均正确更新。

---

## C8. 消息存在服务端与前端双保存路径

**严重度：P2**

### 证据

服务端 Agent 流结束时：

```text
onEndHandler
  → finalizeAgentRun
  → messageStore.saveMessages
```

位置：

- [`route.ts:232-278`](../packages/app/app/api/chat/route.ts#L232-L278)
- [`finalize.ts:44-49`](../packages/core/src/composition/finalize.ts#L44-L49)

前端 `useChat.onFinish` 又调用：

```text
PATCH /api/chat
  → messageStore.saveMessages
```

位置：

- [`Chat.tsx:697-723`](../packages/app/components/Chat.tsx#L697-L723)
- [`route.ts:415-436`](../packages/app/app/api/chat/route.ts#L415-L436)

### 影响

取决于 MessageStore 的具体语义，可能产生：

- 重复写入；
- 最后写入覆盖服务端更完整的消息；
- 服务端和前端消息合并结果不一致；
- 两个请求发生竞态；
- 增加不必要的数据库 I/O。

### 建议

明确唯一权威写入方：

- 推荐以服务端 `onEnd` 为最终权威；
- 前端 PATCH 只用于明确的本地编辑或恢复场景；
- 如果必须双写，应证明 `saveMessages` 是覆盖式、幂等且有版本保护。

### 验证

- 检查 MessageStore 实现的覆盖/追加语义。
- 在慢网络和断线重连条件下记录两个保存请求的顺序。
- 确认工具 Part、审批响应和附件不会被后到的 PATCH 覆盖。

---

## C9. Chunk 存在两套持久化机制但恢复职责不一致

**严重度：P2**

### 证据

系统同时写入：

1. Resumable Stream 自身的 SQLite：
   ```text
   ~/.thething/chat-streams.db
   ```
   配置见 [`stream-manager.ts:53-85`](../packages/app/lib/stream-manager.ts#L53-L85)。

2. `agentRunStore` Chunk：
   ```ts
   store.agentRunStore.addChunk(conversationId, agentChunkCount, serialized);
   ```
   见 [`route.ts:331-343`](../packages/app/app/api/chat/route.ts#L331-L343)。

但恢复端点只调用：

```ts
streamManager.resumeExistingStream(...)
```

见 [`stream/route.ts:11-37`](../packages/app/app/api/chat/[chatId]/stream/route.ts#L11-L37)。

正常结束后又清除 `agentRunStore` Chunk：

```ts
store.agentRunStore.clearChunks(conversationId);
```

见 [`route.ts:233-238`](../packages/app/app/api/chat/route.ts#L233-L238)。

### 影响

- 两套 Chunk 数据的权威关系不明确。
- `agentRunStore` Chunk 看起来被写入，但没有参与当前恢复 API。
- 维护者可能误以为 Agent checkpoint 能恢复 LLM 执行；实际上当前恢复主要是重放已生成输出。
- 额外数据库写入增加复杂度和存储成本。

### 建议

明确区分并记录：

- **输出流恢复**：重放已经生成的 UIMessageChunk；
- **Agent 执行恢复**：恢复尚未完成的 ToolLoop、工具进程和审批现场。

如果 `agentRunStore` Chunk 没有消费者，应删除重复写入；如果计划承担跨进程执行恢复，需要实现明确的读取和恢复入口。

### 验证

分别测试：

1. 浏览器断线但服务端仍运行；
2. 浏览器刷新；
3. Node 进程重启；
4. 工具执行中重启；
5. 审批等待中重启。

记录每种场景到底恢复的是输出、消息，还是 Agent 执行。

---

## C10. MCP App API 无法从当前调用参数可靠解析服务器

**严重度：P1**

### 证据

现有 MCP Proxy 要求：

```text
POST /api/mcp/proxy?server=<serverName>
```

见 [`proxy/route.ts:27-37`](../packages/app/app/api/mcp/proxy/route.ts#L27-L37)。

而 `Chat.tsx` 的 MCP App handler 只发送：

```ts
{ action: 'call-tool', ...params }
```

见 [`Chat.tsx:769-775`](../packages/app/components/Chat.tsx#L769-L775)。

当前渲染层能够拿到 qualified tool name：

```text
mcp__serverName__toolName
```

但 `McpAppSlot` 参数中只传了 `toolName`，没有显式传入 `serverName`。

### 影响

即使把 URL 从 `/api/mcp-app-host` 改为 `/api/mcp/proxy`，API 仍可能不知道该调用哪一个 MCP Server。

不同 Server 还可能包含同名 Tool，不能只按基础 Tool Name 全局查找。

### 建议

在渲染边界解析并显式传递：

```text
qualifiedToolName
serverName
baseToolName
```

App 内发起工具调用时，请求必须包含目标 Server，或者由后端通过受控映射解析，不能扫描所有 Server 后调用第一个同名工具。

### 验证

配置两个都包含同名 Tool 的 MCP Server，确认 App 调用始终路由到触发当前 App 的服务器。

---

## C11. 现有 MCP 文档与当前代码状态冲突

**严重度：P2**

### 证据

现有文档 [`mcp-app-implementation-summary.md`](./mcp-app-implementation-summary.md) 声称以下文件或能力已经存在：

- `packages/app/components/mcp-widget.tsx`
- `packages/app/components/mcp-app-dynamic-renderer.tsx`
- `packages/app/app/api/mcp-app-host/route.ts`
- `/api/mcp/servers`
- Chat.tsx 已导入对应组件

但当前工作区文件搜索与 `Chat.tsx` 内容不支持这些结论。

[`mcp-apps-gap-analysis.md`](./mcp-apps-gap-analysis.md) 也在“实施状态”部分把所有差距标记为已修复，并引用了当前工作区不存在的文件。

### 影响

- 维护者可能基于错误前提继续开发。
- “已修复”状态会掩盖当前编译和运行时断链。
- 测试计划与真实实现不对应。

### 建议

在修复代码前后同步审计这些文档：

1. 将“已完成”改为经过当前分支验证的状态；
2. 删除或标记不存在的文件；
3. 区分历史方案、已删除实现和当前方案；
4. 文档中的每个完成项都附实际测试记录或对应提交。

---

## 建议修复顺序

### 第一阶段：恢复可编译和基本 MCP App 链路

1. C1：补全或移除未定义 MCP App 符号。
2. C2：统一 MCP App Host API。
3. C10：明确 server/tool 路由信息。
4. 实际启动前端，完成 MCP App 资源加载和 App 内工具调用测试。

### 第二阶段：保证数据和流链路正确

1. C3：传递 `writerRef`，恢复子 Agent 实时事件。
2. C4：保留完整 MCP Tool Result。
3. C7：修复 Context Length Retry 的切片基准。
4. C8：确定消息唯一权威写入方。

### 第三阶段：审批和恢复语义

1. C5：定义 MCP 工具审批策略。
2. C6：补齐 Web Chat 审批状态写入或改成消息驱动恢复。
3. C9：明确输出流恢复与 Agent 执行恢复的边界。

### 第四阶段：文档校准

1. C11：更新已有 MCP 文档。
2. 所有“已完成”项必须有 typecheck、浏览器实测或自动化测试证据。

---

## 建议验收矩阵

| 场景 | 预期结果 |
|---|---|
| 普通文本对话 | 流式文本完成并刷新后可见 |
| reasoning | reasoning Chunk 顺序正确，重连不重复 |
| 普通只读工具 | 按 smart 规则自动批准并显示结果 |
| 普通写入工具 | 审批模式符合配置，批准后继续 |
| MCP 文本工具 | qualified name 路由正确，结果进入下一轮模型 |
| MCP 结构化工具 | `structuredContent` 不丢失 |
| MCP 多模态工具 | 非 text content 不丢失 |
| MCP App 资源 | `resourceUri` 可读取并渲染 |
| MCP App 调工具 | 调用正确 Server，结果返回 App |
| 子 Agent | `data-sub-*` 实时显示 |
| 审批中刷新 | 审批 UI 和上下文可恢复 |
| 流中断重连 | 从准确 Chunk 边界继续，无重复/缺失 |
| Context Length Retry | 压缩后回答仍保存 |
| 停止执行 | LLM、流和支持 AbortSignal 的工具均终止 |
| 首轮结束 | 消息、标题和成本只进行预期次数的持久化 |

## 结论

当前普通 Chat 和基础 ToolLoop 主干可辨识，但 MCP App、子 Agent 流式事件、MCP 结果保真、MCP 审批和跨重启审批恢复仍有关键缺口。应先解决 P0 编译与 API 断链，再处理结果保真、审批边界和恢复语义，最后校准现有文档中的“已完成”状态。