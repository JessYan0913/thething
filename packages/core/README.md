# @the-thing/core

TheThing Agent Core — 一个模块化的 AI Agent 框架核心，提供数据存储、Agent 创建、消息压缩、记忆管理、MCP 集成等功能。

## 目录

- [快速开始](#快速开始)
- [API 设计原则](#api-设计原则)
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
- [分层 API](#分层-api)

## 快速开始

### 安装

```bash
pnpm add @the-thing/core
```

### 基本使用（三步流程）

新的 API 采用显式依赖传递，每一步的输入输出关系一目了然：

```typescript
import { bootstrap, createContext, createAgent } from '@the-thing/core';
import type { UIMessage } from 'ai';

// Step 1: 初始化基础设施，返回 CoreRuntime
const runtime = await bootstrap({
  dataDir: './data',  // 数据存储目录
  cwd: process.cwd(), // 项目工作目录（可选）
});

// Step 2: 加载配置，创建不可变的 AppContext
const context = await createContext({
  runtime,
  cwd: process.cwd(),
});

// Step 3: 创建 Agent，消费 AppContext
const { agent, sessionState, mcpRegistry } = await createAgent({
  context,
  conversationId: 'conv-123',
  messages: [] as UIMessage[],
  model: {
    apiKey: process.env.DASHSCOPE_API_KEY!,
    baseURL: process.env.DASHSCOPE_BASE_URL!,
    modelName: 'qwen-max',
  },
});

// 使用 Agent（配合 ai 库的 createAgentUIStream）
import { createAgentUIStream } from 'ai';

const stream = await createAgentUIStream({
  agent,
  uiMessages: messages,
  abortSignal: abortController.signal,
  onFinish: async ({ messages }) => {
    // 保存消息
    runtime.dataStore.messageStore.saveMessages('conv-123', messages);
    // 持久化成本
    await sessionState.costTracker.persistToDB();
    // 断开 MCP
    if (mcpRegistry) await mcpRegistry.disconnectAll();
  },
});

// 清理资源
await runtime.dispose();
```

---

## API 设计原则

### 显式依赖

所有依赖通过参数显式传递，避免隐式全局状态：

```typescript
// ❌ 旧方式（隐式依赖全局状态）
await initAll({ dataDir: './data' });  // 已移除
const store = getGlobalDataStore();     // 内部状态

// ✅ 新方式（显式依赖）
const runtime = await bootstrap({ dataDir: './data' });
const context = await createContext({ runtime, cwd });
const { agent } = await createAgent({ context, ... });
```

### 纯函数优先

路径计算函数分为两类：

```typescript
// 纯函数（接受参数，不读取环境）
import { computeUserConfigDir, computeProjectConfigDir } from '@the-thing/core';

const userDir = computeUserConfigDir(homeDir, 'skills');
const projectDir = computeProjectConfigDir(cwd, 'skills');

// 便捷函数（读取当前环境，向后兼容）
import { getUserConfigDir, getProjectConfigDir } from '@the-thing/core';

const userDir = getUserConfigDir('skills');
const projectDir = getProjectConfigDir(cwd, 'skills');
```

---

## 数据存储

`DataStore` 是数据存储的抽象层，默认提供 SQLite 实现，支持开发者自定义实现（如 PostgreSQL、MongoDB 等）。

**注意：记忆系统使用纯文件存储（`.thething/memory/`），不在 DataStore 中。**

### 通过 CoreRuntime 访问

```typescript
const runtime = await bootstrap({ dataDir: './data' });
const store = runtime.dataStore;

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

实现 `DataStore` 接口并传递给 `bootstrap`：

```typescript
import { bootstrap, type DataStore } from '@the-thing/core';

class PostgresDataStore implements DataStore {
  conversationStore = new PostgresConversationStore();
  messageStore = new PostgresMessageStore();
  summaryStore = new PostgresSummaryStore();
  costStore = new PostgresCostStore();

  close(): void { /* 关闭连接 */ }
  isConnected(): boolean { return true; }
}

const runtime = await bootstrap({
  dataDir: './data',
  dataStore: new PostgresDataStore(), // 自定义实例
});
```

---

## 创建 Agent

`createAgent` 是新 API 的 Agent 创建入口，必须传入 `context`（来自 `createContext`）。

### 配置项

```typescript
const { agent, sessionState, mcpRegistry } = await createAgent({
  // 必填
  context,                    // AppContext（来自 createContext）
  conversationId: 'conv-123',
  model: {
    apiKey: '...',
    baseURL: '...',
    modelName: 'qwen-max',
    includeUsage: true,       // 返回用量信息
  },

  // 可选
  messages: [],               // 当前消息列表
  userId: 'user-1',           // 用户 ID（用于记忆）
  teamId: 'team-1',           // 团队 ID
  session: {
    maxContextTokens: 128000, // 最大上下文 Token
    compactThreshold: 25000,  // 压缩阈值
    maxBudgetUsd: 5.0,        // 最大预算（美元）
  },
  conversationMeta: {
    messageCount: 10,
    isNewConversation: false,
    conversationStartTime: Date.now(),
  },

  // 功能开关
  modules: {
    mcps: true,               // 启用 MCP 工具
    skills: true,             // 启用 Skills
    memory: true,             // 启用记忆召回
    connectors: true,         // 启用 Connector 工具
  },

  // 流式写入器（用于子 Agent 流式输出）
  writerRef: { current: null },
});
```

### 返回值

```typescript
interface CreateAgentResult {
  agent: ToolLoopAgent;         // Agent 实例（可直接用于 ai 库）
  sessionState: SessionState;   // 会话状态（包含成本追踪等）
  mcpRegistry?: McpRegistry;    // MCP Registry（用于断开连接）
  tools: Record<string, Tool>;  // 已加载的工具
  instructions: string;         // 构建的指令
  adjustedMessages?: UIMessage[]; // 预算检查后的调整消息
  model: LanguageModelV3;       // 模型实例
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
import { compactMessagesIfNeeded, estimateMessagesTokens } from '@the-thing/core';

const { messages: compacted, executed, tokensFreed } = await compactMessagesIfNeeded(
  messages,
  conversationId,
  runtime.dataStore,  // 可选，显式传递
);

console.log(`Freed ${tokensFreed} tokens, executed: ${executed}`);
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

### 自动提取

```typescript
import { extractMemoriesInBackground, createLanguageModel } from '@the-thing/core';

// 创建模型实例
const model = createLanguageModel({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.DASHSCOPE_BASE_URL,
  modelName: 'qwen-max',
});

// 后台提取记忆
extractMemoriesInBackground(messages, userId, conversationId, model);
```

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

`createAgent` 会根据消息内容自动激活匹配的 Skills：

```typescript
const { agent } = await createAgent({
  context,
  conversationId,
  messages,
  modules: { skills: true },
  model,
});
```

---

## MCP 集成

支持 Model Context Protocol (MCP) 工具集成。

### 配置 MCP

在 `.thething/mcps/` 目录下配置：

```json
{
  "name": "filesystem",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
  },
  "enabled": true
}
```

### 使用 MCP

```typescript
import { createMcpRegistry } from '@the-thing/core';

const registry = await createMcpRegistry(mcpConfigs);
await registry.connectAll();

// 获取工具
const tools = registry.getAllTools();

// 断开连接
await registry.disconnectAll();
```

---

## Connector Gateway

Connector Gateway 用于集成外部系统（飞书、微信、数据库等）。

### 通过 CoreRuntime 访问

```typescript
const runtime = await bootstrap({ dataDir: './data' });
const registry = runtime.connectorRegistry;
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

// 持久化成本（自动使用传递的 dataStore）
await sessionState.costTracker.persistToDB();
```

---

## 模型配置

### 创建模型实例

```typescript
import { createLanguageModel, createModelProvider } from '@the-thing/core';

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
import { generateConversationTitle } from '@the-thing/core';

const title = await generateConversationTitle(messages, model);
runtime.dataStore.conversationStore.updateConversationTitle(conversationId, title);
```

---

## 分层 API

Core 包提供三层 API，按需选择：

### 高层 API（推荐）

直接 import，三步流程：

```typescript
import { bootstrap, createContext, createAgent } from '@the-thing/core';

const runtime = await bootstrap({ dataDir: './data' });
const context = await createContext({ runtime, cwd });
const { agent } = await createAgent({ context, conversationId, messages, model });
```

### 中层 API

`import from '@the-thing/core/api'`，单独加载模块：

```typescript
import { loadSkills, loadMcpServers, loadAll } from '@the-thing/core/api';

const skills = await loadSkills({ cwd: '/path/to/project' });
const mcps = await loadMcpServers({ cwd: '/path/to/project' });
const all = await loadAll({ cwd: '/path/to/project' });
```

### 底层 API

`import from '@the-thing/core/foundation'`，基础设施：

```typescript
import { parseFrontmatterFile } from '@the-thing/core/foundation/parser';
import { resolveProjectDir, resolveHomeDir } from '@the-thing/core/foundation/paths';
import { createSQLiteDataStore } from '@the-thing/core/foundation/datastore';
```

---

## CoreRuntime 接口

`bootstrap()` 返回的运行时句柄：

```typescript
interface CoreRuntime {
  readonly dataDir: string;
  readonly dataStore: DataStore;
  readonly connectorRegistry: ConnectorRegistry;
  readonly cwd: string;

  // 销毁所有资源
  dispose(): Promise<void>;
}
```

---

## AppContext 接口

`createContext()` 返回的不可变配置快照：

```typescript
interface AppContext {
  readonly runtime: CoreRuntime;
  readonly cwd: string;
  readonly dataDir: string;
  readonly skills: readonly Skill[];
  readonly agents: readonly AgentDefinition[];
  readonly mcps: readonly McpServerConfig[];
  readonly connectors: readonly ConnectorFrontmatter[];
  readonly permissions: readonly PermissionRule[];
  readonly memory: readonly MemoryEntry[];
  readonly loadedFrom: LoadSourceInfo;

  // 重新加载配置
  reload(options?: ReloadOptions): Promise<AppContext>;
}
```

---

## 依赖

- `ai` - AI SDK
- `better-sqlite3` - SQLite 数据库
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - 类型验证
- `nanoid` - ID 生成