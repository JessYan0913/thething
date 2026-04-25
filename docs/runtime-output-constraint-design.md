# 运行时输出约束设计

> 解决 Agent 自主写入文件"乱写"问题，为 CLI 和 Server 场景提供统一的过程数据约束机制

## 文档信息

- **创建日期**: 2026-04-25
- **问题背景**: 
  - 同事将 core 移植到 ai-chatbot 后发现：放开写入权限后 Agent 会在各层级目录随意写文件
  - ai-chatbot 使用 Sandbox 外部沙箱服务隔离，但 thething 需考虑 CLI 本地执行场景
- **参考方案**: 
  - ai-chatbot sime-api 的 Sandbox + Artifact Registry 机制
  - Claude Code 的 `.claude/` 目录隔离实践

---

## 1. 问题分析

### 1.1 当前现状

| 场景 | 工作目录 | 数据目录 | Agent 写入行为 | 问题 |
|------|----------|----------|---------------|------|
| **CLI** | 用户当前项目目录 | `~/.thething/data/` | 直接写入本地文件系统 | 无约束，可能污染用户项目 |
| **Server/Web** | Server 项目目录 | `.thething/data/` | 直接写入本地文件系统 | 同 CLI，可能污染项目结构 |

### 1.2 ai-chatbot 的解决方案

ai-chatbot 使用外部 Sandbox 服务：

```
Sandbox 类 (lib/common/utils/sandbox.ts)
├── 初始化沙箱环境 (sessionId 隔离)
├── run() 执行命令
├── readFile() 读取文件
└── writeToSandbox() 写入文件
```

写入路径规则：
- 有 skill: `{skillName}/outputs/{fileName}.{ext}`
- 无 skill: `workspace/outputs/{fileName}.{ext}`

### 1.3 thething 的差异

| 特性 | ai-chatbot | thething (当前) |
|------|------------|----------------|
| **隔离方式** | 外部 Sandbox 服务 | 直接本地文件系统 |
| **写入位置** | sandbox 虚拟环境 | 无约束 |
| **CLI 支持** | ❌ 需外部服务 | ✅ 天然支持本地执行 |
| **产物追踪** | Artifact Registry | 无 |

**核心问题**: thething 直接操作本地文件，需要路径约束而非沙箱隔离。

---

## 2. 设计目标

### 2.1 核心目标

1. **约束 Agent 自主写入**: 所有 Agent 自主产生的过程数据写入指定目录
2. **保留用户意图写入**: 用户明确要求的文件操作（如创建代码文件）仍可写入项目目录
3. **CLI 和 Server 统一**: 两种场景使用相同的约束机制
4. **产物可追踪**: 建立 Artifact Registry 记录所有写入文件

### 2.2 区分写入意图

| 意图类型 | 定义 | 目标位置 | 审批策略 |
|----------|------|----------|----------|
| **user-request** | 用户明确请求的文件操作（如"创建 README.md"） | 用户指定路径 | 正常审批流程 |
| **agent-generated** | Agent 自主产生的中间数据、产物文件 | `.thething/runtime/outputs/` | 自动放行（或简化审批） |

---

## 3. Runtime 目录结构设计

### 3.1 目录结构

```
.thething/
├── runtime/                     # 运行时过程数据目录
│   ├── outputs/                 # Agent 产物文件
│   │   ├── {conversationId}/    # 按对话隔离
│   │   │   ├── artifacts/       # 工具产物（JSON、CSV 等）
│   │   │   ├── exports/         # 导出文件（Markdown、HTML 等）
│   │   │   └── temp/            # 临时文件（对话结束后可清理）
│   │   └── shared/              # 跨对话共享产物（可选）
│   ├── cache/                   # 缓存数据
│   │   ├── skills/              # Skill 加载缓存
│   │   ├── models/              # 模型响应缓存
│   │   └── search/              # 搜索结果缓存
│   └── logs/                    # 运行日志
│       ├── agent-{date}.log     # Agent 执行日志
│       └── tool-{date}.log      # 工具调用日志
├── data/                        # 持久化数据（已有）
│   ├── chat.db                  # 对话数据
│   ├── memory/                  # 记忆数据
│   └── connectors/              # Connector 凭证
└── settings.json                # 配置文件（已有）
```

### 3.2 CLI 与 Server 的路径差异

| 场景 | runtime 目录位置 | 说明 |
|------|-----------------|------|
| **CLI** | `~/.thething/runtime/` | 全局目录，所有项目共用 |
| **Server** | `{projectDir}/.thething/runtime/` | 项目目录内 |

**设计决策**: 
- CLI 使用全局目录避免污染用户项目
- Server 使用项目目录便于多实例部署

---

## 4. 核心模块设计

### 4.1 RuntimeDir 模块

位置: `packages/core/src/runtime/runtime-dir.ts`

```typescript
import os from 'os'
import path from 'path'
import fs from 'fs'

export interface RuntimeDirConfig {
  /** 运行时目录根路径 */
  runtimeDir: string
  /** 当前对话的产物目录 */
  outputsDir: string
  /** 缓存目录 */
  cacheDir: string
  /** 临时目录 */
  tempDir: string
  /** 日志目录 */
  logsDir: string
}

/**
 * 获取运行时目录配置
 * 
 * CLI: ~/.thething/runtime/
 * Server: {projectDir}/.thething/runtime/
 */
export function getRuntimeDirConfig(
  projectDir?: string,
  conversationId?: string
): RuntimeDirConfig {
  // CLI 模式：使用全局目录
  const baseDir = projectDir 
    ? path.join(projectDir, '.thething', 'runtime')
    : path.join(os.homedir(), '.thething', 'runtime')
  
  // 按对话隔离产物目录
  const outputsBase = path.join(baseDir, 'outputs')
  const outputsDir = conversationId 
    ? path.join(outputsBase, conversationId)
    : outputsBase
  
  return {
    runtimeDir: baseDir,
    outputsDir,
    cacheDir: path.join(baseDir, 'cache'),
    tempDir: path.join(baseDir, 'temp'),
    logsDir: path.join(baseDir, 'logs'),
  }
}

/**
 * 确保运行时目录存在
 */
export function ensureRuntimeDirs(config: RuntimeDirConfig): void {
  fs.mkdirSync(config.outputsDir, { recursive: true })
  fs.mkdirSync(config.cacheDir, { recursive: true })
  fs.mkdirSync(config.tempDir, { recursive: true })
  fs.mkdirSync(config.logsDir, { recursive: true })
}

/**
 * 检查路径是否在运行时目录内
 */
export function isWithinRuntimeDir(
  filePath: string, 
  projectDir?: string
): boolean {
  const config = getRuntimeDirConfig(projectDir)
  const resolved = path.resolve(filePath)
  return resolved.startsWith(config.runtimeDir)
}

/**
 * 生成运行时产物路径
 */
export function generateRuntimeOutputPath(
  fileName: string,
  ext: string,
  options?: {
    conversationId?: string
    projectDir?: string
    subDir?: 'artifacts' | 'exports' | 'temp'
  }
): string {
  const config = getRuntimeDirConfig(options?.projectDir, options?.conversationId)
  const targetDir = options?.subDir 
    ? path.join(config.outputsDir, options.subDir)
    : config.outputsDir
  
  // 清理文件名
  const cleanName = fileName.replace(/\.(json|txt|md|csv|xml|log|html)$/i, '')
  
  return path.join(targetDir, `${cleanName}.${ext}`)
}
```

### 4.2 Write 工具改造

位置: `packages/core/src/runtime/tools/write.ts`

```typescript
import { tool } from 'ai'
import * as fs from 'fs/promises'
import * as path from 'path'
import { z } from 'zod'
import { checkPermissionRules, validateWritePath } from '../permissions'
import { getRuntimeDirConfig, isWithinRuntimeDir, generateRuntimeOutputPath } from '../runtime-dir'

// 新增写入意图枚举
const WriteIntentSchema = z.enum(['user-request', 'agent-generated'])
  .optional()
  .default('agent-generated')
  .describe('写入意图: user-request（用户请求）或 agent-generated（Agent 自主生成）')

export const writeFileTool = tool({
  description: '创建或覆盖文件内容。支持两种写入意图：用户请求写入和 Agent 自主生成。',
  inputSchema: z.object({
    filePath: z.string().describe('目标文件路径'),
    content: z.string().describe('要写入的文件内容'),
    mode: z.enum(['overwrite', 'create', 'append'])
      .optional()
      .default('overwrite'),
    intent: WriteIntentSchema,
  }),
  
  needsApproval: async ({ filePath, intent }) => {
    // Step 1: 检查持久化规则
    const matchedRule = checkPermissionRules('write_file', { filePath })
    if (matchedRule?.behavior === 'allow') {
      return false
    }
    if (matchedRule?.behavior === 'deny') {
      return true
    }
    
    // Step 2: 根据意图判定
    if (intent === 'agent-generated') {
      // Agent 自主写入：检查是否在 runtime 目录内
      if (isWithinRuntimeDir(filePath)) {
        return false  // runtime 目录内自动放行
      }
      // 不在 runtime 目录：需要审批（实际上可能被拒绝）
      return true
    }
    
    // Step 3: 用户请求写入：正常审批流程
    return true
  },
  
  execute: async ({ filePath, content, mode, intent }) => {
    // 获取 session state（从执行上下文）
    const sessionState = getExecutionContext()?.sessionState
    const projectDir = sessionState?.projectDir
    const conversationId = sessionState?.conversationId
    
    let targetPath = filePath
    
    // Agent 自主写入：重定向到 runtime 目录
    if (intent === 'agent-generated' && !isWithinRuntimeDir(filePath, projectDir)) {
      const ext = path.extname(filePath).slice(1) || 'txt'
      const fileName = path.basename(filePath, path.extname(filePath))
      
      targetPath = generateRuntimeOutputPath(fileName, ext, {
        conversationId,
        projectDir,
        subDir: 'artifacts',
      })
      
      console.log(`[Write] Redirected agent output to: ${targetPath}`)
    }
    
    // 路径安全检查
    const pathCheck = validateWritePath(targetPath, {
      intent,
      projectDir,
    })
    
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
        actualPath: targetPath,
      }
    }
    
    // 执行写入
    const absolutePath = path.resolve(targetPath)
    const dir = path.dirname(absolutePath)
    
    await fs.mkdir(dir, { recursive: true })
    
    // ... 写入逻辑（与现有实现相同）
    
    return {
      path: filePath,
      actualPath: targetPath,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      mode,
      intent,
      redirected: targetPath !== filePath,
    }
  },
})
```

### 4.3 Path Validation 增强

位置: `packages/core/src/extensions/permissions/path-validation.ts`

```typescript
/**
 * 验证写入路径（增强版）
 */
export function validateWritePath(
  filePath: string,
  options?: {
    workingDir?: string
    intent?: 'user-request' | 'agent-generated'
    projectDir?: string
  }
): PathValidationResult {
  const { intent = 'agent-generated', workingDir, projectDir } = options ?? {}
  const cwd = workingDir || process.cwd()
  const resolved = path.resolve(filePath)
  
  // 1. 基础安全检查（shell 注入、敏感路径）
  const baseCheck = validatePath(filePath, cwd)
  if (!baseCheck.allowed) return baseCheck
  
  // 2. Agent 自主写入：必须写入 runtime 目录
  if (intent === 'agent-generated') {
    if (!isWithinRuntimeDir(filePath, projectDir)) {
      return {
        allowed: false,
        reason: 'Agent 自主写入必须写入运行时目录（.thething/runtime/）。如需写入其他位置，请明确告知用户。',
        resolvedPath: resolved,
      }
    }
    return { allowed: true, resolvedPath: resolved }
  }
  
  // 3. 用户请求写入：允许写入项目目录（仍有敏感路径保护）
  return { allowed: true, resolvedPath: resolved }
}
```

### 4.4 Session State 扩展

位置: `packages/core/src/runtime/session-state/state.ts`

```typescript
import { RuntimeDirConfig, getRuntimeDirConfig, ensureRuntimeDirs } from '../runtime-dir'

export interface SessionState {
  // ... 现有字段
  
  /** 运行时目录配置 */
  runtimeDir: RuntimeDirConfig
  
  /** 项目目录（用于约束写入） */
  projectDir?: string
  
  /** 对话 ID */
  conversationId: string
}

export function createSessionState(
  conversationId: string,
  options?: {
    projectDir?: string
    maxContextTokens?: number
    // ...
  }
): SessionState {
  const runtimeDir = getRuntimeDirConfig(options?.projectDir, conversationId)
  ensureRuntimeDirs(runtimeDir)
  
  return {
    conversationId,
    runtimeDir,
    projectDir: options?.projectDir,
    // ... 其他字段
  }
}
```

---

## 5. Artifact Registry 设计

### 5.1 产物注册机制

参考 ai-chatbot 的设计，建立产物追踪系统。

位置: `packages/core/src/runtime/artifact-registry.ts`

```typescript
export interface ArtifactEntry {
  /** 产物唯一标识 */
  key: string
  /** 实际存储路径 */
  filePath: string
  /** 原始请求路径（可能被重定向） */
  requestedPath?: string
  /** 所属对话 ID */
  conversationId: string
  /** 所属 Skill（可选） */
  skillName?: string
  /** 简短摘要 */
  summary: string
  /** 产出此产物的工具名 */
  toolName: string
  /** 写入时间戳 */
  createdAt: number
  /** 文件 MIME 类型 */
  mimeType: string
  /** 文件大小（字节） */
  sizeBytes: number
}

/** Artifact Registry 存储在 WorkingMemory 或文件中 */
const ARTIFACT_REGISTRY_KEY = 'artifactRegistry'

/**
 * 注册产物
 */
export async function registerArtifact(
  entry: ArtifactEntry,
  conversationId: string
): Promise<void> {
  // 存储到 session working memory 或 JSON 文件
  const registryPath = path.join(
    getRuntimeDirConfig(undefined, conversationId).outputsDir,
    'artifacts.json'
  )
  
  // 读取现有注册表
  let registry: ArtifactEntry[] = []
  try {
    const content = await fs.readFile(registryPath, 'utf-8')
    registry = JSON.parse(content)
  } catch {
    registry = []
  }
  
  // 添加或更新
  const existingIndex = registry.findIndex(e => e.key === entry.key)
  if (existingIndex >= 0) {
    registry[existingIndex] = entry
  } else {
    registry.push(entry)
  }
  
  // 写回
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
}

/**
 * 获取对话的所有产物
 */
export async function getArtifacts(
  conversationId: string
): Promise<ArtifactEntry[]> {
  const registryPath = path.join(
    getRuntimeDirConfig(undefined, conversationId).outputsDir,
    'artifacts.json'
  )
  
  try {
    const content = await fs.readFile(registryPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

/**
 * 格式化产物列表（用于注入 prompt）
 */
export function formatArtifactsForPrompt(artifacts: ArtifactEntry[]): string {
  if (artifacts.length === 0) return '（无前序产出）'
  
  return artifacts
    .map(a => `• [${a.key}] ${a.summary}\n  path: ${a.filePath}`)
    .join('\n')
}
```

---

## 6. 系统提示词更新

### 6.1 增加写入约束说明

位置: `packages/core/src/extensions/system-prompt/sections/rules.ts`

```typescript
const WRITE_CONSTRAINT_RULE = `
## 文件写入约束

当你需要自主生成产物文件时：
- 必须写入运行时目录：.thething/runtime/outputs/
- 产物类型包括：分析报告、数据导出、中间结果等
- 系统会自动重定向你的写入请求

当用户明确请求写入特定位置时：
- 使用 intent='user-request' 标记
- 可以写入用户指定的任意位置（需审批）
- 例如："帮我创建一个 README.md 在当前目录"

产物文件会在对话结束后保留在：
- CLI: ~/.thething/runtime/outputs/{conversationId}/
- Server: .thething/runtime/outputs/{conversationId}/
`
```

---

## 7. 使用示例

### 7.1 CLI 场景

```bash
# 用户请求写入（明确指定路径）
> 帮我在当前目录创建一个 README.md
# intent: 'user-request', filePath: './README.md'
# ✅ 写入用户项目目录（需审批）

# Agent 自主写入（产物文件）
> 分析这个数据并生成报告
# Agent 内部调用: write_file({ 
#   filePath: 'analysis-report.md', 
#   intent: 'agent-generated' 
# })
# 实际写入: ~/.thething/runtime/outputs/{convId}/artifacts/analysis-report.md
# ✅ 自动写入 runtime 目录，无需审批
```

### 7.2 Server/Web 场景

```typescript
// 用户请求写入项目代码
// intent: 'user-request' → .thething/settings.json ❌（敏感路径）
// intent: 'user-request' → src/utils/helper.ts ✅（需审批）

// Agent 自主写入产物
// intent: 'agent-generated' → .thething/runtime/outputs/{convId}/result.json ✅
```

---

## 8. 与 ai-chatbot Sandbox 对比

| 特性 | thething (本方案) | ai-chatbot Sandbox |
|------|-------------------|---------------------|
| **隔离方式** | 路径约束 + 目录隔离 | 外部沙箱服务 |
| **写入位置** | `.thething/runtime/` | sandbox 虚拟环境 |
| **用户文件修改** | 允许（需审批 + intent标记） | 需同步到本地 |
| **CLI 支持** | ✅ 天然支持 | ❌ 需外部服务 |
| **产物追踪** | Artifact Registry（JSON 文件） | Artifact Registry（WorkingMemory） |
| **跨对话共享** | ✅ runtime/outputs/shared/ | ❌ sessionId 隔离 |

---

## 9. 实施计划

### Phase 1: 基础约束

| 任务 | 文件 | 说明 |
|------|------|------|
| RuntimeDir 模块 | `runtime/runtime-dir.ts` | 目录管理和路径检查 |
| Session State 扩展 | `runtime/session-state/state.ts` | 添加 runtimeDir 字段 |
| Write 工具改造 | `runtime/tools/write.ts` | 添加 intent 参数和重定向 |

### Phase 2: 产物追踪

| 任务 | 文件 | 说明 |
|------|------|------|
| Artifact Registry | `runtime/artifact-registry.ts` | 产物注册和查询 |
| 系统提示词更新 | `extensions/system-prompt/sections/rules.ts` | 增加写入约束说明 |

### Phase 3: 清理机制

| 任务 | 文件 | 说明 |
|------|------|------|
| 临时文件清理 | `runtime/runtime-cleaner.ts` | 对话结束后的 temp 清理 |
| 缓存过期 | `runtime/cache-manager.ts` | 缓存 TTL 管理 |

---

## 10. 安全底线

以下规则任何情况下不可绕过：

1. **敏感路径保护**: `.git/`, `.env`, `.thething/settings.json` 等不可写入
2. **Shell 注入阻止**: `$VAR`, `%VAR%`, `~user`, `` `cmd` `` 等语法
3. **Agent 自主写入约束**: `intent='agent-generated'` 必须写入 runtime 目录

---

## 11. 总结

本设计通过"意图区分"机制解决 Agent 乱写文件问题：

1. **用户意图写入**: 允许写入用户指定位置（需审批）
2. **Agent 自主写入**: 自动重定向到 `.thething/runtime/outputs/`

方案优势：
- CLI 和 Server 统一机制
- 无需外部 Sandbox 服务
- 保留产物追踪能力
- 用户项目目录不被污染