# TurnExecutor 设计：统一 Agent 执行引擎

> 参考：[OpenAI Codex Harness 架构](https://openai.com/index/unlocking-the-codex-harness/) | [Harness Engineering](https://openai.com/index/harness-engineering/)

## 1. 问题

TheThing 目前有三条独立的 Agent 执行路径，各自实现了不同子集的执行能力：

| 能力 | CLI | Chat API (Web) | Connector Inbound |
|------|-----|----------------|-------------------|
| Agent 创建 | `createAgent()` 每轮重建 | `createAgent()` 每请求重建 | `createAgent()` 每请求重建 |
| 流式输出 | `createAgentUIStream` → stdout | `createAgentUIStream` → UIMessageStream | 手动 `agent.stream()` 循环 |
| 审批流 | 无 | 客户端 part.state（无 suspend/resume） | 完整 suspend/resume |
| 会话锁 | 不需要 | 无 | `withConversationLock` |
| 事件去重 | 不需要 | 无 | `claimInboundEvent` |
| 重试 | 无 | 无 | ECONNRESET/terminated 重试 |
| 多轮循环 | 无（AI SDK 内部） | 无（AI SDK 内部） | 最多 10 轮审批循环 |
| finalize | `onFinish` 回调 | `onFinish` 回调（缺少 dispose/entrypointLimits） | `finalizeAgentRun` 完整调用 |

核心矛盾：**最完整的执行引擎被锁在 Connector Inbound 的专用代码里**（`AgentInboundHandler.runAgentLoop()`，~300 行），Chat API 和 CLI 无法共享这些能力。新增平台（IDE 插件、桌面 App、飞书机器人以外的连接器）需要重新实现执行逻辑。

这与 OpenAI Codex 团队在构建 App Server 前遇到的问题一致：
> "Without the harness, each surface would require redundant re-implementation."

## 2. 目标

从 `AgentInboundHandler` 中提取通用的 **TurnExecutor**，让所有执行路径共享同一个核心：

```
                    入口层（各自适配）
          ┌──────────┬──────────┬──────────────┐
          │  CLI     │  Web     │  Connector   │
          │  stdin   │  HTTP    │  Webhook/WS  │
          └────┬─────┴────┬─────┴──────┬───────┘
               │          │            │
               ▼          ▼            ▼
          ┌─────────────────────────────────────┐
          │         TurnExecutor (新增)          │
          │                                     │
          │  • agent.stream() 多轮循环 + 重试   │
          │  • 审批检查 + suspend/resume         │
          │  • TurnEvent 事件发射               │
          │  • 累积状态管理                     │
          └──────────────┬──────────────────────┘
                         │
                    事件回调/通知
                         │
          ┌──────────┬───┴──────┬──────────────┐
          │  CLI     │  Web     │  Connector   │
          │  stdout  │  Stream  │  Responder   │
          └──────────┴──────────┴──────────────┘
```

**TurnExecutor 负责的**：
- 驱动 agent.stream() 的多轮循环
- ECONNRESET/terminated 重试
- 审批检查（permission rules + session approved）
- 审批挂起（返回 SuspendedTurnState）和恢复
- 通过 onEvent 回调发射执行事件
- 累积状态（steps、responseText、writtenFiles、approvedTools）

**TurnExecutor 不负责的**（留给调用方）：
- 会话锁（conversation locking）— 并发控制是入口层关注点
- 事件去重（deduplication）— 传输层关注点
- 消息持久化 — 不同 surface 有不同存储策略
- 会话标题生成 — surface 特有需求
- 记忆提取 — 后处理关注点
- MCP 清理 — 生命周期管理由调用方负责

## 3. API 设计

### 3.1 核心类型

```typescript
// ===== 累积状态 =====
// 跨轮次（round）的执行状态，从 agent-handler.ts:276-282 提取
export interface AccumulatedState {
  allSteps: unknown[]
  responseText: string
  writtenFiles: Array<{ path: string; content: string }>
  approvedTools: string[]
}

// ===== Turn 执行事件 =====
// 执行过程中发射的事件，surface 层消费并转换为特定格式
export type TurnEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'approval-auto-resolved'; toolCallId: string; toolName: string; decision: 'approve' | 'deny' }
  | { type: 'approval-suspended'; pendingApprovals: SuspendedApprovalRequest[]; askText: string }
  | { type: 'round-start'; round: number }
  | { type: 'round-complete'; round: number; finishReason: string }
  | { type: 'retry'; attempt: number; error: Error }

// ===== Turn 执行结果 =====
export interface TurnResult {
  status: 'completed' | 'suspended' | 'max-rounds' | 'error'
  responseText: string
  allSteps: unknown[]
  writtenFiles: Array<{ path: string; content: string }>
  finishReason?: string
  suspended?: SuspendedTurnState   // status === 'suspended' 时存在
  error?: Error                     // status === 'error' 时存在
}

// ===== 挂起状态 =====
// 从 approval-context.ts:26-43 泛化，去掉 connector 专有字段（replyAddress、connectorEventId）
export interface SuspendedTurnState {
  pausedModelMessages: unknown[]
  pendingApprovals: SuspendedApprovalRequest[]
  accumulated: AccumulatedState
  approvalAskMessageId: string
  createdAt: number
}

// ===== executeTurn 参数 =====
export interface ExecuteTurnOptions {
  agent: ToolLoopAgent
  modelMessages: unknown[]        // 初始 ModelMessages
  sessionState: SessionState
  permissions?: PermissionRule[]   // 权限规则（用于自动审批判断）
  approvedTools?: string[]         // 会话级已批准工具
  maxRounds?: number               // 默认 10
  maxRetries?: number              // 默认 2
  accumulated?: AccumulatedState   // resume 时传入已有累积状态
  onEvent?: (event: TurnEvent) => void
}
```

### 3.2 核心函数

```typescript
// 执行一个 Turn
export async function executeTurn(options: ExecuteTurnOptions): Promise<TurnResult>

// 构建恢复用的 ModelMessages（追加 tool-approval-response）
export function buildResumeMessages(
  suspended: SuspendedTurnState,
  approvedToolCallIds: string[]
): unknown[]
```

### 3.3 各 Surface 使用方式

**Connector Inbound**（重构后）：
```typescript
// startFreshRun 内部
const modelMessages = convertToModelMessages(sanitizeMessagesForConversion(uiMessages))
const result = await executeTurn({ agent, modelMessages, sessionState, permissions })

if (result.status === 'suspended') {
  // 保存挂起状态（含 connector 扩展字段 replyAddress）
  setSuspendedState(conversationId, {
    ...result.suspended,
    replyAddress: event.replyAddress,
    connectorEventId: event.id,
  })
  return { success: true, response: result.suspended.askText }
}

// 正常完成 → finalize + 返回响应
await finalizeAgentRun({ ... })
return { success: true, response: result.responseText }
```

**Chat API**（重构后）：
```typescript
// POST /api/chat 内部
const modelMessages = convertToModelMessages(sanitizeMessagesForConversion(uiMessages))
const result = await executeTurn({
  agent, modelMessages, sessionState, permissions,
  onEvent: createTurnEventWriter(writer),  // TurnEvent → UIMessageStream 适配
})
await finalizeAgentRun({ ... })
```

**CLI**（未来）：
```typescript
const modelMessages = convertToModelMessages(sanitizeMessagesForConversion(uiMessages))
const result = await executeTurn({
  agent, modelMessages, sessionState,
  onEvent: (event) => {
    if (event.type === 'text-delta') process.stdout.write(event.delta)
    if (event.type === 'reasoning') process.stdout.write(chalk.gray(event.text))
    // ...
  },
})
```

## 4. 代码提取映射

### 从 `agent-handler.ts` 提取到 `turn-executor/`

| 源位置 | 目标文件 | 说明 |
|--------|----------|------|
| `stepsToMessageParts()` (L46-147) | `utils.ts` | 纯函数，AI SDK steps → UIMessage parts |
| `sanitizeMessagesForConversion()` (L156-180) | `utils.ts` | 数据清洗 |
| `toToolResultOutput()` (L189-215) | `utils.ts` | 工具结果标准化 |
| `collectExecutedToolResults()` (L217-253) | `utils.ts` | 从 steps 收集工具结果 |
| `filterSystemContent()` (L892-898) | `utils.ts` | 响应文本清洗 |
| `filterInjectedMessages()` (L900-909) | `utils.ts` | 注入消息过滤 |
| 审批 scope 辅助函数 (L327-351) | `approval.ts` | approvalScopesForTool 等 |
| `runAgentLoop()` 核心逻辑 (L538-856) | `executor.ts` | **主提取目标** |
| `resumeFromSuspended()` 恢复逻辑 (L474-536) | `resume.ts` | 构建恢复 messages |

### 从 `approval-handler.ts` 提取到 `turn-executor/approval.ts`

| 源位置 | 说明 |
|--------|------|
| `describeApprovalTarget()` (L14-28) | 工具审批描述格式化 |
| `buildApprovalAskMessageForRequests()` (L30-65) | 审批询问消息构建 |

### 保留在 `inbound/` 的 Connector 专有逻辑

| 函数/逻辑 | 原因 |
|-----------|------|
| `handle()` 入口路由 | InboundEvent 分发 |
| `claimInboundEvent()` 去重 | 传输层关注点 |
| `withConversationLock()` 会话锁 | 并发控制 |
| `findOrCreateConversation()` | Connector 会话解析 |
| `buildUserMessage()` | InboundEvent → UIMessage |
| `setSuspendedState()` 存储 | 含 connector 扩展字段 |

## 5. 文件变更

### 新建 (6 个文件)

```
packages/core/src/composition/turn-executor/
├── types.ts        — AccumulatedState, TurnEvent, TurnResult, SuspendedTurnState, ExecuteTurnOptions
├── executor.ts     — executeTurn() 核心函数
├── approval.ts     — 审批检查/格式化逻辑
├── utils.ts        — stepsToMessageParts 等纯函数
├── resume.ts       — buildResumeMessages()
└── index.ts        — barrel export
```

### 修改 (4 个文件)

| 文件 | 改动 |
|------|------|
| `packages/core/src/composition/inbound/agent-handler.ts` | runAgentLoop → executeTurn，~943 行缩至 ~400 行 |
| `packages/core/src/composition/inbound/approval-context.ts` | SuspendedAgentState → SuspendedTurnState + ConnectorSuspendedState |
| `packages/core/src/index.ts` | 添加 turn-executor 导出 |
| `packages/server/src/routes/chat.ts` | createAgentUIStream → executeTurn + 流适配器 |

### 新建 (1 个 Server 文件)

```
packages/server/src/routes/chat-stream-adapter.ts  — TurnEvent → UIMessageStreamWriter 适配
```

### 不改动

- `packages/core/src/composition/app/create.ts` — createAgent 保持不变
- `packages/core/src/composition/app/finalize.ts` — finalizeAgentRun 保持不变
- `packages/cli/` — CLI 暂不改动，后续独立 PR

## 6. Chat API 附带修复

当前 Chat API 存在几个与 Connector Inbound 不一致的问题，在迁移到 TurnExecutor 时一并修复：

| 问题 | 当前状态 | 修复 |
|------|---------|------|
| `dispose()` 未调用 | CreateAgentResult.dispose() 从未被调用 | TurnResult 完成后调用 dispose() |
| `conversationMeta` 未传递 | isTurnZero 始终为 false | 传递 isNewConversation + startTime |
| `entrypointLimits` 未传递 | 记忆提取使用默认限制 | 从 behavior.memory 传递 |
| 审批能力缺失 | 靠前端 part.state 模拟 | TurnExecutor 提供完整 suspend/resume |

## 7. 与 Codex App Server 的对比

| Codex 概念 | TheThing TurnExecutor | 备注 |
|------------|----------------------|------|
| App Server 协议 | executeTurn + TurnEvent | 函数调用而非 JSON-RPC，同一进程内通信 |
| Turn lifecycle | TurnResult.status | completed/suspended/max-rounds/error |
| Item lifecycle | TurnEvent 事件序列 | started/delta/completed 映射为不同事件类型 |
| Approval flow | SuspendedTurnState + buildResumeMessages | 状态化而非协议化 |
| Thread persistence | 不在 TurnExecutor 范围 | 留给调用方 + DataStore |

**核心差异**：Codex 的 App Server 是一个独立进程通过 JSON-RPC 通信；TheThing 的 TurnExecutor 是同一进程内的函数调用。这是因为：
1. TheThing 使用 TypeScript 单体架构（非 Rust + 多进程）
2. CLI 和 Server 都运行在 Node.js 进程内
3. 进程内函数调用比 IPC 更简单，对当前项目阶段更合适

如果未来需要跨进程通信（如独立的 Agent 进程），TurnEvent 事件模型可以直接序列化为 JSON-RPC 通知。

## 8. 验证方案

1. **类型检查**：`pnpm typecheck` 全项目通过
2. **单元测试**：`pnpm --filter @the-thing/core test` 通过
3. **Connector Inbound 回归**：飞书连接器发送消息 →
   - 正常对话流程不变
   - 审批 suspend/resume 正常
   - emoji reaction 指示器正常
4. **Web Chat 回归**：`pnpm dev:web` + `pnpm dev:server` →
   - 流式输出正常
   - 工具调用正常展示
   - 多轮对话正常
5. **Web Chat 增强验证**：触发需要审批的工具调用 →
   - 前端收到 approval 事件
   - 审批交互流程正常
