# Agent Workbench 设计方案

## Context

Agent 配置涉及大量字段（agentType、tools、model、permissionMode、instructions 等），手写 `.md` 文件门槛高，调优需要反复修改后到主聊天中验证。需要一个可视化配置 + AI 辅助 + 即时调试的工作台。

## 需求确认

1. **表单可视化配置**：所有 AgentDefinition 字段以表单形式呈现
2. **AI 辅助填写**：右侧对话框随时可让 AI 修改表单字段（如"帮我把 tools 改成只读工具"）
3. **即时调试**：同页面 Tab 切换到调试页，以当前配置的 Agent 身份运行对话
4. **使用者**：开发者个人

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Header: 返回 | Agent 工作台 | agent-name | [配置] [调试] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [配置 Tab]                                              │
│  ┌────────────────────────┬────────────────────┐        │
│  │  Agent 配置表单          │  AI 辅助对话        │        │
│  │                        │                    │        │
│  │  基本信息                │  Chat.tsx          │        │
│  │  执行配置                │  apiEndpoint=      │        │
│  │  上下文配置              │  /api/agent-       │        │
│  │  工具与技能              │  workbench/chat    │        │
│  │  指令（CodeMirror）      │                    │        │
│  │                        │  用户: "帮我把      │        │
│  │  flex: 1               │  tools 改成只读"    │        │
│  │                        │  AI: 输出更新后的    │        │
│  │                        │  JSON → 自动应用    │        │
│  │                        │  到左侧表单         │        │
│  │                        │  w-96              │        │
│  └────────────────────────┴────────────────────┘        │
│                                                         │
│  [调试 Tab]                                              │
│  ┌──────────────────────────────────────────────┐       │
│  │  Chat.tsx (全宽)                               │       │
│  │  apiEndpoint="/api/agent-workbench/debug"     │       │
│  │  以当前 Agent 配置的 instructions/model 运行    │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

## AI 辅助表单的数据流

```
用户在右侧对话: "帮我把 tools 改成只读工具，model 改成 fast"
     │
     ▼
POST /api/agent-workbench/chat
  body: { message, conversationId, formState: { 当前表单数据 } }
     │
     ▼
Server: Agent 收到当前表单状态 + 用户请求
  → 分析需求，输出更新后的完整配置（<agent-config> JSON 标签包裹）
  → 同时用自然语言解释改了什么
     │
     ▼
Client: onTurnFinish 回调
  → 扫描 assistant 最新消息中的 <agent-config>{...}</agent-config>
  → 解析 JSON，自动更新表单字段
```

## 实施步骤

### Step 1: 新增 UI 组件

需要创建缺失的 shadcn 组件：

**新文件**: `packages/web/src/components/ui/tabs.tsx`
- 使用 Radix UI `@radix-ui/react-tabs` 实现
- 包含 Tabs, TabsList, TabsTrigger, TabsContent

**新文件**: `packages/web/src/components/ui/label.tsx`
- 使用 Radix UI `@radix-ui/react-label` 实现

**新文件**: `packages/web/src/components/ui/switch.tsx`
- 使用 Radix UI `@radix-ui/react-switch` 实现
- 用于 boolean 字段（background, includeParentContext, summarizeOutput）

### Step 2: Agent CRUD API

**修改文件**: `packages/server/src/routes/agents.ts`

新增端点：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/:agentType` | 获取单个 agent 完整信息（含 instructions） |
| POST | `/` | 创建 agent（接收 AgentFormData，序列化为 .md 文件） |
| PUT | `/:agentType` | 更新 agent |
| DELETE | `/:agentType` | 删除 agent .md 文件 |

关键复用：
- `serializeAgentMarkdown()` from `@the-thing/core` → 将表单数据序列化为 `.md`
- `reloadServerContext()` → 每次写入后热重载

写入目录：`{runtime.layout.resources.agents}` 的最后一项（同 skills 的模式）

### Step 3: Agent Workbench Server 路由

**新文件**: `packages/server/src/routes/agent-workbench.ts`

#### `POST /chat` — AI 辅助配置对话

1. 接收 `{ message, conversationId, formState }` 
2. 首条消息注入前言，包含：
   - AgentDefinition 表单 schema 说明（所有字段含义和取值范围）
   - 当前表单状态的 JSON
   - 指令：用户要求修改时，输出完整配置 JSON 包裹在 `<agent-config>...</agent-config>` 中
3. 后续消息：将最新 formState 作为上下文注入
4. 调用 `createAgent()` + 流式返回

#### `POST /debug` — Agent 调试对话

1. 接收 `{ message, conversationId, agentConfig }` （agentConfig 是当前表单的完整配置）
2. 将 `agentConfig.instructions` 注入为首条消息的 system-reminder 前言
3. 调用 `createAgent()`，使用 agentConfig 指定的 model
4. 在前言中告知 agent 只使用 agentConfig.tools 中的工具（软约束）
5. 流式返回
6. 每轮结束后 `reloadServerContext()`

#### `GET /chat`, `PATCH /chat`, `GET /debug`, `PATCH /debug`
消息历史的读取和保存（同 skill-workbench 模式）

**挂载**: `packages/server/src/index.ts` 添加 `app.route('/api/agent-workbench', agentWorkbenchRoutes)`

### Step 4: 扩展 Chat.tsx

**修改文件**: `packages/web/src/components/Chat.tsx`

新增 props：

```typescript
export interface ChatProps {
  conversationId: string;
  onTitleUpdated?: () => void;
  apiEndpoint?: string;
  onTurnFinish?: () => void;
  extraBody?: Record<string, unknown>;  // 新增：附加到每次请求的额外 body
}
```

`extraBody` 用于 config chat 传 `formState`，debug chat 传 `agentConfig`。在 `createChatTransport` 的 `prepareSendMessagesRequest` 中合并到 body。

### Step 5: AgentWorkbench 页面

**新文件**: `packages/web/src/routes/AgentWorkbench.tsx`

核心结构：

```typescript
interface AgentFormData {
  agentType: string;
  displayName: string;
  description: string;
  model: string;
  effort: string;
  maxTurns: number;
  permissionMode: string | null;
  background: boolean;
  isolation: string | null;
  memory: string | null;
  tools: string[];
  disallowedTools: string[];
  skills: string[];
  includeParentContext: boolean;
  maxParentMessages: number | null;
  summarizeOutput: boolean;
  initialPrompt: string;
  instructions: string;
  metadata: Record<string, unknown>;
}
```

**配置 Tab**：
- 左侧表单分组：
  - **基本信息**：agentType（text）、displayName（text）、description（textarea）
  - **执行配置**：model（select）、effort（select）、maxTurns（number）、background（switch）、permissionMode（select）、isolation（select）
  - **上下文**：includeParentContext（switch）、maxParentMessages（number，条件显示）、summarizeOutput（switch）、memory（select）
  - **工具与技能**：tools（逗号分隔 textarea）、disallowedTools（逗号分隔 textarea）、skills（逗号分隔 textarea）
  - **指令**：instructions（CodeMirror markdown 编辑器，大区域）
  - **高级**：initialPrompt（textarea）
  - 底部：保存按钮（POST/PUT /api/agents）
- 右侧 AI 对话：
  - `<Chat apiEndpoint="/api/agent-workbench/chat" extraBody={{ formState }} />`
  - `onTurnFinish` 回调：扫描最新 assistant 消息中的 `<agent-config>` 标签，解析 JSON 并更新表单

**调试 Tab**：
- 全宽 Chat 组件
- `<Chat apiEndpoint="/api/agent-workbench/debug" extraBody={{ agentConfig: formData }} />`
- 切换回配置 Tab 修改后再切回调试，conversationId 重置（新对话）

**URL 策略**：
- 创建新 agent：`/agent-workbench`（表单空白）
- 编辑已有 agent：`/agent-workbench/:agentType`（加载已有配置）

### Step 6: 添加入口

**修改文件**: `packages/web/src/routes/AgentsSettings.tsx`
- 添加"创建代理"按钮 → `navigate('/agent-workbench')`
- 每个 AgentCard 添加"编辑"按钮 → `navigate('/agent-workbench/${agent.agentType}')`

### Step 7: 注册路由

**修改文件**: `packages/web/src/App.tsx`
```tsx
<Route path="/agent-workbench" element={<AgentWorkbench />} />
<Route path="/agent-workbench/:agentType" element={<AgentWorkbench />} />
```

**修改文件**: `packages/server/src/index.ts`
```typescript
app.route('/api/agent-workbench', agentWorkbenchRoutes)
```

## 关键文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/web/src/components/ui/tabs.tsx` |
| 新建 | `packages/web/src/components/ui/label.tsx` |
| 新建 | `packages/web/src/components/ui/switch.tsx` |
| 新建 | `packages/web/src/routes/AgentWorkbench.tsx` |
| 新建 | `packages/server/src/routes/agent-workbench.ts` |
| 修改 | `packages/server/src/routes/agents.ts` — 新增 CRUD 端点 |
| 修改 | `packages/web/src/components/Chat.tsx` — 新增 `extraBody` prop |
| 修改 | `packages/web/src/routes/AgentsSettings.tsx` — 添加入口按钮 |
| 修改 | `packages/web/src/App.tsx` — 注册路由 |
| 修改 | `packages/server/src/index.ts` — 挂载路由 |

## 复用清单

| 复用项 | 来源 |
|--------|------|
| `serializeAgentMarkdown()` | `@the-thing/core` 导出 |
| `reloadServerContext()` | `packages/server/src/runtime.ts` |
| `Chat` 组件 | `packages/web/src/components/Chat.tsx` |
| CodeMirror 编辑器模式 | `packages/web/src/routes/SkillsSettings.tsx` |
| `createAgent()` + 流式响应 | `packages/server/src/routes/chat.ts` 中的模式 |
| `DefaultChatTransport` | `ai` 包 |

## 验证方式

1. 启动 `pnpm dev:server` 和 `pnpm dev:web`
2. 访问 `/settings/agents`，点击"创建代理"
3. 在配置 Tab 右侧对话中说："帮我创建一个代码审查代理，只使用只读工具"
4. 验证 AI 输出配置 JSON 后表单自动填充
5. 手动微调 instructions 字段
6. 点击"保存"，确认 `.thething/agents/` 下生成了 `.md` 文件
7. 切换到调试 Tab，发送一条消息
8. 验证对话使用了配置的 instructions 和 model
9. 返回配置 Tab 修改 instructions，再切调试 Tab 验证变化
10. 回到 `/settings/agents`，确认新 agent 出现在列表中
