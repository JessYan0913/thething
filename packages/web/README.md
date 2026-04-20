# @the-thing/web

Web 前端包，React SPA 应用提供图形化界面。

## 路由

- `/chat` - 聊天主页
- `/chat/:id` - 特定对话页面
- `/chat/settings/mcp` - MCP 设置
- `/connector-admin` - 连接器管理后台

## 组件

### AI Elements
聊天相关组件:
- `conversation.tsx` - 对话容器
- `message.tsx` - 消息显示
- `prompt-input.tsx` - 输入框
- `tool.tsx` - 工具调用显示
- `task.tsx` - 任务进度
- `reasoning.tsx` - 推理过程
- `subagent-stream.tsx` - 子代理流
- `approval-panel.tsx` - 权限审批
- `code-block.tsx` - 代码高亮

### UI 组件
基于 Radix UI 的基础组件:
- `button.tsx`, `input.tsx`, `textarea.tsx`
- `dialog.tsx`, `dropdown-menu.tsx`
- `sidebar.tsx`, `tooltip.tsx`
- 等等

### 其他
- `ConversationSidebar.tsx` - 对话列表侧边栏
- `task-panel.tsx` - 任务面板
- `connector-tool-panel.tsx` - 连接器工具面板

## 开发

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 预览构建结果
pnpm preview
```

## 技术栈

- **React 19** - UI 框架
- **React Router** - 路由管理
- **Tailwind CSS 4** - 样式
- **Vite** - 构建工具
- **Radix UI** - 无样式组件
- **Lucide React** - 图标库
- **Streamdown** - Markdown 流式渲染
- **Shiki** - 代码高亮
- **Motion** - 动画库

## 与服务器集成

前端需要配合 `@the-thing/server` 使用:
- 服务器提供 `/api/*` REST API
- 服务器可配置为提供静态资源服务
- 默认 CORS 配置允许本地开发