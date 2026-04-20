# @thething/core

核心库包，提供多形态 AI Agent 的基础功能模块。

## 功能模块

### 数据库 (Database)
- SQLite 数据库配置与管理
- 支持 SEA (Single Executable Application) 的原生模块加载

### 聊天存储 (Chat Store)
- 对话消息的持久化存储
- 对话历史管理

### 压缩 (Compaction)
- API 压缩优化
- 自动压缩
- 后台队列处理
- Token 计数

### 连接器 (Connector)
- 工具连接器网关
- HTTP/SQL/Mock 执行器
- Webhook 处理
- 认证管理
- 审计日志

### MCP (Model Context Protocol)
- MCP 配置存储
- MCP 服务器注册与管理

### 记忆 (Memory)
- 记忆提取与存储
- 相关记忆检索
- 记忆老化管理

### 权限 (Permissions)
- 路径验证
- 权限规则管理

### 会话状态 (Session State)
- 成本追踪
- Token 预算管理
- 状态持久化

### 技能 (Skills)
- 技能加载器
- 元数据解析
- 条件激活

### 子代理 (SubAgents)
- 多类型代理: 分析、代码、探索、研究、写作等
- 代理执行器
- 流式事件广播

### 工具 (Tools)
- 工具注册与管理
- 工具适配器

### 中间件 (Middleware)
- 成本追踪
- 遥测
- 防护栏

### 代理控制 (Agent Control)
- 拒绝追踪
- 模型切换
- 流程管道
- 停止条件

## 使用方式

```typescript
import {
  getDb,
  initAll,
  // ... 其他导出
} from '@thething/core'

// 初始化所有模块
await initAll({
  dataDir: '/path/to/data',
  // 其他配置
})
```

## 依赖

- `ai` - AI SDK
- `better-sqlite3` - SQLite 数据库
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - 类型验证