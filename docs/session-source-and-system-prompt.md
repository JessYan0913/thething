# 会话来源与系统提示词分析

> 日期：2026-07-10
> 问题：本地会话时 Agent 错误调用飞书工具

---

## 1. 问题背景

用户在本地 Web 界面询问"加载了哪些 MCP 工具"，Agent 的推理过程中出现了：

```
用户问我加载了哪些MCP工具。我需要查看环境信息中提供的MCP工具列表。

...（正确列出了 MCP 工具）

我需要把这些信息整理出来，用中文清晰地呈现给用户。
→ feishu send message  ← 幻觉！
```

Agent 试图调用一个不存在的 `feishu send message` 工具来"发送消息给用户"，而实际上应该直接输出文本。

---

## 2. 根因分析

### 2.1 问题链条

```
1. 飞书 Connector 配置存在（~/.thething/connectors/feishu.yaml）
2. Connector 工具（feishu_send_message）在所有会话中都被加载
3. 会话的 source 字段已存在（'user' 或 'connector'）
4. 但 chat/route.ts 没有把 source 传给 createAgent()
5. ConversationMeta 没有 sessionSource 字段
6. 系统提示没有告诉 Agent 会话来源
7. Agent 看到 feishu_send_message 工具存在 → 调用了它
```

### 2.2 核心原因

**Agent 不知道自己在什么类型的会话中**。系统提示中缺少会话来源信息，导致 Agent 在本地会话中也尝试使用飞书工具。

---

## 3. 修复方案

### 3.1 修改的文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/modules/system-prompt/types.ts` | `ConversationMeta` 加 `sessionSource` + `sessionSourceId` |
| `packages/core/src/modules/system-prompt/sections/session.ts` | 系统提示根据会话来源输出事实信息 |
| `packages/core/src/modules/agent/context/instructions.ts` | `BuildInstructionsOptions` 加 `sessionSource`/`sessionSourceId` |
| `packages/core/src/composition/app/types.ts` | `CreateAgentOptions.conversationMeta` 加字段 |
| `packages/core/src/composition/app/create.ts` | 透传 `sessionSource`/`sessionSourceId` |
| `packages/app/app/api/chat/route.ts` | 从会话读取 `source`/`sourceId`，传给 `createAgent` |
| `packages/core/src/composition/inbound/agent-handler.ts` | `createAgentInstance` 接收 `connectorId`，传给 `createAgent` |

### 3.2 系统提示效果

**本地会话**：
```
【会话指导】

会话来源：local
这是对话中的第 3 条消息。请基于之前的上下文继续对话。
```

**飞书会话**：
```
【会话指导】

会话来源：connector:feishu
这是对话中的第 1 条消息。请花些时间了解用户的需求。
```

**设计原则**：只陈述事实，不指导行为。Agent 应该自己判断该怎么做。

---

## 4. 系统提示词结构分析

### 4.1 完整 Sections 列表

#### 静态 Sections（几乎不变）

| Section | Priority | 内容 | 状态 |
|---------|----------|------|------|
| identity | 1 | 身份定义：Aura，智能助手 | ✅ 活跃 |
| capabilities | 2 | 能力范围：信息处理、创意写作、编程技术、数据分析 | ✅ 活跃 |
| rules | 3 | 行为规范：必须遵守 / 应该做到 / 避免行为 | ✅ 活跃 |

#### Session Sections（每会话变化）

| Section | Priority | 内容 | 状态 |
|---------|----------|------|------|
| language-rules | 4 | 语言规范：使用中文 | ✅ 活跃（默认值） |
| response-style | 15 | 回答风格：简洁/详细/平衡 | ❌ 死（无配置入口） |
| user-preferences | 20 | 用户偏好：语言、领域、风格 | ❌ 死（无配置入口） |
| project-context | 10 | 项目上下文：THING.md 等 | ❌ 死（无文件） |
| permissions | 35 | 权限规则：deny/ask/allow | ✅ 活跃 |
| skill-matching | 30 | 可用技能列表 | ✅ 活跃（10+ 技能） |
| mcp-tools | 31 | MCP 工具列表 | ✅ 活跃（3 个服务器） |
| wiki-guidelines | 45 | 知识库管理指南 | ✅ 活跃 |
| recalled-wiki | 46 | 已召回的知识库内容 | ⚠️ 条件（按需） |

#### Dynamic Sections（每条消息变化）

| Section | Priority | 内容 | 状态 |
|---------|----------|------|------|
| system-context | 51 | 环境信息：时间、工作目录 | ✅ 活跃 |
| session-guidance | 100 | 会话来源、消息计数 | ✅ 活跃（刚修复） |
| first-message-guidance | 99 | 新对话指导 | ⚠️ 条件（仅首条） |

#### 其他

| Section | Priority | 内容 | 状态 |
|---------|----------|------|------|
| custom-instructions | 200 | 自定义指令 | ✅ 可用 |
| .agents/system-prompt.md | - | Dot Agents 协议自定义提示 | ✅ 可用 |

### 4.2 死 Sections 详情

#### response-style（Priority: 15）

**代码位置**：`sections/user-preferences.ts`

**激活条件**：`options.userPreferences?.responseStyle` 有值

**实际情况**：`buildAgentInstructions` 调用时未传入 `userPreferences`，永远返回 null

**建议**：保留代码，等待 UI 配置入口实现

#### user-preferences（Priority: 20）

**代码位置**：`sections/user-preferences.ts`

**激活条件**：`options.userPreferences` 不为 null

**实际情况**：`buildAgentInstructions` 调用时未传入 `userPreferences`，永远返回 null

**建议**：保留代码，等待 UI 配置入口实现

#### project-context（Priority: 10）

**代码位置**：`sections/project-context.ts`

**激活条件**：`options.projectContext?.combinedContent` 有值（需要 THING.md 或 CONTEXT.md 文件）

**实际情况**：项目根目录没有这两个文件

**建议**：保留代码，用户可随时创建 THING.md 激活

---

## 5. 数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 UI                                  │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │  SourceFilter    │    │  ChatInput      │                    │
│  │  (筛选会话列表)  │    │  (发送消息)      │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           │                      ▼                              │
│           │              POST /api/chat                         │
│           │              { message, conversationId }            │
└───────────┼──────────────────────┼─────────────────────────────┘
            │                      │
            │                      ▼
            │         ┌────────────────────────┐
            │         │  chat/route.ts          │
            │         │  1. 读取 conversation   │
            │         │  2. 获取 source/sourceId│
            │         │  3. 传给 createAgent    │
            │         └───────────┬────────────┘
            │                     │
            │                     ▼
            │         ┌────────────────────────┐
            │         │  createAgent()          │
            │         │  conversationMeta: {    │
            │         │    sessionSource,       │
            │         │    sessionSourceId      │
            │         │  }                      │
            │         └───────────┬────────────┘
            │                     │
            │                     ▼
            │         ┌────────────────────────┐
            │         │  buildAgentInstructions │
            │         │  → buildSystemPrompt    │
            │         └───────────┬────────────┘
            │                     │
            │                     ▼
            │         ┌────────────────────────┐
            │         │  session-guidance       │
            │         │  "会话来源：local"       │
            │         │  或 "connector:feishu"  │
            │         └────────────────────────┘
            │
            │  飞书消息路径：
            │  ┌────────────────────────┐
            └──│  Feishu WebSocket       │
               │  → agent-handler.ts     │
               │  → createAgentInstance  │
               │  → event.connectorId    │
               └────────────────────────┘
```

---

## 6. 后续建议

### 6.1 短期

- [ ] 观察修复后的效果，确认 Agent 不再在本地会话调用飞书工具
- [ ] 考虑在 MCP Tools section 的 "Matching principle" 中补充说明

### 6.2 中期

- [ ] 实现用户偏好配置 UI（激活 response-style 和 user-preferences）
- [ ] 考虑添加 THING.md 模板，引导用户创建项目上下文

### 6.3 长期

- [ ] 评估是否需要更细粒度的会话来源（如 'web' vs 'cli' vs 'api'）
- [ ] 考虑会话来源是否应该影响工具加载（本地会话不加载 connector 工具）
