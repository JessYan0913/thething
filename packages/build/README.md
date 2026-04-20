# @the-thing/build

构建工具包，用于生成跨平台可移植可执行文件。

## 功能

- SEA (Single Executable Application) 构建
- 原生模块 (better-sqlite3) 跨平台编译
- 可移植目录组装

## 支持平台

- `darwin-arm64` - macOS ARM64
- `darwin-x64` - macOS x64
- `win32-x64` - Windows x64
- `linux-x64` - Linux x64

## 使用方式

### 命令行

```bash
# 构建当前平台
pnpm build:portable

# 构建 macOS ARM64
pnpm build:portable:macos

# 构建 Windows x64
pnpm build:portable:win
```

### API

```typescript
import { buildPortable, getPlatformConfig } from '@the-thing/build'

// 获取平台配置
const config = getPlatformConfig('darwin-arm64')

// 构建可移植应用
await buildPortable('darwin-arm64')
```

## 构建流程

1. **SEA 构建** - 使用 Node.js SEA 功能生成可执行文件
2. **原生模块编译** - 为目标平台编译 better-sqlite3
3. **目录组装** - 打包所有资源到可移植目录

## 输出目录结构

```
dist/portable/<platform>/
├── thething.exe      # 可执行文件
├── node_modules/     # 原生模块
└── resources/        # 资源文件
```

## 依赖

- `esbuild` - JavaScript 打包器