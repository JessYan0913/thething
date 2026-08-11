# TheThing

> 参考 Claude Code 架构设计的 **个人全能 AI 助手** —— 本地优先、多形态，让知识与任务在对话中持续复利。

TheThing 是一个本地优先的个人 AI 助手：以 Agent 对话为核心，配 Wiki 知识库、技能、任务管理与外部工具接入，通过 **桌面应用、CLI、Web、HTTP API** 多种形态为你持续工作。所有数据保存在本地（`~/.thething/`），兼容 Dot Agents 协议。

## ✨ 核心特性

| 能力 | 说明 |
|------|------|
| 🤖 **多步 Agent** | 多步执行、子 Agent 并行、工具审批挂起、目标驱动（Goal）持续执行直至完成 |
| 📚 **Wiki 知识库** | Agent 用工具读写的 Markdown 知识库，支持 `[[链接]]` 关系图与分类，**用宿主 git 做版本管理** |
| 🧠 **用户记忆** | 用户级记忆 Wiki，跨会话沉淀复利知识 |
| 🧩 **MCP 扩展** | 连接任意 MCP 服务器，OAuth 授权全链路、registry 常驻热更新 |
| ⚡ **技能 Skills** | SKILL.md 能力包，按会话预算智能选入上下文；内置技能工作台 |
| ✅ **任务 Todo** | 带依赖关系（blockedBy/blocks）的任务管理，Agent 自动拆解与跟踪 |
| 🔌 **连接器 Connector** | YAML 定义外部 API 工具；入站支持飞书（HTTP/WS）、微信、任意 Webhook |
| ✂️ **上下文压缩** | 自动管理上下文窗口，增量估算 + 分层压缩 + 后台 Checkpoint，长对话不失控 |
| 🛤️ **对话路线图** | 任意消息处分叉多版本路线，随时切换/归档/固定 |
| ⏰ **自动化** | 定时任务（Cron）与计划审批（Plan） |

## 📦 安装

### 桌面应用（推荐）

下载最新版 **[TheThing 0.2.0](https://github.com/JessYan0913/thething/releases/tag/0.2.0)**：

| 文件 | 适用 |
|------|------|
| `The.Thing-0.2.0-arm64.dmg` | Apple Silicon（M1/M2/M3/M4） |
| `The.Thing-0.2.0.dmg` | Intel Mac |

> 未签名构建：首次打开需在「系统设置 → 隐私与安全性 → 仍要打开」，或右键 → 打开。

### 从源码运行

```bash
git clone https://github.com/JessYan0913/thething.git
cd thething
pnpm install

pnpm dev:cli        # CLI 交互
pnpm dev:next       # Web 界面
pnpm dev:desktop    # 桌面应用（Electron）
```

## 🚀 快速开始

启动后直接对话。输入 `/` 查看命令：

| 命令 | 说明 |
|------|------|
| `/goal <目标>` | 设定目标，Agent 持续执行直到完成（CLI/Web） |
| `/skill <技能> <提示>` | 调用技能（Web） |
| `/model <name>` | 切换模型（default / fast / smart） |
| `/mode <mode>` | 切换审批模式（smart / auto-review / full-trust） |
| `/list` · `/resume <n>` | 列出 / 恢复最近会话（CLI） |
| `/new` · `/delete <n>` | 新建 / 删除会话（CLI） |

## 🏗️ 架构

pnpm monorepo，5 个包：

```
packages/
├── core/              # 核心引擎：Agent 编排、Wiki、Skill、Todo、MCP、Connector、权限
├── app/               # Next.js Web 应用 + 全部 HTTP API（App Router）
├── desktop/           # Electron 桌面应用（内置 Next standalone 服务，常驻进程）
├── cli/               # 命令行交互（Ink TUI）
└── resumable-stream/  # 可恢复 SSE 流（SQLite + 内存 Pub/Sub，断线续传）
```

HTTP API 覆盖：Chat（SSE 流、审批、分支、清理）、MCP、Connector（Webhook 入站）、Wiki、Agent/Skill 工作台、模型/权限/配置等。

## 🛠️ 开发

```bash
pnpm dev:cli              # CLI 开发
pnpm dev:next             # Web 开发
pnpm build:desktop        # 打包桌面（DMG）
cd packages/core && pnpm test   # 运行 core 测试
pnpm typecheck            # 全仓类型检查
```

## 📄 License

MIT
