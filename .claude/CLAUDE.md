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
│   ├── config-refactor-complete.md     # 配置重构完整方案
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
| `config/` | 配置管理（`behavior.ts`、`layout.ts`、`defaults.ts`） |
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
| `todos/` | 任务管理 |
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

### 配置系统

配置分为两个独立的对象：

**`LayoutConfig`** — 文件系统布局（文件放在哪里）：
```typescript
interface LayoutConfig {
  resourceRoot: string;      // 项目根目录（必填）
  configDirName?: string;    // 配置目录名（默认 '.thething'）
  dataDir?: string;          // 数据目录（默认由 configDirName 派生）
  resources?: Partial<ResourceDirs>;  // 自定义资源目录
  contextFileNames?: readonly string[];  // 项目上下文文件名
}
```

**`BehaviorConfig`** — 运行时行为（系统怎么运行）：
```typescript
interface BehaviorConfig {
  maxStepsPerSession: number;        // 最大步骤数（默认 50）
  maxBudgetUsdPerSession: number;    // 最大预算（默认 5.0）
  maxContextTokens: number;          // 上下文限制（默认 128_000）
  compactionThreshold: number;       // 压缩阈值（默认 25_000）
  maxDenialsPerTool: number;         // 最大拒绝次数（默认 3）
  availableModels: ModelSpec[];      // 可用模型列表
  modelAliases: { fast, smart, default };  // 模型快捷名映射
  autoDowngradeCostThreshold: number;  // 自动降级阈值（默认 80）
  modelPricing?: Record<string, ModelPricing>;  // 模型定价
  extraSensitivePaths?: readonly string[];  // 额外敏感路径
}
```

**使用示例**：
```typescript
import { bootstrap, createContext, createAgent } from '@the-thing/core';

// 最简场景（全部默认值）
const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd() }
});

// 替换应用名
const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd(), configDirName: '.myapp' }
});

// 企业部署（调整预算 + 替换模型）
const runtime = await bootstrap({
  layout: { resourceRoot: process.cwd(), dataDir: '/var/lib/app/data' },
  behavior: {
    maxBudgetUsdPerSession: 20.0,
    maxStepsPerSession: 100,
    availableModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
    ],
    modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
  }
});

const context = await createContext({ runtime });
const { agent } = await createAgent({ context, model: { apiKey, baseURL, modelName } });
await runtime.dispose();
```

### 配置优先级

```
bootstrap 参数 > 默认值常量
```

环境变量由应用层（CLI/Server）处理，core 包不直接读取 `process.env`。

### 测试

核心模块测试使用 Vitest：
```bash
pnpm --filter @the-thing/core test
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [配置重构完整方案](docs/config-refactor-complete.md) | 配置系统第一性原理分析和实施步骤 |
| [配置架构规范](docs/config-architecture-guide.md) | 配置层级、命名、目录结构规范 |
| [Connector 设计](docs/connector-gateway-design-v2.md) | Connector Gateway 架构 |
| [权限控制](docs/permission-control-design.md) | 权限系统设计 |
| [预算管理](docs/context-budget-and-tool-output-management-design.md) | Token 预算和工具输出管理 |