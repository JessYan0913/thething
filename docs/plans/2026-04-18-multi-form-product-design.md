# 多形态产品架构设计

## 产品形态矩阵

| 形态 | 实现 | 状态 |
|------|------|------|
| Web | 浏览器连接 localhost，纯 UI 层 | 已有（需重构为 SPA） |
| CLI | 混合型：启动服务 + 多轮交互对话 | 需新增 |
| 便携端 | CLI 的打包版本，放U盘即可运行 | 需新增 |
| 桌面端 | 暂不实现 | — |

**核心原则**：Web 只是本地 Agent 服务的 UI 渲染层，数据永远在本地 SQLite。所有形态共享同一个 Agent Core Engine。

## 架构设计：三层分离

```
┌──────────────────────────────────────┐
│         Presentation Layer           │
│    Web SPA │ CLI Shell │ Portable    │
├──────────────────────────────────────┤
│         Transport Layer              │
│         HTTP API (Hono)              │
├──────────────────────────────────────┤
│         Agent Core Engine            │
│  AI SDK │ Subagents │ Connector │    │
│  ChatStore │ Memory │ Tasks │        │
├──────────────────────────────────────┤
│         Data Layer                   │
│         SQLite (better-sqlite3)      │
└──────────────────────────────────────┘
```

**核心变化**：
- Agent Core Engine 从 Next.js API routes 抽离，变成独立 Node.js 服务模块
- HTTP API 层用 Hono 替代 Next.js API routes
- 前端从 Next.js SSR 拆成纯静态 SPA（React + Vite）
- CLI 直接调用 Core 的函数接口（不走 HTTP），同时可启动 HTTP 服务供 Web 连接

## 项目结构（Monorepo）

```
thething/
├── packages/
│   ├── core/                  # Agent Core Engine
│   │   ├── src/
│   │   │   ├── agent/         # subagents, router, registry
│   │   │   ├── connector/     # connector gateway
│   │   │   ├── chat/          # chat-store, compaction
│   │   │   ├── memory/        # memory store
│   │   │   ├── tasks/         # task system
│   │   │   ├── db/            # SQLite 初始化、schema
│   │   │   ├── system-prompt/ # system prompt sections
│   │   │   ├── tools/         # exa-search, glob, grep
│   │   │   └── index.ts       # 统一导出
│   │   └── package.json
│   │
│   ├── server/                # Transport Layer - HTTP API (Hono)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── chat.ts
│   │   │   │   ├── conversations.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── connector/
│   │   │   │   └── debug.ts
│   │   │   ├── middleware/
│   │   │   └── index.ts       # Hono app + server.start()
│   │   └── package.json
│   │
│   ├── web/                   # Presentation - 纯静态 SPA
│   │   ├── src/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── cli/                   # CLI 启动器
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── interactive/
│   │   │   └── index.ts
│   │   └── package.json
│   │
├── pnpm-workspace.yaml
├── package.json
└── .data/
```

**关键设计决策**：
- `core` 是纯逻辑模块，无 HTTP 依赖，CLI 可直接 import 调用
- `server` 依赖 `core`，用 Hono 暴露 HTTP API
- `web` 是纯前端 SPA，vite build 产出静态文件，由 server serve
- `cli` 依赖 `core` + `server`，是用户入口

## CLI 命令设计

### 服务管理
```
thething                          # 默认：启动服务 + 打开浏览器
thething start                    # 启动后台服务（默认端口 3456）
  --port 8080                     # 自定义端口
  --no-open                       # 不自动打开浏览器
  --data-dir /path/to/data        # 自定义数据目录
thething stop                     # 停止后台服务
thething status                   # 查看服务状态、端口、数据库路径
```

### 多轮交互对话
```
thething chat                     # 进入多轮交互式对话
  --conversation abc123           # 继续已有对话
  --model qwen3.6-plus            # 指定模型
  --agent research                # 指定 subagent 类型

# 交互模式内部：
> 帮我分析这段代码               # 用户输入
[Agent 流式回复...]

> 继续深入分析安全性              # 追问
[Agent 流式回复...]

> /clear                          # 清空当前对话
> /model qwen3.6-plus             # 切换模型
> /agent explore                  # 切换 subagent
> /save                           # 保存对话
> /history                        # 对话历史摘要
> /exit 或 双次 Ctrl+C           # 退出（单次 Ctrl+C 中断当前生成）
```

### 配置管理
```
thething config set api.key xxx
thething config set default.model qwen3.6-plus
thething config show
```

### 数据库管理
```
thething db path
thething db backup /path/to/backup.db
thething db migrate
```

## data-dir 策略

```
形态            默认 data-dir                    覆盖方式
─────────────────────────────────────────────────────────────
CLI (本地)      ~/.thething/data                 --data-dir 参数
Web (本地)      同 CLI（服务由 CLI 启动）         跟随服务端
便携端          可执行文件同级 thing-data/        --data-dir 或自动检测
```

**data-dir 内部结构**：
```
<data-dir>/
├── chat.db                      # SQLite 数据库
├── config.json                  # 用户配置
├── server.lock                  # 运行时：端口和 PID
├── credentials/                 # connector 凭证加密存储
└── logs/                        # 运行日志
```

**便携端自动检测优先级**：
1. `--data-dir` 命令行参数
2. 可执行文件同级的 `thing-data/` 目录
3. `~/.thething/data/`（兜底）

**便携端 U盘结构**：
```
U盘/
├── thing.exe (或 thing)
├── thing-data/
├── web/                         # 静态前端资源
└── run.bat / run.sh             # 一键启动脚本
```

## 配置分层与优先级

```
层级 1: 内置默认值              — core 包内硬编码
层级 2: 全局配置文件            — ~/.thething/config.json
层级 3: data-dir 内配置         — <data-dir>/config.json（便携端优先使用此层）
层级 4: 命令行参数              — --port, --model 等
层级 5: 环境变量                — DASHSCOPE_API_KEY 等

优先级：命令行 > 环境变量 > data-dir 配置 > 全局配置 > 内置默认
```

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 端口冲突 | 自动尝试下一个端口（3456→3457→3458） |
| 服务已在运行 | 检测 server.lock，提示用 status 查看 |
| CLI + Web 同时操作 | better-sqlite3 WAL 模式支持并发读写 |
| 便携端拔出U盘 | 提示优雅退出；下次启动自动清理 WAL 残留 |
| 数据库损坏 | 启动时检测完整性，损坏时从备份恢复或重建 |
| 多平台 native 模块 | CI 按平台分别编译，打包时嵌入对应版本 |

## 迁移策略（渐进式）

### Phase 1: 建立 monorepo + 抽离 core
- 创建 pnpm-workspace.yaml
- 从 src/lib/ 迁移模块到 packages/core/src/
- core 不依赖 Next.js，只依赖 better-sqlite3 + ai SDK
- 现有 Next.js API routes 改为从 core import

### Phase 2: 抽离 server (Hono HTTP API)
- 用 Hono 重写 API routes
- server 依赖 core，暴露同样 API 路径
- Next.js 仍可运行作为过渡

### Phase 3: 抽离 web (Vite SPA)
- React UI 代码迁移到 packages/web/
- Server Components 改为 Client Components
- 数据请求改为调用 HTTP API
- 移除 next/ 依赖

### Phase 4: 实现 CLI
- commander.js 做命令解析
- start: 启动 server → serve web 静态资源 → 打开浏览器
- chat: 调用 core 函数，流式输出到终端
- 交互 REPL 模式

### Phase 5: 便携端打包
- 选择打包方案（SEA / Bun compile / pkg）后定
- 按平台编译 better-sqlite3 native 模块
- 组装：可执行文件 + web 静态资源 + 启动脚本

**每个 Phase 独立可验证，不需要全部做完才能用。Phase 2 和 3 可并行推进。**