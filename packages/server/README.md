# @the-thing/server

HTTP API 服务器包，基于 Hono 框架提供 REST API 接口。

## API 路由

### 核心路由
- `/api/chat` - 聊天对话接口
- `/api/conversations` - 对话管理
- `/api/tasks` - 任务管理
- `/api/permissions` - 权限管理
- `/api/mcp` - MCP 配置管理
- `/api/debug` - 调试接口

### 连接器路由
- `/api/connector/tools` - 工具连接器
- `/api/connector/test` - 工具测试
- `/api/connector/admin/tools` - 管理工具配置
- `/api/connector/admin/logs` - 审计日志
- `/api/connector/webhooks` - Webhook 管理

### 其他
- `/health` - 健康检查
- `/` - SPA 静态页面 (可选)

## 使用方式

### 启动服务器

```typescript
import { startServer, configureStaticAssets, setupStaticAssets } from '@the-thing/server'

// 配置静态资源目录 (可选)
configureStaticAssets('/path/to/web/dist')
setupStaticAssets()

// 启动服务器
startServer(3456)
```

### CORS 配置

默认允许以下源:
- `http://localhost:3000`
- `http://localhost:3456`

## 开发

```bash
# 开发模式 (热重载)
pnpm dev

# 启动服务器
pnpm start
```

## 静态资源

可配置为前端 SPA 应用服务静态资源，支持:
- `/assets/*` - 静态资源文件
- SPA fallback - 所有非 API 路径返回 index.html

## 依赖

- `hono` - 轻量级 Web 框架
- `@hono/node-server` - Node.js 服务器适配器
- `@the-thing/core` - 核心功能模块