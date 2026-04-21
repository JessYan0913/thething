# TheThing 项目

一个 AI Agent 框架，参考 Claude Code 架构设计，支持 CLI、Web UI 和 HTTP API 多种交互方式。

## 项目结构

```
thething/
├── packages/
│   ├── core/          # 核心引擎 (@the-thing/core)
│   ├── cli/           # 命令行工具 (@the-thing/cli)
│   ├── server/        # HTTP 服务端 (@the-thing/server)
│   ├── web/           # Web 前端 (@the-thing/web)
│   └── build/         # 构建工具 (@the-thing/build)
├── docs/              # 设计文档和指南
│   ├── config-architecture-guide.md    # 配置架构规范
│   ├── connector-gateway-design-v2.md  # Connector 设计
│   ├── context-budget-and-tool-output-management-design.md
│   └── permission-control-design.md    # 权限控制设计
└── pnpm-workspace.yaml
```

## 核心模块 (packages/core)

| 模块 | 功能 |
|------|------|
| `agent/` | Agent 创建和控制 |
| `agent-control/` | Agent 运行控制（停止、切换模型等） |
| `compaction/` | 对话压缩（auto-compact、micro-compact） |
| `config/` | 配置管理（defaults、types） |
| `connector/` | Connector Gateway（外部工具连接） |
| `datastore/` | 数据存储抽象层 |
| `mcp/` | MCP 协议支持 |
| `memory/` | 记忆系统 |
| `model-provider/` | 模型提供者抽象 |
| `model-capabilities/` | 模型能力配置 |
| `permissions/` | 权限管理 |
| `session-state/` | 会话状态管理 |
| `skills/` | 技能系统 |
| `subagents/` | 子代理系统 |
| `system-prompt/` | 系统提示生成 |
| `tasks/` | 任务管理 |
| `tools/` | 工具定义 |
| `middleware/` | 中间件 |

## 常用命令

```bash
# 开发
pnpm dev:cli      # 启动 CLI 开发模式
pnpm dev:server   # 启动 Server 开发模式
pnpm dev:web      # 启动 Web 开发模式

# 构建
pnpm build:web    # 构建 Web
pnpm build:cli    # 构建 CLI
pnpm build:portable  # 构建便携版

# 检查
pnpm typecheck    # 全项目类型检查
pnpm lint         # ESLint 检查
```

## 技术栈

- **语言**: TypeScript
- **包管理**: pnpm (monorepo)
- **AI SDK**: Vercel AI SDK (`ai` package)
- **MCP**: `@modelcontextprotocol/sdk`
- **数据库**: better-sqlite3
- **前端**: React + Vite + TailwindCSS
- **服务端**: Hono
- **构建**: esbuild / tsup

## 开发指南

### 代码风格

- 遵循 TypeScript 最佳实践
- 配置相关代码参考 `docs/config-architecture-guide.md`
- 新增模块在 `packages/core/src/index.ts` 导出

### 配置优先级

```
环境变量 > 配置文件/参数 > 默认值常量
```

### 测试

核心模块测试使用 Vitest：
```bash
pnpm --filter @the-thing/core test
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [配置架构规范](docs/config-architecture-guide.md) | 配置层级、命名、目录结构规范 |
| [Connector 设计](docs/connector-gateway-design-v2.md) | Connector Gateway 架构 |
| [权限控制](docs/permission-control-design.md) | 权限系统设计 |
| [预算管理](docs/context-budget-and-tool-output-management-design.md) | Token 预算和工具输出管理 |