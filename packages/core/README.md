# @thething/core

TheThing Agent Core — 一个模块化的 AI Agent 框架核心，提供数据存储、Agent 创建、消息压缩、记忆管理、MCP 集成等功能。

## 目录

- [快速开始](#快速开始)
- [数据存储](#数据存储)
- [创建 Agent](#创建-agent)
- [消息压缩](#消息压缩)
- [记忆系统](#记忆系统)
- [Skills 系统](#skills-系统)
- [MCP 集成](#mcp-集成)
- [Connector Gateway](#connector-gateway)
- [子 Agent 系统](#子-agent-系统)
- [会话状态](#会话状态)
- [模型配置](#模型配置)

## 快速开始

### 安装

```bash
pnpm add @thething/core
```

### 初始化

```typescript
import { initAll, getGlobalDataStore } from '@thething/core';

// 初始化所有系统
await initAll({
  dataDir: './data',  // 数据存储目录
});

// 获取数据存储实例
const store = getGlobalDataStore();
```

### 基本使用

```typescript
import {
  createChatAgent,
  getGlobalDataStore,
} from '@thething/core';
import { createAgentUIStream, type UIMessage } from 'ai';

// 创建对话
const store = getGlobalDataStore();
store.conversationStore.createConversation('conv-123', 'My Chat');

// 创建 Agent
const { agent, sessionState, mcpRegistry } = await createChatAgent({
  conversationId: 'conv-123',
  messages: [],
  userId: 'user-1',
  modelConfig: {
    apiKey: process.env.DASHSCOPE_API_KEY!,
    baseURL: process.env.DASHSCOPE_BASE_URL!,
    modelName: 'qwen-max',
    includeUsage: true,
  },
});

// 流式处理
const stream = await createAgentUIStream({
  agent,
  uiMessages: messages,
  abortSignal: abortController.signal,
  onFinish: async ({ messages }) => {
    // 保存消息
    store.messageStore.saveMessages('conv-123', messages);
    // 断开 MCP
    if (mcpRegistry) await mcpRegistry.disconnectAll();
  },
});
```

---

## 数据存储

`DataStore` 是数据存储的抽象层，默认提供 SQLite 实现，支持开发者自定义实现（如 PostgreSQL、MongoDB 等）。

**注意：记忆系统使用纯文件存储（`.thething/memory/`），不在 DataStore 中。**

### 架构

```
datastore/
├── index.ts          # 模块入口
├── types.ts          # 接口定义（无实现依赖）
├── store.ts          # 全局实例管理
└── sqlite/           # SQLite 实现
    ├── sqlite-data-store.ts
    ├── conversation-store.ts
    ├── message-store.ts
    ├── summary-store.ts
    └── cost-store.ts
```

### 使用默认 SQLite

```typescript
import { getGlobalDataStore } from '@thething/core';

const store = getGlobalDataStore();

// Conversation 操作
store.conversationStore.createConversation('conv-1', 'Title');
store.conversationStore.getConversation('conv-1');
store.conversationStore.listConversations();
store.conversationStore.updateConversationTitle('conv-1', 'New Title');
store.conversationStore.deleteConversation('conv-1');

// Message 操作
store.messageStore.getMessagesByConversation('conv-1');
store.messageStore.saveMessages('conv-1', messages);
store.messageStore.getNextMessageOrder('conv-1');

// Summary 操作（用于消息压缩）
store.summaryStore.saveSummary('conv-1', 'Summary text...', 10, 5000);
store.summaryStore.getSummaryByConversation('conv-1');
store.summaryStore.deleteSummariesByConversation('conv-1');

// Cost 操作（API 调用成本追踪）
store.costStore.saveCostRecord({
  conversationId: 'conv-1',
  model: 'qwen-max',
  inputTokens: 1000,
  outputTokens: 500,
  cachedReadTokens: 200,
  totalCostUsd: 0.005,
});
```

### 自定义数据存储

#### 完整替换

实现 `DataStore` 接口：

```typescript
import { setGlobalDataStore, type DataStore } from '@thething/core';
import type {
  ConversationStore,
  MessageStore,
  SummaryStore,
  CostStore,
} from '@thething/core';

class PostgresConversationStore implements ConversationStore {
  createConversation(id: string, title?: string): Conversation {
    // PostgreSQL 实现
  }
  getConversation(id: string): Conversation | null {
    // ...
  }
  // ... 其他方法
}

class PostgresDataStore implements DataStore {
  conversationStore = new PostgresConversationStore();
  messageStore = new PostgresMessageStore();
  summaryStore = new PostgresSummaryStore();
  costStore = new PostgresCostStore();

  close(): void {
    // 关闭连接
  }

  isConnected(): boolean {
    return true;
  }
}

// 设置自定义存储（必须在任何数据操作之前调用）
setGlobalDataStore(new PostgresDataStore({
  host: 'localhost',
  port: 5432,
  database: 'thething',
}));
```

#### 部分替换（混合模式）

保留 SQLite 作为基础存储，只替换特定部分：

```typescript
import {
  createSQLiteDataStore,
  setGlobalDataStore,
} from '@thething/core';

// 创建 SQLite 基础存储
const sqlite = createSQLiteDataStore({ dataDir: './data' });

// 部分替换：成本存储使用 Redis，其他保持 SQLite
setGlobalDataStore({
  ...sqlite,
  costStore: new RedisCostStore(),
});
```

### 接口定义

```typescript
interface ConversationStore {
  createConversation(id: string, title?: string): Conversation;
  getConversation(id: string): Conversation | null;
  listConversations(): Conversation[];
  updateConversationTitle(id: string, title: string): void;
  deleteConversation(id: string): void;
}

interface MessageStore {
  getMessagesByConversation(conversationId: string): UIMessage[];
  saveMessages(conversationId: string, messages: UIMessage[]): void;
  getNextMessageOrder(conversationId: string): number;
}

interface SummaryStore {
  saveSummary(
    conversationId: string,
    summary: string,
    lastMessageOrder: number,
    preCompactTokenCount: number
  ): StoredSummary;
  getSummaryByConversation(conversationId: string): StoredSummary | null;
  deleteSummariesByConversation(conversationId: string): void;
}

interface CostStore {
  saveCostRecord(params): CostRecord;
  getCostByConversation(conversationId: string): CostRecord | null;
}

interface DataStore {
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  summaryStore: SummaryStore;
  costStore: CostStore;
  close(): void;
  isConnected(): boolean;
}
```

---

## 创建 Agent

`createChatAgent` 是创建 Agent 的统一入口，集成了工具加载、上下文构建、模型配置等功能。

### 配置项

```typescript
const { agent, sessionState, mcpRegistry } = await createChatAgent({
  // 必填
  conversationId: 'conv-123',
  modelConfig: {
    apiKey: '...',
    baseURL: '...',
    modelName: 'qwen-max',
    includeUsage: true,      // 返回用量信息
    enableThinking: false,   // 启用思考模式
  },

  // 可选
  messages: [],              // 当前消息列表
  userId: 'user-1',          // 用户 ID（用于记忆）
  teamId: 'team-1',          // 团队 ID
  sessionOptions: {
    maxContextTokens: 128000,  // 最大上下文 Token
    compactThreshold: 25000,   // 压缩阈值
    maxBudgetUsd: 5.0,         // 最大预算（美元）
  },
  conversationMeta: {
    messageCount: 10,
    isNewConversation: false,
    conversationStartTime: Date.now(),
  },

  // 功能开关
  enableMcp: true,           // 启用 MCP 工具
  enableSkills: true,        // 启用 Skills
  enableMemory: true,        // 启用记忆召回
  enableConnector: true,     // 启用 Connector 工具

  // 流式写入器（用于子 Agent 流式输出）
  writerRef: { current: null },
});
```

### 返回值

```typescript
interface CreateAgentResult {
  agent: ToolLoopAgent;        // Agent 实例（可直接用于 ai 库）
  sessionState: SessionState;  // 会话状态（包含成本追踪等）
  mcpRegistry?: McpRegistry;   // MCP Registry（用于断开连接）
  tools: Record<string, Tool>; // 已加载的工具
  instructions: string;        // 构建的指令
}
```

### 使用 Agent

```typescript
import { createAgentUIStream } from 'ai';

// 创建流式处理
const stream = await createAgentUIStream({
  agent,
  uiMessages: messages,
  abortSignal: abortController.signal,
  sendReasoning: true,
  onFinish: async ({ messages }) => {
    // 保存消息
    getGlobalDataStore().messageStore.saveMessages(conversationId, messages);
    // 持久化成本
    await sessionState.costTracker.persistToDB();
    // 断开 MCP
    if (mcpRegistry) await mcpRegistry.disconnectAll();
  },
});

// 处理流
for await (const chunk of stream) {
  if (chunk.type === 'text-delta') {
    process.stdout.write(chunk.delta);
  } else if (chunk.type === 'reasoning-delta') {
    // 处理思考内容
  }
}
```

---

## 消息压缩

当对话历史过长时，系统会自动压缩消息以节省 Token。

### 压缩策略

| 策略 | 说明 | LLM 调用 |
|------|------|----------|
| Session Memory Compact | 使用已存储的摘要 | 无 |
| Micro Compact | 移除冗余内容 | 无 |
| PTL Degradation | 紧急截断 | 无 |
| LLM Compact | 生成新摘要 | 有（后台） |

### 手动触发

```typescript
import { compactMessagesIfNeeded, estimateMessagesTokens } from '@thething/core';

const { messages: compacted, executed, tokensFreed } = await compactMessagesIfNeeded(
  messages,
  conversationId,
);

console.log(`Freed ${tokensFreed} tokens, executed: ${executed}`);
```

### 自定义压缩指令

```typescript
import { compactMessagesWithCustomInstructions } from '@thething/core';

const result = await compactMessagesWithCustomInstructions(
  messages,
  conversationId,
  '请重点保留技术讨论内容',
);
```

### 后台压缩

```typescript
import { runCompactInBackground } from '@thething/core';

// 不阻塞主流程，后台生成摘要
runCompactInBackground(messages, conversationId);
```

---

## 记忆系统

记忆系统使用**纯文件存储**，不依赖数据库。所有记忆以 Markdown 文件形式存储在 `.thething/memory/` 目录下。

### 存储结构

```
.thething/memory/
├── users/{userId}/memory/
│   ├── user_偏好.md        # 用户记忆文件
│   ├── feedback_纠正.md    # 反馈记忆文件
│   ├── project_决策.md     # 项目记忆文件
│   ├── MEMORY.md           # 入口索引文件
│   └── usage.json          # 使用追踪（可选）
└── teams/{teamId}/memory/
    └── ...
```

### 记忆类型

| 类型 | 说明 | 文件前缀 |
|------|------|----------|
| `user` | 用户偏好、技术背景、角色信息 | `user_` |
| `feedback` | 用户对 AI 行为的反馈 | `feedback_` |
| `project` | 项目约束、决策、流程 | `project_` |
| `reference` | 外部工具、服务、流程 | `reference_` |

### 记忆文件格式

每个记忆文件使用 Markdown + YAML frontmatter 格式：

```markdown
---
name: 代码风格偏好
description: 用户偏好简洁的代码风格
type: user
created: 2026-04-20
---

用户偏好简洁、清晰的代码风格。不喜欢过于复杂的抽象，
倾向于使用直观的命名和简单的实现方式。
```

### 入口索引 (MEMORY.md)

`MEMORY.md` 是记忆系统的入口点，按类型分组索引所有记忆：

```markdown
# MEMORY.md - 记忆入口索引

## 用户记忆 (user)

- [代码风格偏好](user_代码风格偏好.md) — 用户偏好简洁的代码风格
- [技术背景](user_技术背景.md) — 熟悉 TypeScript 和 React

## 反馈记忆 (feedback)

- [纠正日期格式](feedback_纠正日期格式.md) — AI 日期格式错误，已纠正

## 项目记忆 (project)

## 参考记忆 (reference)
```

### 自动提取

```typescript
import { extractMemoriesInBackground } from '@thething/core';

// 后台提取记忆（不阻塞主流程）
extractMemoriesInBackground(messages, userId, conversationId);
```

### 查找相关记忆

```typescript
import {
  findRelevantMemories,
  buildMemorySection,
  getUserMemoryDir,
} from '@thething/core';

const userMemDir = getUserMemoryDir(userId);
const memories = await findRelevantMemories(query, userMemDir, {
  maxResults: 5,
});

const memoryContent = await buildMemorySection(memories, userMemDir);
```

### 使用追踪

记忆的召回次数和最后召回时间记录在 `usage.json` 文件中：

```typescript
import { recordMemoryRecall, getMemoryUsage } from '@thething/core';

// 记录召回事件
await recordMemoryRecall(userMemDir, 'user_偏好.md', conversationId);

// 获取使用统计
const usage = await getMemoryUsage(userMemDir, 'user_偏好.md');
console.log(usage); // { recallCount: 5, lastRecalledAt: '2026-04-20T10:00:00Z' }
```

### 人类可编辑

记忆文件是纯 Markdown 文件，用户可以直接编辑：

- 添加新记忆：创建新的 `.md` 文件
- 修改记忆：直接编辑文件内容
- 删除记忆：删除对应文件

编辑后，系统会自动扫描并更新 `MEMORY.md` 索引。

---

## Skills 系统

Skills 是可动态激活的技能模块，用于扩展 Agent 能力。

### Skill 文件结构

```markdown
---
name: code-review
description: 代码审查技能
tools:
  - read_file
  - search_files
model: qwen-max  # 可选模型覆盖
---

## 激活条件
当用户请求代码审查时激活。

## 行为指南
...
```

### Skill 自动激活

`createChatAgent` 会根据消息内容自动激活匹配的 Skills：

```typescript
const { agent } = await createChatAgent({
  conversationId,
  messages,
  enableSkills: true,  // 启用 Skills
  modelConfig,
});
```

---

## MCP 集成

支持 Model Context Protocol (MCP) 工具集成。

### 配置 MCP

在 `.data/mcp-config.json` 中配置：

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "..."
      }
    }
  }
}
```

### 使用 MCP

```typescript
import { createMcpRegistry } from '@thething/core';

const registry = await createMcpRegistry();
await registry.connectAll();

// 获取工具
const tools = registry.getAllTools();

// 断开连接
await registry.disconnectAll();
```

---

## Connector Gateway

Connector Gateway 用于集成外部系统（飞书、微信、数据库等）。

### 配置 Connector

```typescript
import { initConnectorGateway } from '@thething/core';

await initConnectorGateway({
  enableInbound: true,
  connectors: [
    {
      type: 'feishu',
      appId: '...',
      appSecret: '...',
    },
  ],
});
```

### SQL Connector

```typescript
import { ConnectorRegistry } from '@thething/core';

const registry = new ConnectorRegistry({
  getDbPath: async (connectionId) => `/path/to/${connectionId}.db`,
});

// 注册数据库连接
registry.registerConfig({
  type: 'sqlite',
  connection_id: 'analytics',
  path: '/data/analytics.db',
});

// 执行查询
const result = await registry.query('analytics', 'SELECT * FROM users LIMIT 10');
```

---

## 子 Agent 系统

支持创建专用的子 Agent 用于特定任务。

### 预置子 Agent

| Agent | 用途 |
|-------|------|
| `code-agent` | 代码编写、修改 |
| `explore-agent` | 代码库探索 |
| `analysis-agent` | 数据分析 |
| `research-agent` | 信息检索 |
| `writing-agent` | 文档写作 |
| `general-agent` | 通用任务 |

---

## 会话状态

`SessionState` 管理单次对话的状态。

### 成本追踪

```typescript
const summary = sessionState.costTracker.getSummary();
console.log({
  totalCostUsd: summary.totalCostUsd,
  inputTokens: summary.inputTokens,
  outputTokens: summary.outputTokens,
  isOverBudget: summary.isOverBudget,
  remainingBudget: summary.remainingBudget,
});

// 持久化成本
await sessionState.costTracker.persistToDB();
```

---

## 模型配置

### 创建模型实例

```typescript
import { createLanguageModel, createModelProvider } from '@thething/core';

// 直接创建
const model = createLanguageModel({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  modelName: 'qwen-max',
  includeUsage: true,
});

// 创建 Provider（用于多次创建）
const provider = createModelProvider({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

const model1 = provider('qwen-max');
const model2 = provider('qwen-plus');
```

### 生成对话标题

```typescript
import { generateConversationTitle } from '@thething/core';

const title = await generateConversationTitle(messages, model);
store.conversationStore.updateConversationTitle(conversationId, title);
```

---

## 初始化

```typescript
import { initAll, configureDataStore } from '@thething/core';

// 方式1：完整初始化
await initAll({
  dataDir: './data',
});

// 方式2：仅配置数据存储（用于自定义 DataStore 场景）
configureDataStore({ dataDir: './data' });
```

---

## 依赖

- `ai` - AI SDK
- `better-sqlite3` - SQLite 数据库
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - 类型验证
- `nanoid` - ID 生成