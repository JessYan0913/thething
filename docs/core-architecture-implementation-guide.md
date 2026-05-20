# 实施手册：core 模块架构修复

## Context

基于 `docs/core-module-architecture-analysis.md` 的分析，core 包存在两个必须修的架构问题：
1. **P0** — connector/inbound 反向依赖 composition（循环依赖）
2. **P1** — 两条 Agent 路径（直接 API + Connector 入站）的后处理逻辑重复，且存在 double-persist bug

本手册是按执行顺序编写的操作步骤。每一步有：做什么、改哪些文件、怎么验证。

---

## 执行顺序

先 P1（提取 finalize），再 P0（搬文件）。原因：P1 是独立的小改动，不依赖 P0；P0 搬文件时可以直接用已经提取好的 finalize。

---

## Phase 1：提取共享后处理函数（P1）

### 目标

消除 `routes/chat.ts` 和 `agent-handler.ts` 的后处理重复，同时修复 agent-handler 里的 double cost persist bug。

### 现状分析

两边的后处理有细微差异：

| 方面 | chat.ts | agent-handler.ts |
|------|---------|-----------------|
| 记忆目录 | `context.cwd` | `getPrimaryMemoryDir(layout)` |
| entrypointLimits | 不传 | 传 `{ maxLines, maxBytes }` |
| 成本持久化 | `await persistToDB()` | `persistToDB()` + `dispose()` 再调一次 ← **bug** |
| 消息过滤 | 按注入位置切片 | `filterInjectedMessages()` 去掉 system-reminder |

`finalizeAgentRun` 需要兼容两边的差异，同时修掉 bug。

### Step 1.1：创建 `composition/finalize.ts`

**新建文件：** `packages/core/src/composition/finalize.ts`

```typescript
import type { UIMessage } from 'ai'
import type { LanguageModel } from '@ai-sdk/provider'
import type { DataStore } from '../primitives/datastore/types'
import type { SessionState } from '../modules/session/types'
import type { McpRegistry } from '../modules/mcp/types'
import { extractMemoriesInBackground } from '../modules/memory'
import { generateConversationTitle } from '../modules/compaction'
import { logger } from '../primitives/logger'

export interface FinalizeAgentRunOptions {
  dataStore: DataStore
  messages: UIMessage[]
  conversationId: string
  sessionState: SessionState
  mcpRegistry?: McpRegistry | null
  model: LanguageModel
  isNewConversation: boolean
  memoryBaseDir?: string
  userId?: string
  entrypointLimits?: { maxLines?: number; maxBytes?: number }
}

export async function finalizeAgentRun(opts: FinalizeAgentRunOptions): Promise<void> {
  const { dataStore, messages, conversationId, sessionState, mcpRegistry } = opts

  // 1. 保存消息
  dataStore.messageStore.saveMessages(conversationId, messages)

  // 2. 后台任务：记忆提取 + 标题生成 + 成本持久化 + 清理
  setImmediate(async () => {
    try {
      // 记忆提取
      extractMemoriesInBackground(
        messages, opts.userId, conversationId, opts.model,
        opts.memoryBaseDir, opts.entrypointLimits
      ).catch(e => logger.warn('Memory extraction failed:', e))

      // 首次对话生成标题
      if (opts.isNewConversation) {
        generateConversationTitle(messages, opts.model)
          .then(title => dataStore.conversationStore.updateConversationTitle(conversationId, title))
          .catch(e => logger.warn('Title generation failed:', e))
      }

      // 成本持久化（只调一次，修复 double-persist bug）
      await sessionState.costTracker.persistToDB()

      // MCP 清理
      if (mcpRegistry) {
        await mcpRegistry.disconnectAll()
      }
    } catch (e) {
      logger.warn('Post-processing error:', e)
    }
  })
}
```

### Step 1.2：更新 `packages/core/src/index.ts`

添加 re-export：
```typescript
export { finalizeAgentRun, type FinalizeAgentRunOptions } from './composition/finalize'
```

### Step 1.3：更新 `packages/server/src/routes/chat.ts`

把 `onFinish` 里的 5 步后处理替换为 `finalizeAgentRun()` 调用。需要注意：
- `memoryBaseDir` 传 `context.runtime.layout.resourceRoot` 或通过 `getPrimaryMemoryDir` 计算
- 消息切片逻辑（`messages.slice` 取新消息）保留在调用方，传给 finalize 的是最终要保存的消息数组

### Step 1.4：更新 `agent-handler.ts` 的后处理

把 `setImmediate` 块里的 5 步后处理替换为 `finalizeAgentRun()` 调用。同时删掉 `dispose()` 调用中的重复 `persistToDB()`。

### 验证

```bash
pnpm --filter @the-thing/core typecheck
pnpm --filter @the-thing/server typecheck
pnpm --filter @the-thing/core test
```

---

## Phase 2：拆分 connector/inbound（P0）

### 目标

把 Agent 编排逻辑从 `modules/connector/` 搬到 `composition/inbound/`，消除循环依赖。

### 要搬的文件（3 个）

| 文件 | 行数 | 搬到 |
|------|------|------|
| `modules/connector/inbound/agent-handler.ts` | 943 | `composition/inbound/agent-handler.ts` |
| `modules/connector/inbound/inbound-processor.ts` | 277 | `composition/inbound/inbound-processor.ts` |
| `modules/connector/factory.ts` 中 `configureConnectorInboundRuntime` | ~40 | `composition/inbound/factory.ts` |

### 要一起搬的辅助文件（2 个）

| 文件 | 原因 |
|------|------|
| `modules/connector/approval-handler.ts` | 仅被 agent-handler.ts 使用 |
| `modules/connector/approval-context.ts` | 仅被 agent-handler.ts 使用 |

### 留在 connector/inbound/ 的文件（不动）

```
modules/connector/inbound/
├── gateway/inbound-gateway.ts     ← 协议入口
├── adapters/*.ts                  ← 飞书/微信适配
├── inbox/memory-inbox.ts          ← 内存队列
├── inbox/sqlite-inbox.ts          ← SQLite 队列
├── responder/responder.ts         ← 回复派发
├── crypto/*.ts                    ← 加解密
├── runtime.ts                     ← InboundRuntime（只依赖 inbound 内部）
└── types.ts                       ← InboundEvent 等类型
```

### 与现有 composition/inbound-agent/ 的关系

现有 `composition/inbound-agent/` 里只有空接口（AgentRunner、InboundPostProcess、PendingApproval）和两个简单实现（DefaultConversationResolver、DefaultInboundAgentService）。

做法：**合并到 `composition/inbound/`**，删除 `composition/inbound-agent/` 目录。

新目录结构：
```
composition/inbound/
├── agent-handler.ts          ← 从 connector 搬来（943 行）
├── inbound-processor.ts      ← 从 connector 搬来（277 行）
├── factory.ts                ← 从 connector/factory.ts 拆出入站部分
├── approval-handler.ts       ← 从 connector 搬来
├── approval-context.ts       ← 从 connector 搬来
├── conversation-resolver.ts  ← 原 inbound-agent/ 已有
├── approval-service.ts       ← 原 inbound-agent/ 已有
├── agent-runner.ts           ← 原 inbound-agent/ 已有（接口）
├── post-process.ts           ← 原 inbound-agent/ 已有（接口）
└── index.ts                  ← 新 barrel
```

### Step 2.1：创建 `composition/inbound/` 目录

把 `composition/inbound-agent/` 下的文件移过来，然后删除 `inbound-agent/`。

### Step 2.2：搬 agent-handler.ts

1. 复制 `modules/connector/inbound/agent-handler.ts` → `composition/inbound/agent-handler.ts`
2. 更新 import 路径：

| 原 import | 新 import |
|-----------|-----------|
| `from '../../../composition/app/types'` | `from '../app/types'`（同层） |
| `from '../registry'` | `from '../../modules/connector/registry'` |
| `from '../types'` | `from '../../modules/connector/types'` |
| `from '../approval-handler'` | `from './approval-handler'`（一起搬了） |
| `from '../approval-context'` | `from './approval-context'`（一起搬了） |
| `from '../../../modules/compaction'` | `from '../../modules/compaction'` |
| `from '../../../modules/memory'` | `from '../../modules/memory'` |
| `from '../../../modules/permissions/rules'` | `from '../../modules/permissions/rules'` |
| `from '../../../primitives/datastore/types'` | `from '../../primitives/datastore/types'` |
| `from '../../../primitives/logger'` | `from '../../primitives/logger'` |
| `from './types'` | `from '../../modules/connector/inbound/types'` |
| `from './inbound-processor'` | `from './inbound-processor'`（一起搬了） |

3. 删除原文件 `modules/connector/inbound/agent-handler.ts`

### Step 2.3：搬 inbound-processor.ts

1. 复制 → `composition/inbound/inbound-processor.ts`
2. 更新 import 路径：

| 原 import | 新 import |
|-----------|-----------|
| `from '../registry'` | `from '../../modules/connector/registry'` |
| `from '../audit-logger'` | `from '../../modules/connector/audit-logger'` |
| `from '../debug'` | `from '../../modules/connector/debug'` |
| `from './types'` | `from '../../modules/connector/inbound/types'` |
| `from './responder/responder'` | `from '../../modules/connector/inbound/responder/responder'` |

3. 删除原文件

### Step 2.4：搬 approval-handler.ts 和 approval-context.ts

1. 复制两个文件到 `composition/inbound/`
2. 更新 import 路径（它们引用 `./inbound/types` 需改为 `../../modules/connector/inbound/types`）
3. 删除原文件

### Step 2.5：从 connector/factory.ts 拆出入站配置

1. 在 `composition/inbound/factory.ts` 创建新文件，包含 `configureConnectorInboundRuntime` 函数
2. 从 `modules/connector/factory.ts` 删除该函数和相关 import
3. `modules/connector/factory.ts` 保留 `createConnectorRuntime`、`initializeConnectorRuntime`、`disposeConnectorRuntime`
4. 注意：`createConnectorRuntime` 里创建了 inbound 组件（gateway、inbox、responder、runtime），这部分 **保留在 connector/factory.ts** 因为它们是通信基础设施

### Step 2.6：更新 barrel 导出

**`modules/connector/inbound/index.ts`：**
- 删除 `agent-handler.ts`、`inbound-processor.ts` 的 re-export
- 保留 gateway、adapters、inbox、responder、runtime、types、crypto 的 re-export

**`modules/connector/index.ts`：**
- 删除 `approval-handler.ts`、`approval-context.ts` 的 re-export
- 删除 `configureConnectorInboundRuntime` 的 re-export
- `export * from './inbound/index'` 保留（inbound 里剩下的都是通信基础设施）

**新建 `composition/inbound/index.ts`：**
- 导出 agent-handler、inbound-processor、factory、conversation-resolver、approval-service 等

**`packages/core/src/index.ts`：**
- `InboundEventProcessor`、`AgentInboundHandler`、`configureConnectorInboundRuntime` 的 re-export 路径改为 `'./composition/inbound'`
- `DefaultConversationResolver`、`DefaultInboundAgentService` 的 re-export 路径改为 `'./composition/inbound'`
- 通信基础设施（`ConnectorInboundGateway`、`ConnectorResponder` 等）仍从 `'./modules/connector/inbound'` 导出

### Step 2.7：更新消费者的内部 import

需要更新的文件（5 个）：

| 文件 | 改什么 |
|------|--------|
| `composition/bootstrap.ts` | `ConnectorInboundRuntime` import 路径不变（它从 connector/inbound/types 导入，types 没搬） |
| `composition/inbound/conversation-resolver.ts` | `InboundEvent` import 从 `../../modules/connector/inbound/types` 改为同目录的相对路径或保持 |
| `composition/inbound/approval-service.ts` | `ReplyAddress` import 路径更新 |
| `composition/inbound/inbound-agent-service.ts` | `InboundEvent`、`InboundEventHandler` import 路径更新 |
| `modules/connector/types.ts` | 如有对 approval-context/handler 的引用需清理 |

### Step 2.8：更新测试文件

| 测试文件 | 改什么 |
|----------|--------|
| `modules/connector/inbound/__tests__/agent-handler-approval.test.ts` | import 路径改为 `composition/inbound/agent-handler` |
| `modules/connector/inbound/__tests__/gateway.test.ts` | 如果引用了 InboundEventProcessor，import 路径更新 |

### 验证

```bash
# 1. 类型检查
pnpm --filter @the-thing/core typecheck
pnpm --filter @the-thing/server typecheck
pnpm --filter @the-thing/cli typecheck

# 2. 单元测试
pnpm --filter @the-thing/core test

# 3. 验证 import 方向（不应有 modules/ → composition/ 的 import）
grep -r "from.*\.\./composition" packages/core/src/modules/ --include="*.ts" | grep -v __tests__
# 期望输出：空（零结果）

# 4. 验证 server 包不受影响（它通过 @the-thing/core barrel 导入，路径不变）
grep -r "connector/inbound" packages/server/src/ --include="*.ts"
# 期望输出：空（server 不直接引用内部路径）
```

---

## Phase 3：P2 快速修复（可选，每个独立）

每个都是 10 分钟以内的独立改动，不需要设计。

### 3.1 resolveModelAlias 移到 services/model/

- 从 `modules/subagents/model-resolver.ts` 剪切 `resolveModelAlias` 函数
- 粘贴到 `services/model/` 新文件或 `capabilities.ts`
- 更新 `session/model-switching.ts` 和 `subagents/model-resolver.ts` 的 import

### 3.2 合并 CompactionConfig 双重定义

- 删除 `modules/compaction/types.ts` 中的 `LifecycleConfig`、`ContextWindowConfig`、`CompactionConfig`
- 改为从 `services/config/compaction-types.ts` import
- 更新所有引用

### 3.3 清理 services/config 的 type re-export

- 删除 `services/config/types.ts` 中 7 个从 modules/ 的 type import
- 保留 `services/model` 和 `primitives/` 的 type import（这些是合法的同层/下层依赖）
- 更新消费者直接从各 module 导入类型
- `packages/core/src/index.ts` 的 re-export 保持不变（包顶层允许跨层）

---

## 风险评估

| Phase | 风险 | 缓解 |
|-------|------|------|
| Phase 1 | `finalizeAgentRun` 的参数签名与两边的调用方式不完全匹配 | 先跑 typecheck 对齐签名 |
| Phase 2 | 搬文件后 import 路径遗漏 | `pnpm typecheck` 会捕获所有错误路径 |
| Phase 2 | `@the-thing/core` barrel 导出变化导致 server 编译失败 | 保持 index.ts 的 public API 不变，只改内部路径 |
| Phase 3 | 无风险，每个改动独立且有 typecheck 保底 | — |
