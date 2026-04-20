# @thething/cli

命令行界面包，提供 CLI 工具管理应用。

## 命令

### 默认命令: chat

直接运行进入交互式聊天模式:

```bash
thething
```

### server

启动 HTTP 服务器并打开浏览器:

```bash
thething server
thething server --port 8080       # 指定端口
thething server --no-open         # 不自动打开浏览器
thething server --data-dir ./data # 指定数据目录
```

### stop

停止运行中的服务器:

```bash
thething stop
```

### status

显示服务器状态:

```bash
thething status
```

### config

配置管理:

```bash
thething config show              # 显示当前配置
thething config set <key> <value> # 设置配置值
```

### db

数据库管理:

```bash
thething db path                  # 显示数据库路径
thething db backup ./backup.db    # 备份数据库
```

## 交互式聊天

运行默认命令后进入 REPL 模式:
- 输入消息与 AI 对话
- 支持流式输出
- 显示处理进度

## 开发

```bash
# 开发模式 (热重载)
pnpm dev

# 构建
pnpm build

# 启动
pnpm start
```

## 可执行文件

构建后生成 `dist/index.js`，可作为独立 CLI 工具使用。

## 依赖

- `commander` - CLI 框架
- `chalk` - 终端颜色
- `ora` - 进度指示器
- `open` - 打开浏览器
- `@thething/core` - 核心功能
- `@thething/server` - HTTP 服务器