# Skill Workbench 设计方案

## Context

手动编写 Skill 的成本高、调试门槛高。需要一个 AI 辅助的 Skill 开发工作台，在一个页面内完成"生成 → 试用 → 修改 → 再试用"的完整迭代循环。Agent 能生成完整的 skill 文件夹（SKILL.md + 引用资源 + 脚本），生成后走真实的 skill 加载流程来验证，不满意在同一对话中继续修改。

## 整体架构

```
┌─ Web ─────────────────────────────────────────────────────────┐
│  SkillWorkbench.tsx (三栏布局)                                  │
│  ┌──────────┬──────────────┬────────────────────┐             │
│  │ 文件树    │  文件预览     │  Chat.tsx           │             │
│  │          │  (CodeMirror) │  api=/api/skill-    │             │
│  │          │              │  workbench/chat     │             │
│  └──────────┴──────────────┴────────────────────┘             │
└───────────────────────────────────────────────────────────────┘
        │ onTurnFinish → GET /api/skills/detail
        │
┌─ Server ──────────────────────────────────────────────────────┐
│  POST /api/skill-workbench/chat                               │
│  1. 注入 skill-creator 工作台前言到首条消息                      │
│  2. createAgent() 正常创建 agent                               │
│  3. agent 通过 Skill 工具调用 skill-creator 获取完整指令          │
│  4. agent 使用 Write/Bash 工具生成文件                          │
│  5. 每轮结束后自动 reloadServerContext()                        │
│  下一轮 createAgent() → 新 skill 已在 context 中可用 → 可测试    │
└───────────────────────────────────────────────────────────────┘
        │
┌─ Core ────────────────────────────────────────────────────────┐
│  无需修改 — 完全复用现有 bootstrap/createContext/createAgent     │
└───────────────────────────────────────────────────────────────┘
```

### 关键设计决策

1. **零 Core 改动**：通过在 server 端向首条消息注入 `<system-reminder>` 前言引导 agent 行为，agent 按需通过 Skill 工具加载 skill-creator 完整指令。
2. **自动热重载**：workbench endpoint 每轮结束后自动调用 `reloadServerContext()`，下一轮 `createAgent()` 自然获得最新 skill 列表 → 新创建的 skill 立即可通过 Skill 工具调用测试。
3. **轮询同步文件树**：Chat 的 `onTurnFinish` 回调触发 `GET /api/skills/detail` 刷新左侧文件树和中间预览，简单可靠。
4. **顶层路由**：workbench 使用独立路由 `/skill-workbench`，避免与 SettingsLayout 的侧边栏冲突，提供完整的三栏空间。

## 实施步骤

### Step 1: 扩展 Chat.tsx props

**文件**: `packages/web/src/components/Chat.tsx`

```typescript
export interface ChatProps {
  conversationId: string;
  onTitleUpdated?: () => void;
  apiEndpoint?: string;      // 新增：默认 '/api/chat'
  onTurnFinish?: () => void; // 新增：每轮结束后回调
}
```

改动点：
- `createChatTransport` 接受 `apiEndpoint` 参数，默认 `'/api/chat'`
- `useChat` 的 `onFinish` 中，在现有逻辑（PATCH 保存消息）之后调用 `onTurnFinish?.()`
- transport 的 memoization key 加上 `apiEndpoint`

### Step 2: 创建 Server 端 workbench 路由

**新文件**: `packages/server/src/routes/skill-workbench.ts`

两个端点：

#### `POST /chat`
流程：
1. 接收 `{ message, conversationId }` (同 chat.ts)
2. 加载已有消息历史
3. 如果是首条消息，注入 workbench 前言：
   ```
   <system-reminder>
   你是一个 Skill 开发助手。你的任务是帮助用户创建、测试和优化 Skill。
   
   工作流程：
   1. 理解用户需求后，使用 skill-creator 技能（通过 Skill 工具调用）来指导创建流程
   2. 在 skills 目录下创建完整的 skill 文件夹
   3. 创建完成后告知用户 skill 已就绪，可以进行测试
   4. 根据用户反馈持续优化
   
   Skills 目录路径: {skillsDir}
   </system-reminder>
   ```
4. 调用 `createAgent()` (使用 `getServerContext()`，包含所有技能包括 skill-creator)
5. 流式返回响应
6. **`finalizeAgentRun()` 后自动调用 `reloadServerContext()`**

#### `GET /detect`
用于检测当前 workbench 会话正在操作的 skill：
- 接收 `?conversationId=`
- 扫描 skills 目录，返回最近修改的 skill 文件夹名
- 返回 `{ skillName: string | null }`

关键复用：
- `getServerContext()` → 获取当前上下文
- `createAgent()` → 复用 core agent 创建
- `createAgentUIStream()` → 复用流式处理
- `finalizeAgentRun()` → 复用收尾逻辑
- `reloadServerContext()` → 热重载
- `getPrimarySkillsDir()` → 复用 skills.ts 中已有的辅助函数

**挂载**: `packages/server/src/index.ts` 添加 `app.route('/api/skill-workbench', workbenchRoutes)`

### Step 3: 创建 SkillWorkbench 页面

**新文件**: `packages/web/src/routes/SkillWorkbench.tsx`

三栏布局：

```
┌─────────────┬──────────────────────┬─────────────────────┐
│  文件树      │  文件预览             │  Agent 对话          │
│  250px      │  flex: 1             │  400px              │
│             │                      │                      │
│  复用        │  CodeMirror          │  <Chat              │
│  SkillFile  │  (只读，同            │    conversationId=  │
│  Tree 组件   │   SkillsSettings     │    apiEndpoint=     │
│             │   中的实现)           │    "/api/skill-     │
│             │                      │     workbench/chat" │
│  点击文件    │                      │    onTurnFinish=    │
│  → 右侧预览 │                      │    {refreshFiles}   │
│             │                      │  />                 │
└─────────────┴──────────────────────┴─────────────────────┘
 顶部: 返回按钮 + Skill 名称 + 状态指示
```

核心逻辑：
- `conversationId`: 页面加载时用 `nanoid()` 生成
- `skillName` 状态：初始为 null
- `onTurnFinish` 回调：
  1. 调用 `GET /api/skill-workbench/detect?conversationId=...` 检测 skill 名
  2. 如果检测到 skillName，调用 `GET /api/skills/detail?name=...` 获取文件树
  3. 更新左侧文件树和中间预览
- 文件树点击：调用 `GET /api/skills/file?name=...&path=...` 加载文件内容到预览

复用组件：
- `Chat` from `@/components/Chat` (对话面板)
- `SkillFileTree` from `@/components/SkillFileTree` (文件树)
- CodeMirror 预览 (同 SkillsSettings 中的实现模式)

### Step 4: 添加入口

**文件**: `packages/web/src/routes/SkillsSettings.tsx`

在 toolbar 区域（现有"上传 Skill"按钮旁）添加"AI 生成"按钮：

```tsx
<Button size="sm" onClick={() => navigate('/skill-workbench')}>
  <SparklesIcon className="h-4 w-4 mr-1" />
  AI 生成
</Button>
```

### Step 5: 注册路由

**文件**: `packages/web/src/App.tsx`

添加顶层路由（与 `/chat` 和 `/settings` 平级）：

```tsx
<Route path="/skill-workbench" element={<SkillWorkbench />} />
```

## 核心流程示意

```
用户: "帮我创建一个生成 pptx 演示文稿的 skill"

Turn 1 (生成):
  Agent → 调用 Skill 工具加载 skill-creator
  Agent → 了解创建规范
  Agent → 使用 Write/Bash 创建 pptx-generator/ 目录
         - SKILL.md (frontmatter + body)
         - scripts/create_pptx.py
         - references/template-guide.md
  Server → 自动 reloadServerContext()
  Client → onTurnFinish → 检测到新 skill → 刷新文件树

Turn 2 (测试):
  用户: "试一下这个 skill"
  Agent → createAgent() 获得最新 context（含新 skill）
  Agent → 调用 Skill 工具加载 pptx-generator
  Agent → 按 skill 指令执行操作
  Agent → 返回结果

Turn 3 (优化):
  用户: "输出格式不太对，应该支持自定义模板"
  Agent → 修改 SKILL.md 和相关脚本
  Server → 自动 reloadServerContext()
  Client → onTurnFinish → 刷新文件树和预览
  
Turn 4 (再测试):
  用户: "再试一次"
  Agent → 使用更新后的 skill 重新测试
  ...循环直到满意
```

## 关键文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `packages/web/src/routes/SkillWorkbench.tsx` |
| 新建 | `packages/server/src/routes/skill-workbench.ts` |
| 修改 | `packages/web/src/components/Chat.tsx` — 新增 `apiEndpoint` + `onTurnFinish` props |
| 修改 | `packages/web/src/routes/SkillsSettings.tsx` — 添加"AI 生成"按钮 |
| 修改 | `packages/web/src/App.tsx` — 添加 `/skill-workbench` 路由 |
| 修改 | `packages/server/src/index.ts` — 挂载 workbench 路由 |

## 验证方式

1. 启动 `pnpm dev:server` 和 `pnpm dev:web`
2. 访问 `/settings/skills`，点击"AI 生成"按钮
3. 在对话中描述一个简单 skill（如"创建一个格式化 JSON 的 skill"）
4. 验证：
   - 左侧文件树实时更新显示生成的文件
   - 中间预览可查看文件内容
   - 对话中要求"测试这个 skill"，agent 能成功调用
   - 修改后要求再次测试，验证迭代流程通畅
5. 回到 `/settings/skills`，确认新 skill 出现在列表中
