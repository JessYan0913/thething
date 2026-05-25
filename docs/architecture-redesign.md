# 架构重构设计：Next.js 统一应用

## 1. 背景与问题

### 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop (Tauri)                         │
│              SEA sidecar: thing serve --port 0              │
│              协议: stdout → THETHING_PORT= / THETHING_READY │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        CLI                                  │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │    chat    │  │   config   │  │  serve (依赖 server) │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Server (Hono)                           │
│  ┌──────────────────────────────────────────────────┐      │
│  │        HTTP API (19 个路由模块)                    │      │
│  ├──────────────────────────────────────────────────┤      │
│  │        可选：静态资源服务 (configureStaticAssets)  │      │
│  ├──────────────────────────────────────────────────┤      │
│  │        飞书 WebSocket 长连接 (自动启动)            │      │
│  └──────────────────────────────────────────────────┘      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Web (Vite SPA)                         │
│       React Router v7 · 63 个 tsx 文件 · 7 个路由           │
│       开发时代理 /api → localhost:3456                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         Core                                │
│  bootstrap() → CoreRuntime { dataStore, layout, behavior,  │
│    connectorRegistry, connectorInbound, dispose() }         │
└─────────────────────────────────────────────────────────────┘
```

### 存在问题

1. **CLI 与 Server 耦合**
   - CLI 的 `serve` 命令是唯一依赖 `@the-thing/server` 的地方
   - 其他命令 (chat/config/db) 只依赖 Core，但因 `serve` 导致整个 CLI 包依赖 Server

2. **部署为两个服务**
   - Server (Hono, port 3456) 提供 API
   - Web (Vite, port 5173) 开发时独立运行，生产环境需 Server 通过 `configureStaticAssets` 托管

3. **Connector 嵌入 Server**
   - 飞书 WebSocket 在 `initServerRuntime()` 中自动启动
   - 无法独立扩展/部署其他 Connector

4. **Desktop 链路过长**
   - Desktop → Tauri sidecar (SEA) → CLI `serve` → Server (Hono) → Core
   - 中间多了 CLI 这一层

---

## 2. 新架构设计

### 设计原则

- Core 是唯一的大脑，所有交互层直接依赖 Core
- 每个组件职责单一，依赖方向单向向下
- 每个组件可以独立运行和测试

### 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
│                    (packages/next-app)                       │
│                                                              │
│  ┌───────────────────────┐  ┌──────────────────────────────┐│
│  │     API Routes        │  │    React UI (App Router)     ││
│  │  (替代 Hono Server)   │  │  (替代 Vite SPA)            ││
│  └───────────┬───────────┘  └──────────────┬───────────────┘│
│              │                              │                │
│              └──────────┬───────────────────┘                │
│                         │                                    │
│               ┌─────────▼─────────┐                         │
│               │       Core        │                         │
│               └───────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
         │                            │
         ▼                            ▼
┌──────────────────┐       ┌────────────────────────┐
│       CLI        │       │       Desktop          │
│  (独立，只依赖    │       │  (Tauri + Node.js      │
│   Core)          │       │   + standalone 输出)    │
└──────────────────┘       └────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│              Connector Daemon (独立进程，直接依赖 Core)        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  飞书 / 企微 / 钉钉 / Slack WebSocket               │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 依赖关系（单向）

```
CLI ──────────→ Core
Next.js App ──→ Core
Desktop ──────→ Next.js standalone 产物 (运行时)
Connector ────→ Core
```

---

## 3. 组件职责

### Core（不变）

职责：AI Agent 大脑。提供 `bootstrap()` → `CoreRuntime`。

暴露：`dataStore`, `layout`, `behavior`, `connectorRegistry`, `connectorInbound`, `dispose()`

依赖：无外部包依赖

### Next.js Application（合并 Server + Web）

新增包 `packages/next-app`，替代 `packages/server` + `packages/web`。

- 使用 `output: 'standalone'` 构建（**不使用** `output: 'export'`，因为需要 API Routes）
- 所有路由强制 `runtime = 'nodejs'`（**不使用** Edge Runtime，因 `better-sqlite3` native 模块）
- CoreRuntime 以单例模式在服务端初始化

### CLI（独立化）

删除 `serve` 命令，去掉 `@the-thing/server` 依赖。

保留命令：
```
thething             # 交互式聊天 (Ink)
thething config show/set
thething db path/backup
```

依赖：仅 `@the-thing/core`

### Desktop（打包方式变更）

**当前方案**：`@the-thing/build` 构建 SEA → Tauri sidecar 运行 `thing serve`

**新方案**：
1. `next build` 生成 standalone 输出
2. Tauri 捆绑：Node.js 二进制 + standalone 目录 + native `.node` bindings
3. Tauri sidecar 运行 `node server.js -p 0`
4. 保持现有 stdout 协议（`THETHING_PORT=` / `THETHING_READY`）

### Connector Daemon（提取为独立包）

新增包 `packages/connector-daemon`。

- 直接 import `@the-thing/core`，调用 `bootstrap()` 获取 CoreRuntime
- 管理飞书/企微等 WebSocket 长连接
- 独立 Node.js 进程，与 Next.js 无依赖关系
- 通过 Core 的 `connectorRegistry` 和 `connectorInbound` 收发消息

---

## 4. 技术细节

### 4.1 Next.js 配置

```typescript
// packages/next-app/next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  serverExternalPackages: ['better-sqlite3'],

  webpack: (config) => {
    config.externals = [...(config.externals || []), 'better-sqlite3'];
    return config;
  },
};

export default nextConfig;
```

### 4.2 CoreRuntime 服务端单例

```typescript
// packages/next-app/lib/runtime.ts
import { bootstrap, type CoreRuntime } from '@the-thing/core';

let runtime: CoreRuntime | null = null;

export async function getServerRuntime(): Promise<CoreRuntime> {
  if (!runtime) {
    runtime = await bootstrap({
      layout: {
        resourceRoot: process.cwd(),
        dataDir: process.env.THETHING_DATA_DIR,
      },
    });
  }
  return runtime;
}
```

约束：此模块只能在 Server Components、API Routes、`'use server'` 函数中导入。在 Client Component 中导入会导致 webpack 尝试打包 `better-sqlite3`，构建失败。

### 4.3 API Route 示例（流式聊天）

```typescript
// packages/next-app/app/api/chat/route.ts
import { getServerRuntime } from '@/lib/runtime';

export const runtime = 'nodejs'; // 禁止 Edge Runtime

export async function POST(request: Request) {
  const rt = await getServerRuntime();
  const body = await request.json();
  const response = await rt.handleChat(body);
  return new Response(response.body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
```

### 4.4 Desktop 打包流程

```bash
# 1. 构建 Next.js standalone
cd packages/next-app
pnpm next build
# 产物在 .next/standalone/（包含 server.js 入口和精简 node_modules）

# 2. 拷贝 static 资源（standalone 不含 public/ 和 .next/static/）
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# 3. 拷贝 better-sqlite3 native binding
cp node_modules/better-sqlite3/build/Release/better_sqlite3.node \
   .next/standalone/node_modules/better-sqlite3/build/Release/

# 4. 准备 Tauri 资源
cp -r .next/standalone ../desktop/src-tauri/resources/next-app

# 5. 下载目标平台 Node.js 二进制
# (脚本化：根据 Tauri target triple 下载对应 Node.js)
node ../desktop/scripts/download-node.js --target aarch64-apple-darwin
cp node-binary ../desktop/src-tauri/binaries/node-aarch64-apple-darwin

# 6. 构建 Tauri 应用
cd ../desktop
cargo tauri build
```

### 4.5 Tauri sidecar 启动

```rust
// packages/desktop/src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let next_app_dir = resource_dir.join("next-app");

            // sidecar: 运行 Node.js + Next.js standalone server
            let sidecar = app.shell().sidecar("node")?;
            let (mut rx, _child) = sidecar
                .current_dir(&next_app_dir)
                .env("THETHING_DATA_DIR", get_data_dir())
                .args(&["server.js", "-p", "0"])
                .spawn()?;

            // 复用现有协议：解析 THETHING_PORT= 行
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let Some(port) = parse_port_line(&event) {
                        // 导航 webview 到 http://localhost:{port}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

注意：Next.js standalone 的 `server.js` 默认不输出 `THETHING_PORT=` 格式。需要在 standalone 入口添加一层 wrapper 脚本：

```javascript
// packages/next-app/scripts/start-standalone.js
const { createServer } = require('http');
const next = require('./server.js');

const port = parseInt(process.argv.find(a => a === '-p')
  ? process.argv[process.argv.indexOf('-p') + 1] : '3456');

const server = createServer(next);
server.listen(port === 0 ? 0 : port, () => {
  const addr = server.address();
  console.log(`THETHING_PORT=${addr.port}`);
  console.log('THETHING_READY');
});
```

### 4.6 路由映射

#### React Router v7 → App Router

| 当前路由 (React Router) | 新路由 (App Router) | 说明 |
|---|---|---|
| `/` → redirect `/chat` | `app/page.tsx` → redirect | - |
| `/chat` | `app/chat/page.tsx` | ChatHome |
| `/chat/:id` | `app/chat/[id]/page.tsx` | ChatPage |
| `/skill-workbench` | `app/workbench/skill/page.tsx` | - |
| `/skill-workbench/:skillName` | `app/workbench/skill/[skillName]/page.tsx` | - |
| `/agent-workbench` | `app/workbench/agent/page.tsx` | - |
| `/agent-workbench/:agentType` | `app/workbench/agent/[agentType]/page.tsx` | - |
| `/settings/general` | `app/settings/general/page.tsx` | - |
| `/settings/mcp` | `app/settings/mcp/page.tsx` | - |
| `/settings/skills` | `app/settings/skills/page.tsx` | - |
| `/settings/agents` | `app/settings/agents/page.tsx` | - |
| `/settings/connectors` | `app/settings/connectors/page.tsx` | - |
| `/settings/permissions` | `app/settings/permissions/page.tsx` | - |
| `/settings/memory` | `app/settings/memory/page.tsx` | - |

#### 布局嵌套

```
app/
├── layout.tsx              # 根布局 (ThemeProvider, i18n, TooltipProvider)
├── page.tsx                # / → redirect to /chat
├── chat/
│   ├── layout.tsx          # ChatLayout (侧边栏 + 对话区)
│   ├── page.tsx            # ChatHome
│   └── [id]/
│       └── page.tsx        # ChatPage
├── workbench/
│   ├── skill/
│   │   ├── page.tsx
│   │   └── [skillName]/page.tsx
│   └── agent/
│       ├── page.tsx
│       └── [agentType]/page.tsx
├── settings/
│   ├── layout.tsx          # SettingsLayout
│   ├── general/page.tsx
│   ├── mcp/page.tsx
│   ├── skills/page.tsx
│   ├── agents/page.tsx
│   ├── connectors/page.tsx
│   ├── permissions/page.tsx
│   └── memory/page.tsx
└── api/
    ├── chat/route.ts
    ├── conversations/route.ts
    ├── todos/route.ts
    ├── permissions/route.ts
    ├── mcp/route.ts
    ├── skills/route.ts
    ├── agents/route.ts
    ├── connectors/route.ts
    ├── memory/route.ts
    ├── debug/route.ts
    ├── fs/route.ts
    ├── skill-workbench/route.ts
    ├── agent-workbench/route.ts
    └── connector/
        ├── tools/route.ts
        ├── test/route.ts
        ├── webhooks/route.ts
        └── admin/
            ├── tools/route.ts
            ├── test-tool/route.ts
            └── logs/route.ts
```

#### 组件迁移策略

现有 63 个 tsx 组件大部分为纯 UI 组件，可直接复用：

- `components/ui/*` → 原样复制（shadcn 组件，与框架无关）
- `components/Chat.tsx` 等交互组件 → 添加 `'use client'` 声明
- `@ai-sdk/react` 的 `useChat` → 在 Next.js 中原生支持，API 兼容
- `next-themes` → 已在使用，无需替换
- React Router 的 `useNavigate`/`useParams` → 替换为 `next/navigation` 的 `useRouter`/`useParams`

---

## 5. 迁移步骤

### Phase 0: POC 验证（1-2 天）

**目的**：验证 Next.js standalone + better-sqlite3 + Tauri 这条路能走通。

**步骤**：
1. 创建临时 Next.js 项目，安装 `better-sqlite3`
2. 写一个 API Route 执行 SQLite 查询
3. `next build` 生成 standalone 输出
4. 手动运行 `node .next/standalone/server.js`，验证 API 正常
5. 将 standalone 输出放入 Tauri 项目，sidecar 方式运行
6. 验证 Tauri 应用能打开 webview 并调用 API

**通过标准**：Tauri 应用内能通过 API Route 读写 SQLite。

**若失败**：放弃 Next.js 方案，改用轻量方案（Hono 直接托管 Vite 构建产物 + CLI 独立化）。

---

### Phase 1: CLI 独立化（0.5 天）

**目的**：解除 CLI 对 Server 的依赖。此步骤独立于 Next.js 迁移，无论后续方向如何都受益。

**变更**：
| 文件 | 操作 |
|---|---|
| `packages/cli/src/commands/serve.ts` | 删除 |
| `packages/cli/src/index.ts` | 移除 serve 命令注册 |
| `packages/cli/package.json` | 移除 `@the-thing/server` 依赖 |
| `packages/server/src/serve.ts` | 添加 CLI 参数解析（`--port`, `--web-dir`），接管原 serve 命令的职责 |
| `packages/server/package.json` | 添加 `bin` 入口 |

**验证**：
- `pnpm --filter @the-thing/cli typecheck` 通过
- `thething chat` 正常工作
- `packages/server` 独立启动 `tsx src/serve.ts` 正常
- Desktop sidecar 改为调用 server 的入口（临时调整）

**回退**：恢复删除的文件即可。

---

### Phase 2: 创建 Next.js 项目 + 迁移 API Routes（3-5 天）

**目的**：用 Next.js API Routes 替代 Hono 路由。前端暂不迁移。

**步骤**：

1. 初始化 `packages/next-app`
   ```bash
   pnpm create next-app packages/next-app \
     --typescript --tailwind --eslint --app --no-src-dir
   ```

2. 配置 `next.config.ts`（见 4.1 节）

3. 创建 `lib/runtime.ts` CoreRuntime 单例（见 4.2 节）

4. 逐个迁移 Hono 路由到 API Routes

   迁移模式——Hono handler 到 Next.js Route Handler 的机械转换：
   ```typescript
   // 迁移前 (Hono)
   app.post('/api/chat', async (c) => {
     const body = await c.req.json();
     // ... 业务逻辑
     return c.json(result);
   });

   // 迁移后 (Next.js)
   // app/api/chat/route.ts
   export const runtime = 'nodejs';
   export async function POST(request: Request) {
     const body = await request.json();
     // ... 业务逻辑（直接复用）
     return Response.json(result);
   }
   ```

5. 并行运行验证：Hono server (port 3456) 和 Next.js (port 3000) 同时运行，逐个 API 对比响应

**验证**：
- 所有 19 个 API 路由在 Next.js 中响应一致
- 现有 Web 前端将 Vite 代理目标改为 `localhost:3000` 后功能正常
- `pnpm --filter next-app typecheck` 通过

**回退**：删除 `packages/next-app`，保留原 server 不变。

---

### Phase 3: 迁移 React UI 到 App Router（5-7 天）

**目的**：将 Vite SPA 迁移到 Next.js App Router，实现前后端统一。

**步骤**：

1. 将 `packages/web/src/components/ui/` 原样复制到 `packages/next-app/components/ui/`

2. 安装 Web 端依赖到 next-app：
   ```
   @ai-sdk/react, @codemirror/*, lucide-react, motion, cmdk,
   shiki, streamdown, next-themes, react-i18next, i18next
   ```

3. 创建根 `layout.tsx`（ThemeProvider + i18n + TooltipProvider）

4. 按路由映射表（4.6 节）逐页面迁移：
   - 每个页面组件添加 `'use client'`（大部分页面有交互逻辑）
   - 替换 `useNavigate()` → `useRouter()`
   - 替换 `useParams()` → `next/navigation` 的 `useParams()`
   - 替换 `<Link to={}>` → `<Link href={}>`
   - 移除 `<BrowserRouter>` / `<Routes>` / `<Route>`，由文件系统路由替代

5. 处理 ChatLayout（侧边栏 + 对话区）：
   - 迁移为 `app/chat/layout.tsx`
   - 子路由自动嵌套

6. 处理 SettingsLayout：同上

**验证**：
- 所有 7 个路由页面可正常访问
- 聊天功能（流式响应）正常
- 设置页面 CRUD 正常
- Workbench 页面正常
- 暗色模式切换正常
- `pnpm next build` 成功

**回退**：保留 `packages/web`，随时可切回 Vite 开发。

---

### Phase 4: Connector 提取（2-3 天）

**目的**：将飞书 WebSocket 等 Connector 从 Server 中提取为独立进程。

**变更**：

1. 创建 `packages/connector-daemon/`
   ```
   packages/connector-daemon/
   ├── src/
   │   ├── index.ts          # 入口：bootstrap Core, 启动 connectors
   │   ├── feishu.ts         # 从 server/src/feishu-long-connection.ts 迁移
   │   └── config.ts         # 环境变量/配置
   └── package.json          # 依赖: @the-thing/core, @larksuiteoapi/node-sdk
   ```

2. `index.ts` 核心逻辑：
   ```typescript
   import { bootstrap, configureConnectorInboundRuntime } from '@the-thing/core';

   const runtime = await bootstrap({ layout: { ... } });
   // 复用 server/src/runtime.ts 中的 Connector 初始化逻辑
   configureConnectorInboundRuntime(runtime, { apiKey, model });
   startFeishuConnections(runtime);
   ```

3. 从 `packages/server/src/runtime.ts` 中移除 Connector 启动逻辑
4. Next.js 的 `lib/runtime.ts` 不启动 Connector

**验证**：
- `tsx packages/connector-daemon/src/index.ts` 能独立运行，接收飞书消息
- Next.js 应用不启动 Connector 但 API 正常
- 两者可同时运行，共享同一个 SQLite 数据库（Core 的 WAL 模式支持）

**回退**：保持 Connector 逻辑在 Next.js 的 runtime 初始化中。

---

### Phase 5: Desktop 打包切换（3-5 天）

**目的**：Desktop 从 SEA + CLI sidecar 切换到 Node.js + Next.js standalone。

**这是风险最高的阶段，应最后执行。**

**步骤**：

1. 编写 `packages/desktop/scripts/prepare-standalone.ts`：
   - 运行 `next build`
   - 拷贝 standalone 输出到 `src-tauri/resources/next-app/`
   - 拷贝 `.next/static/` 和 `public/`
   - 拷贝 `better-sqlite3` native binding
   - 创建 `start-standalone.js` wrapper（输出 `THETHING_PORT=` 协议）

2. 编写 `packages/desktop/scripts/download-node.ts`：
   - 按 target triple 下载 Node.js 二进制
   - 放入 `src-tauri/binaries/node-{target-triple}`

3. 修改 `src-tauri/tauri.conf.json`：
   - `externalBin` 改为 `node`
   - `resources` 改为 `next-app/` 目录

4. 修改 `src-tauri/src/lib.rs`：
   - sidecar 命令改为 `node start-standalone.js -p 0`
   - 保持 stdout 协议解析逻辑不变

5. 移除 `packages/build/`（不再需要 SEA 构建）

**验证**：
- `cargo tauri dev` 能启动应用
- webview 正常加载 UI
- 聊天功能正常
- `cargo tauri build` 产出 .dmg/.exe 可正常安装运行

**回退**：保留 `packages/build` 和原有 SEA 流程，仅在此 Phase 完成后清理。

---

### Phase 6: 清理（1 天）

**步骤**：
1. 删除 `packages/server/`
2. 删除 `packages/web/`
3. 删除 `packages/build/`（如果 Phase 5 完成）
4. 更新根 `package.json` scripts
5. 更新 CI/CD 配置
6. 更新 README

---

## 6. 时间线总结

| Phase | 工作内容 | 预计时间 | 依赖 | 可独立回退 |
|-------|----------|----------|------|-----------|
| 0 | POC 验证 | 1-2 天 | 无 | 是（删除临时项目） |
| 1 | CLI 独立化 | 0.5 天 | 无 | 是 |
| 2 | API Routes 迁移 | 3-5 天 | Phase 0 通过 | 是 |
| 3 | React UI 迁移 | 5-7 天 | Phase 2 | 是 |
| 4 | Connector 提取 | 2-3 天 | Phase 2 | 是 |
| 5 | Desktop 打包 | 3-5 天 | Phase 3 | 是 |
| 6 | 清理 | 1 天 | Phase 3, 5 | 不可逆 |

**总计：15-23 天**

Phase 1 和 Phase 4 可以与其他 Phase 并行执行。Phase 6 在所有迁移验证完成后再执行。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| better-sqlite3 在 standalone 打包中 binding 路径错误 | API 全部不可用 | Phase 0 提前验证；编写脚本自动拷贝 `.node` 文件 |
| Next.js standalone 体积过大导致 Desktop 安装包膨胀 | 用户体验下降 | 测量 standalone 体积（预计 30-50MB），与当前 SEA 对比；必要时 tree-shake |
| React Router → App Router 路由行为差异 | 页面导航/状态丢失 | 逐页面迁移+验证，保留 `packages/web` 直到所有页面确认正常 |
| Next.js 版本更新导致 standalone 行为变化 | 打包/部署中断 | 锁定 Next.js 主版本号 |
| 多进程共享 SQLite（Next.js + Connector Daemon） | 数据库锁冲突 | Core 已使用 WAL 模式，支持并发读写；验证高并发场景 |
| Node.js 二进制跨平台分发 | Desktop 构建复杂度 | 脚本化下载 + Tauri target triple 映射 |

---

## 8. 优势总结

| 方面 | 当前架构 | 新架构 |
|------|----------|--------|
| 组件数量 | 5 个（Core, Server, Web, CLI, Desktop） | 4 个（Core, Next.js, CLI, Desktop） |
| 依赖关系 | CLI → Server → Core（链式） | CLI → Core, Next.js → Core（扁平） |
| 部署单元 | 2 个（Server + Web） | 1 个（Next.js） |
| Desktop 链路 | Desktop → CLI → Server → Core | Desktop → Next.js → Core |
| Connector | 嵌入 Server，无法独立扩展 | 独立进程，可选部署 |
| AI SDK 集成 | 手动对接 `@ai-sdk/react` | Next.js 原生支持 |
