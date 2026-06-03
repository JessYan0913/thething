# Core 包 FileSystem 抽象设计方案

## 1. 问题

### 现象

Next.js 启动时抛出 `fs` 相关警告：

```
⚠ ./node_modules/@the-thing/core/src/primitives/parser/frontmatter.ts
Module not found: Can't resolve 'fs'
```

### 根因分析

**三因素叠加**：

1. **Barrel export 导致全量加载**：`packages/core/src/index.ts` 是一个巨大的 barrel file，re-export 了所有模块。`package.json` 的 `main` 直接指向 `./src/index.ts`（原始 TypeScript），没有 compiled output，没有 subpath exports。Bundler 必须处理整个文件。

2. **~63% 的 core 代码直接依赖 `fs`**：scanner、parser、memory、tools、mcp-config-store、global-config 等模块全部使用 `import fs from 'fs/promises'` 静态导入。Bundler 在打包阶段看到这些静态导入就发出警告。

3. **缺少 `server-only` 标记**：没有告诉 bundler 这些模块只在 server 端运行，bundler 按照 client bundle 兼容性来分析。

### 架构问题

core 作为库，混合了「领域逻辑」和「I/O 操作」：

| 模块 | 纯逻辑 | I/O 依赖 |
|------|--------|----------|
| session/ | ✅ | |
| compaction/ | ✅ | |
| agent-control/ | ✅ | |
| system-prompt/ | ✅ | |
| todos/ | ✅ | |
| model/ | ✅ | |
| clock/ | ✅ | |
| datastore/types | ✅ | |
| scanner/ | | ✅ fs.readdir/stat |
| parser/ | ✅ 纯函数部分 | ✅ 文件读取部分 |
| memory/ | ✅ 评分/类型 | ✅ 文件读写 |
| tools/ | | ✅ fs + child_process |
| mcp/ | | ✅ 网络 + fs |
| config/global-config | | ✅ fs.readFileSync |

这导致：
- core 无法在 Edge Runtime 或浏览器中运行
- 单元测试必须 mock `fs`
- Bundler 无法正确 tree-shake

---

## 2. 设计目标

1. **消除警告**：Bundler 不再在打包阶段看到 `fs` 的静态导入
2. **架构清晰**：core 的领域逻辑不直接依赖 Node.js I/O
3. **可测试**：fs 操作可替换（内存文件系统用于测试）
4. **渐进式**：分阶段实施，每步可验证可回退
5. **遵循现有模式**：与 `Clock` 接口、`DataStore` 接口保持一致

---

## 3. 方案设计

### 3.1 核心抽象：FileSystem 接口

**位置**：`packages/core/src/primitives/fs/types.ts`

```typescript
import type { Dirent } from 'fs';

export interface FileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  readdir(path: string, options?: { withFileTypes?: true }): Promise<Dirent[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  access(path: string): Promise<void>;
}

export interface SyncFileSystem {
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
```

### 3.2 实现层

**位置**：`packages/core/src/primitives/fs/`

```
primitives/fs/
├── types.ts          # FileSystem / SyncFileSystem 接口
├── node.ts           # 基于真实 fs 的实现（nodeFileSystem, nodeSyncFileSystem）
├── memory.ts         # 内存文件系统（用于测试）
└── index.ts          # 导出
```

`node.ts` 实现：

```typescript
import fs from 'fs/promises';
import fsSync from 'fs';
import type { FileSystem, SyncFileSystem } from './types';

export const nodeFileSystem: FileSystem = {
  readFile: (path, encoding) => fs.readFile(path, { encoding }),
  writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
  stat: (path) => fs.stat(path),
  readdir: (path, options) => fs.readdir(path, options),
  mkdir: (path, options) => fs.mkdir(path, options),
  unlink: (path) => fs.unlink(path),
  access: (path) => fs.access(path),
};

export const nodeSyncFileSystem: SyncFileSystem = {
  readFileSync: (path, encoding) => fsSync.readFileSync(path, { encoding }),
  writeFileSync: (path, data) => fsSync.writeFileSync(path, data, 'utf-8'),
  existsSync: (path) => fsSync.existsSync(path),
  mkdirSync: (path, options) => fsSync.mkdirSync(path, options),
};
```

### 3.3 改造方式：函数参数注入 + CoreRuntime 挂载

分两层注入：

- **core 内部**：通过函数参数和 `ModuleContext` 传递 fs
- **app 层**：通过 `CoreRuntime.fs` 统一获取，无需单独 import `nodeFileSystem`

#### 3.3.1 CoreRuntime 扩展

**改造后**（`composition/bootstrap.ts`）：

```typescript
import type { FileSystem, SyncFileSystem } from '../primitives/fs';
import { nodeFileSystem, nodeSyncFileSystem } from '../primitives/fs';

export interface CoreRuntime {
  // ... 现有字段
  layout: ResolvedLayout;
  dataStore: DataStore;
  connectorRegistry: ConnectorRegistry;
  // ...
  fs: FileSystem;         // 新增
  syncFs: SyncFileSystem; // 新增
  dispose(): Promise<void>;
}

export async function bootstrap(options?: BootstrapOptions): Promise<CoreRuntime> {
  // ... 现有逻辑

  return {
    // ... 现有字段
    fs: options?.fs ?? nodeFileSystem,
    syncFs: options?.syncFs ?? nodeSyncFileSystem,
    dispose: () => disposeRuntime(),
  };
}
```

`BootstrapOptions` 同步扩展：

```typescript
export interface BootstrapOptions {
  // ... 现有字段
  fs?: FileSystem;
  syncFs?: SyncFileSystem;
}
```

#### 3.3.2 parser 层改造

**改造前**（`frontmatter.ts`）：

```typescript
import fs from 'fs/promises';
import path from 'path';

export async function parseFrontmatterFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  // ...
}
```

**改造后**：

```typescript
// frontmatter.ts — 纯逻辑，零 fs 导入
import path from 'path';
import type { FileSystem } from '../fs';

export async function parseFrontmatterFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
  fs: FileSystem,  // 注入
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  // ...
}
```

#### 3.3.3 scanner 层改造

**改造后**（`scan.ts`）：

```typescript
// scan.ts — 移除动态 import workaround，改为参数注入
import type { FileSystem } from '../../primitives/fs';

export async function scanDir(
  dir: string,
  options: ScanOptions,
  fs: FileSystem,  // 注入
  source?: ConfigSource,
): Promise<ScanResult[]> {
  // ... 使用注入的 fs
}
```

#### 3.3.4 ModuleContext 扩展

**改造后**（`module-types.ts`）：

```typescript
import type { FileSystem, SyncFileSystem } from '../../primitives/fs';

export interface ModuleContext {
  cwd: string;
  configDirName: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  resourceDirs: ResourceDirs;
  fs: FileSystem;       // 新增
  syncFs: SyncFileSystem; // 新增（用于 global-config 等同步场景）
}
```

#### 3.3.5 loadAll 改造

```typescript
import { nodeFileSystem, nodeSyncFileSystem } from '../../primitives/fs';

export async function loadAll(options?: LoadAllOptions): Promise<LoadAllResult> {
  const fs = options?.fs ?? nodeFileSystem;
  const syncFs = options?.syncFs ?? nodeSyncFileSystem;

  const moduleContext: ModuleContext = {
    // ... 现有字段
    fs,
    syncFs,
  };

  // ... 后续不变
}
```

#### 3.3.6 App 层使用方式

**改造后**（`packages/app/lib/runtime.ts`）：

```typescript
// runtime.ts — CoreRuntime 已包含 fs，无需额外 import
import { bootstrap, createContext, ... } from '@the-thing/core';

async function initializeRuntime(): Promise<CoreRuntime> {
  runtime = await bootstrap({
    layout: { resourceRoot: process.cwd(), ... },
    // fs 会自动使用 nodeFileSystem，无需显式传入
  });
  // ...
}
```

**改造后**（API routes，以 `config/route.ts` 为例）：

```typescript
// config/route.ts — 从 runtime 获取 fs，不需要单独 import nodeFileSystem
import { getServerRuntime } from '@/lib/runtime';
import { loadGlobalConfig, saveGlobalConfig, getGlobalConfigPath } from '@the-thing/core';

export async function GET() {
  const rt = await getServerRuntime();
  const config = loadGlobalConfig(rt.fs);       // 通过 runtime.fs 传入
  return NextResponse.json({ config, path: getGlobalConfigPath() });
}

export async function POST(request: Request) {
  const rt = await getServerRuntime();
  const body = await request.json();
  saveGlobalConfig(body, rt.fs);                // 通过 runtime.fs 传入
  return NextResponse.json({ success: true });
}
```

**改造后**（`permissions/route.ts`）：

```typescript
import { getServerRuntime } from '@/lib/runtime';
import { saveRule, removeRule, loadRules, updateRule } from '@the-thing/core';

export async function GET() {
  const rt = await getServerRuntime();
  const config = await loadRules(rt.layout.resourceRoot, rt.fs);
  return NextResponse.json({ rules: config.rules });
}

export async function POST(request: Request) {
  const rt = await getServerRuntime();
  const body = await request.json();
  const rule = await saveRule(body, rt.layout.resourceRoot, rt.fs);
  return NextResponse.json({ success: true, rule });
}

export async function DELETE(request: Request) {
  const rt = await getServerRuntime();
  const id = new URL(request.url).searchParams.get('id');
  await removeRule(id!, rt.layout.resourceRoot, rt.fs);
  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  const rt = await getServerRuntime();
  const id = new URL(request.url).searchParams.get('id');
  const body = await request.json();
  const rule = await updateRule(id!, body, rt.layout.resourceRoot, rt.fs);
  return NextResponse.json(rule ? { success: true, rule } : { error: 'Not found' }, { status: rule ? 200 : 404 });
}
```

**关键点**：App 层已有的 `getServerRuntime()` 调用不需要改变获取方式，只是在调用 core I/O 函数时多传一个 `rt.fs` 参数。不需要单独 import `nodeFileSystem`。

### 3.4 改造范围

按优先级排序：

| 优先级 | 文件 | 改动 |
|--------|------|------|
| **P0: 基础设施** | | |
| P0 | `primitives/fs/` (新建) | 定义接口 + node 实现 + memory 实现 |
| P0 | `composition/bootstrap.ts` | CoreRuntime 加 `fs`/`syncFs` 字段，BootstrapOptions 加可选 fs |
| **P0: parser/scanner** | | |
| P0 | `primitives/parser/frontmatter.ts` | 移除 `import fs`，函数加 `fs` 参数 |
| P0 | `primitives/parser/json.ts` | 同上 |
| P0 | `primitives/parser/yaml.ts` | 同上 |
| P0 | `services/scanner/scan.ts` | 移除动态 import workaround，函数加 `fs` 参数 |
| P0 | `services/scanner/multi-source-loader.ts` | 透传 fs |
| **P1: loader 层** | | |
| P1 | `composition/loaders/module-types.ts` | ModuleContext 加 `fs`/`syncFs` 字段 |
| P1 | `composition/loaders/index.ts` | loadAll 传入 fs |
| P1 | `modules/skills/loader.ts` | 使用 ctx.fs |
| P1 | `modules/subagents/loader.ts` | 使用 ctx.fs |
| P1 | `modules/mcp/loader.ts` | 使用 ctx.fs |
| P1 | `modules/connector/loader-internal.ts` | 使用 ctx.fs |
| P1 | `modules/permissions/loader.ts` | 使用 ctx.fs |
| P1 | `composition/loaders/memory.ts` | 使用 ctx.fs |
| **P2: 剩余 I/O 模块** | | |
| P2 | `modules/mcp/mcp-config-store.ts` | 接受 fs 参数 |
| P2 | `modules/memory/memdir.ts` | 接受 fs 参数 |
| P2 | `modules/memory/memory-scan.ts` | 接受 fs 参数 |
| P2 | `services/config/global-config.ts` | 接受 syncFs 参数 |
| P2 | `modules/tools/read.ts`, `write.ts`, `edit.ts` | 接受 fs 参数 |
| P2 | `modules/tools/grep.ts`, `glob.ts` | 接受 fs 参数 |
| **P3: barrel export + App 层** | | |
| P3 | `index.ts` (barrel) | 分层导出 + I/O 函数改为 lazy import |
| P3 | `packages/app/app/api/config/route.ts` | 使用 `rt.fs` 调用 loadGlobalConfig/saveGlobalConfig |
| P3 | `packages/app/app/api/models/route.ts` | 使用 `rt.fs` 调用 loadGlobalConfig |
| P3 | `packages/app/app/api/chat/route.ts` | 使用 `rt.fs` 调用 loadGlobalConfig |
| P3 | `packages/app/app/api/agent-workbench/route.ts` | 使用 `rt.fs` 调用 loadGlobalConfig |
| P3 | `packages/app/app/api/skill-workbench/route.ts` | 使用 `rt.fs` 调用 loadGlobalConfig |
| P3 | `packages/app/app/api/permissions/route.ts` | 使用 `rt.fs` 调用 loadRules/saveRule/removeRule/updateRule |
| P3 | `packages/app/lib/runtime.ts` | bootstrap 无需改（默认注入 nodeFileSystem） |

### 3.5 barrel export 优化

**改造 `packages/core/package.json`**：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/index.types.ts",
    "./fs": "./src/primitives/fs/index.ts"
  }
}
```

**新建 `index.types.ts`**：只导出类型定义，不触发任何 I/O 模块加载。

**改造 `index.ts`**：将 I/O 相关导出改为 dynamic import：

```typescript
// 类型导出（静态，无 I/O）
export type { FileSystem, SyncFileSystem } from './primitives/fs';
export type { ... } from './composition/app/types';

// I/O 导出（懒加载）
export const loadAll = (...args) => import('./composition/loaders').then(m => m.loadAll(...args));
export const parseFrontmatterFile = (...args) => import('./primitives/parser').then(m => m.parseFrontmatterFile(...args));
```

或者更简洁：将 I/O 函数从 barrel 中移除，使用者改为从子路径导入：

```typescript
// 之前
import { loadAll, parseFrontmatterFile } from '@the-thing/core';

// 之后
import { loadAll } from '@the-thing/core/api';
import { parseFrontmatterFile } from '@the-thing/core/fs';
```

---

## 4. 实施阶段

### Phase 1: 基础设施 + CoreRuntime（~1.5h）

**目标**：定义 fs 接口，挂载到 CoreRuntime，改造 parser/scanner。

1. 创建 `primitives/fs/` 目录和接口定义
2. 创建 `nodeFileSystem` 实现
3. 改造 `composition/bootstrap.ts`：CoreRuntime 加 `fs`/`syncFs` 字段
4. 改造 `parser/frontmatter.ts`, `json.ts`, `yaml.ts`
5. 改造 `scanner/scan.ts`, `multi-source-loader.ts`
6. 改造 `loaders/module-types.ts` 加 fs 字段
7. 改造 `loaders/index.ts` 传入 fs
8. 验证：`npm run dev` 无警告

### Phase 2: 改造 loader 层（~2h）

**目标**：所有 loader 使用 ctx.fs 而非直接导入 fs。

1. 改造 `skills/loader.ts`
2. 改造 `subagents/loader.ts`
3. 改造 `mcp/loader.ts`
4. 改造 `connector/loader-internal.ts`
5. 改造 `permissions/loader.ts`
6. 改造 `composition/loaders/memory.ts`
7. 验证：所有 loader 功能正常

### Phase 3: 改造剩余 I/O 模块（~3h）

**目标**：所有 I/O 操作通过注入的 fs 执行。

1. 改造 `mcp/mcp-config-store.ts`
2. 改造 `memory/memdir.ts`, `memory-scan.ts`
3. 改造 `config/global-config.ts`（使用 syncFs）
4. 改造 `tools/read.ts`, `write.ts`, `edit.ts`, `grep.ts`, `glob.ts`
5. 验证：全部功能正常

### Phase 4: barrel export 优化 + App 层适配 + 测试（~2.5h）

**目标**：消除 barrel export 全量加载，适配 app 层调用方式。

1. 优化 `package.json` exports
2. 创建 `index.types.ts`
3. 重写 `index.ts` 的 I/O 导出为懒加载
4. 改造 App 层 API routes：使用 `rt.fs` 代替直接 import
   - `config/route.ts`（loadGlobalConfig/saveGlobalConfig）
   - `models/route.ts`（loadGlobalConfig）
   - `chat/route.ts`（loadGlobalConfig）
   - `agent-workbench/route.ts`（loadGlobalConfig）
   - `skill-workbench/route.ts`（loadGlobalConfig）
   - `permissions/route.ts`（loadRules/saveRule/removeRule/updateRule）
5. 创建 `createInMemoryFileSystem()` 用于测试
6. 编写 fs 抽象的单元测试
7. 验证：全量测试通过

---

## 5. 验证清单

- [ ] `npm run dev` 启动无 fs 警告
- [ ] `npm test` 全部通过
- [ ] 创建 agent 功能正常
- [ ] 加载 skills 功能正常
- [ ] MCP 连接功能正常
- [ ] 飞书 Connector 功能正常
- [ ] 权限管理（CRUD）功能正常
- [ ] Memory 加载功能正常
- [ ] 设置页配置读写正常（`/api/config`）
- [ ] 模型列表加载正常（`/api/models`）
- [ ] `createInMemoryFileSystem()` 可用于测试
- [ ] `pnpm typecheck` 通过
- [ ] core 中无 `import fs from 'fs'` 的静态导入（lint 规则）

---

## 6. 不动的部分

| 模块 | 原因 |
|------|------|
| `modules/tools/bash.ts` | 使用 `child_process`，非 fs 范畴 |
| `modules/mcp/registry.ts` | 网络 I/O（MCP 协议），非 fs 范畴 |
| `modules/connector/` 网络部分 | WebSocket 连接，非 fs 范畴 |
| `services/datastore/` | 已有 `DataStore` 接口，不在本次范围 |
| `modules/cron/` | SQLite 存储，不在本次范围 |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 函数签名变更导致大量调用点修改 | 优先级从 P0-P3 分批改，每批验证 |
| 性能影响（多一层抽象） | 接口调用开销可忽略（fs I/O 本身是瓶颈） |
| 遗漏某个 fs 导入 | 编写 lint 规则禁止 core 中 `import fs` |
| 动态 import 的 barrel export 可能影响 tree-shaking | Phase 4 中用 subpath exports 替代 |
