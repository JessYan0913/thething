# @the-thing/core

TheThing Agent Core — 一个模块化的 AI Agent 框架核心，提供数据存储、Agent 创建、消息压缩、记忆管理、MCP 集成等功能。

## 目录

- [快速开始](#快速开始)
- [配置系统](#配置系统)
- [API 设计原则](#api-设计原则)
- [数据存储](#数据存储)
- [创建 Agent](#创建-agent)
- [消息压缩](#消息压缩)
- [记忆系统](#记忆系统)
- [Skills 系统](#skills-系统)
- [MCP 集成](#mcp-集成)
- [Connector Gateway](#connector-gateway)
- [会话状态](#会话状态)
- [模型配置](#模型配置)
- [分层 API](#分层-api)

## 快速开始

### 安装

```bash
pnpm add @the-thing/core
```

### 基本使用（三步流程）

```typescript
import { bootstrap, createContext, createAgent } from '@the-thing/core';
import type { UIMessage } from 'ai';

// Step 1: 初始化基础设施，返回 CoreRuntime
const runtime = await bootstrap({
  layout: {
    resourceRoot: process.cwd(),  // 项目根目录
    dataDir: './data',            // 数据存储目录（可选）
  },
  behavior: {                     // 可选，全部有默认值
    maxBudgetUsdPerSession: 5.0,
    maxStepsPerSession: 50,
  },
});

// Step 2: 加载配置，创建不可变的 AppContext
const context = await createContext({ runtime });

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
    runtime.dataStore.messageStore.saveMessages('conv-123', messages);
    await sessionState.costTracker.persistToDB();
    if (mcpRegistry) await mcpRegistry.disconnectAll();
  },
});

// 清理资源
await runtime.dispose();
```

---

## 配置系统

配置分为两个独立的对象，分别对应不同的关注点：

### LayoutConfig — 文件系统布局

决定"文件放在哪里"，是部署决策：

```typescript
import { resolveLayout, type LayoutConfig, type ResolvedLayout } from '@the-thing/core';

const layout: LayoutConfig = {
  resourceRoot: process.cwd(),      // 必填：项目根目录
  configDirName: '.thething',       // 配置目录名（默认 '.thething'）
  dataDir: '/var/lib/app/data',     // 数据目录（可选，默认由 configDirName 派生）
  contextFileNames: ['THING.md'],   // 项目上下文文件名（默认 ['THING.md', 'CONTEXT.md']）
};

// 展开为 ResolvedLayout（所有路径已解析为绝对路径）
const resolved: ResolvedLayout = resolveLayout(layout);
console.log(resolved.dataDir);         // '/var/lib/app/data'
console.log(resolved.configDirName);   // '.thething'
console.log(resolved.resources.skills); // ['~/.thething/skills', '<cwd>/.thething/skills']
```

### BehaviorConfig — 运行时行为

决定"系统怎么运行"，是业务决策：

```typescript
import { buildBehaviorConfig, type BehaviorConfig, DEFAULT_MODEL_SPECS } from '@the-thing/core';

const behavior: BehaviorConfig = buildBehaviorConfig({
  maxStepsPerSession: 50,            // 最大步骤数（默认 50）
  maxBudgetUsdPerSession: 5.0,       // 最大预算 USD（默认 5.0）
  maxContextTokens: 128_000,         // 上下文限制（默认 128_000）
  compactionThreshold: 25_000,       // 压缩阈值（默认 25_000）
  maxDenialsPerTool: 3,              // 最大拒绝次数（默认 3）
  availableModels: DEFAULT_MODEL_SPECS,  // 可用模型列表
  modelAliases: {                    // 模型快捷名映射
    fast: 'qwen-turbo',
    smart: 'qwen-max',
    default: 'qwen-plus',
  },
  autoDowngradeCostThreshold: 80,    // 自动降级阈值（默认 80）
  modelPricing: {                    // 模型定价（可选）
    'gpt-4o': { inputPerMillion: 5, outputPerMillion: 15, cachedPerMillion: 2.5 },
  },
});
```

### 使用场景

**最简场景（全部默认值）**：
```typescript
const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd() }
});
```

**替换应用名**：
```typescript
const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd(), configDirName: '.myapp' }
});
// 结果：所有路径使用 .myapp，Agent 加载 MYAPP.md
```

**企业部署**：
```typescript
const runtime = await bootstrap({
  layout: {
    resourceRoot: process.cwd(),
    configDirName: '.myapp',
    dataDir: '/var/lib/myapp/data',  // 数据与代码分离
  },
  behavior: {
    maxBudgetUsdPerSession: 20.0,
    maxStepsPerSession: 100,
    availableModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
    ],
    modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
  },
});
```

**测试场景（完全可控）**：
```typescript
import tmp from 'tmp-promise';

const { path: tmpDir } = await tmp.dir({ unsafeCleanup: true });

const runtime = await bootstrap({
  layout: {
    resourceRoot: tmpDir,
    configDirName: '.test',
    dataDir: ':memory:',  // 内存数据库
  },
  behavior: {
    maxStepsPerSession: 3,       // 快速失败
    maxBudgetUsdPerSession: 0.01,
  },
});
```

---

## API 设计原则

### 显式依赖

所有依赖通过参数显式传递，避免隐式全局状态：

```typescript
// ❌ 旧方式（隐式依赖全局状态）
await initAll({ dataDir: './data' });  // 已移除
const store = getGlobalDataStore();     // 已移除

// ✅ 新方式（显式依赖）
const runtime = await bootstrap({ layout: { resourceRoot, dataDir } });
const store = runtime.dataStore;
const context = await createContext({ runtime });
const { agent } = await createAgent({ context, ... });
```

### 纯函数优先

路径计算函数分为两类：

```typescript
// 纯函数（接受参数，不读取环境）
import { computeUserConfigDir, computeProjectConfigDir } from '@the-thing/core';

const userDir = computeUserConfigDir(homeDir, 'skills', configDirName);
const projectDir = computeProjectConfigDir(cwd, 'skills', configDirName);

// 便捷函数（读取当前环境，向后兼容）
import { getUserConfigDir, getProjectConfigDir } from '@the-thing/core';

const userDir = getUserConfigDir('skills');
const projectDir = getProjectConfigDir(cwd, 'skills');
```

---

## 数据存储

`DataStore` 是数据存储的抽象层，默认提供 SQLite 实现。

**注意：记忆系统使用纯文件存储（`.thething/memory/`），不在 DataStore 中。**

### 通过 CoreRuntime 访问

```typescript
const runtime = await bootstrap({ layout: { resourceRoot: process.cwd() } });
const store = runtime.dataStore;

// Conversation 操作
store.conversationStore.createConversation('conv-1', 'Title');
store.conversationStore.getConversation('conv-1');
store.conversationStore.listConversations();

// Message 操作
store.messageStore.getMessagesByConversation('conv-1');
store.messageStore.saveMessages('conv-1', messages);

// Summary 操作（用于消息压缩）
store.summaryStore.saveSummary('conv-1', 'Summary text...', 10, 5000);

// Cost 操作（API 调用成本追踪）
store.costStore.saveCostRecord({
  conversationId: 'conv-1',
  model: 'qwen-max',
  inputTokens: 1000,
  outputTokens: 500,
  totalCostUsd: 0.005,
});
```

---

## 创建 Agent

`createAgent` 是 Agent 创建入口，必须传入 `context`（来自 `createContext`）。

### 配置项

```typescript
const { agent, sessionState, mcpRegistry } = await createAgent({
  // 必填
  context,
  conversationId: 'conv-123',
  model: {
    apiKey: '...',
    baseURL: '...',
    modelName: 'qwen-max',
  },

  // 可选（可覆盖 behavior 默认值）
  session: {
    maxContextTokens: 128000,  // 覆盖 behavior.maxContextTokens
    maxBudgetUsd: 5.0,         // 覆盖 behavior.maxBudgetUsdPerSession
    compactThreshold: 25000,
  },

  // 功能开关
  modules: {
    mcps: true,
    skills: true,
    memory: true,
    connectors: true,
  },
});
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
import { compactMessagesIfNeeded } from '@the-thing/core';

const { messages: compacted, tokensFreed } = await compactMessagesIfNeeded(
  messages,
  conversationId,
  runtime.dataStore,
);
```

---

## 记忆系统

记忆系统使用**纯文件存储**，所有记忆以 Markdown 文件形式存储在 `<configDirName>/memory/` 目录下。

### 存储结构

```
.thething/memory/
├── users/{userId}/memory/
│   ├── user_偏好.md
│   ├── MEMORY.md      # 入口索引文件
│   └── usage.json     # 使用追踪（可选）
└── teams/{teamId}/memory/
    └── ...
```

### 自动提取

```typescript
import { extractMemoriesInBackground, createLanguageModel } from '@the-thing/core';

const model = createLanguageModel({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.DASHSCOPE_BASE_URL,
  modelName: 'qwen-max',
});

extractMemoriesInBackground(messages, userId, conversationId, model);
```

---

## Skills 系统

Skills 是可动态激活的技能模块。

### Skill 文件结构

```markdown
---
name: code-review
description: 代码审查技能
tools:
  - read_file
  - search_files
model: qwen-max
---

## 激活条件
当用户请求代码审查时激活。

## 行为指南
...
```

文件位置：`<configDirName>/skills/{skillName}/SKILL.md`

---

## MCP 集成

支持 Model Context Protocol (MCP) 工具集成。

### 配置 MCP

在 `<configDirName>/mcps/` 目录下配置：

```json
{
  "name": "filesystem",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
  },
  "enabled": true
}
```

---

## Connector Gateway

Connector Gateway 用于集成外部系统（飞书、微信、数据库等）。

### 通过 CoreRuntime 访问

```typescript
const runtime = await bootstrap({ layout: { resourceRoot } });
const registry = runtime.connectorRegistry;
```

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
});

await sessionState.costTracker.persistToDB();
```

---

## 模型配置

### 创建模型实例

```typescript
import { createLanguageModel, createModelProvider } from '@the-thing/core';

const model = createLanguageModel({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  modelName: 'qwen-max',
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

const runtime = await bootstrap({ layout: { resourceRoot: process.cwd() } });
const context = await createContext({ runtime });
const { agent } = await createAgent({ context, conversationId, messages, model });
```

### 中层 API

`import from '@the-thing/core/api'`，单独加载模块：

```typescript
import { loadSkills, loadMcpServers, loadAll } from '@the-thing/core/api';

const skills = await loadSkills({ cwd: '/path', configDirName: '.thething' });
const all = await loadAll({ cwd: '/path', configDirName: '.thething' });
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
  readonly layout: ResolvedLayout;      // 展开后的布局
  readonly behavior: BehaviorConfig;    // 行为配置
  readonly dataStore: DataStore;
  readonly connectorRegistry: ConnectorRegistry;

  dispose(): Promise<void>;
}
```

---

## AppContext 接口

`createContext()` 返回的不可变配置快照：

```typescript
interface AppContext {
  readonly runtime: CoreRuntime;
  readonly layout: ResolvedLayout;      // 从 runtime.layout 取值
  readonly behavior: BehaviorConfig;    // 从 runtime.behavior 取值
  readonly cwd: string;                 // 别名：layout.resourceRoot
  readonly dataDir: string;             // 别名：layout.dataDir

  readonly skills: readonly Skill[];
  readonly agents: readonly AgentDefinition[];
  readonly mcps: readonly McpServerConfig[];
  readonly connectors: readonly ConnectorFrontmatter[];
  readonly permissions: readonly PermissionRule[];
  readonly memory: readonly MemoryEntry[];

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