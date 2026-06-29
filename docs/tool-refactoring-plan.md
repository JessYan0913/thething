# 内置工具重构计划：对标 pi 实现质量

> 基于 [pi-comparison.md](pi-comparison.md) 的深入分析，针对 thething 内置工具的重构方案。
> 目标：在不破坏现有接口和功能的前提下，将工具实现质量提升至 pi 的水平。

---

## 一、现状评估

### 当前工具实现质量评分

| 工具 | 当前评级 | 核心问题 |
|------|---------|---------|
| edit | ⚠️ 差 | 无 BOM/CRLF 处理、无 diff 预览、无文件变异队列、replace() 单次匹配 |
| read | ⚠️ 及格 | 无语法高亮、无图片处理、无 Operations 接口 |
| write | ⚠️ 及格 | `created` 标志不可靠、无原子写入、无 Operation 接口 |
| bash | ✅ 良好 | 三阶段安全、AbortSignal、进程树清理，但无流式输出 |
| grep | ✅ 良好 | ripgrep + Node fallback、context 支持 |
| glob | ❓ 未审 | — |

### 核心差距总结

**架构层缺失：**
1. 无 Pluggable Operations 接口（工具不可扩展、不可测试）
2. 无 Tool Definition / Instance 分离（描述、权限、执行耦合）
3. 无文件变异队列（对同一文件的并发写入无保护）
4. 无 AbortSignal 在 read/edit/write 中的集成

**实现层缺失：**
1. BOM 头和 CRLF/LF 行尾未处理
2. Edit 无 diff 预览，AI 无法验证改动
3. Read 无语法高亮、无图片支持
4. Bash 使用 `exec()` 缓冲输出而非流式

---

## 二、目标架构

### 新增：Operations 接口层

每个工具引入 Pluggable Operations 接口，将底层 I/O 与工具逻辑分离：

```typescript
// 之前：硬编码 fs 调用
export function createReadFileTool(options) {
  return tool({
    execute: async ({ filePath }) => {
      const content = await fs.readFile(absolutePath, 'utf-8');  // 硬编码
    }
  });
}

// 之后：可插拔
export interface ReadFileOperations {
  readFile(absolutePath: string): Promise<Buffer>;
  access(absolutePath: string): Promise<void>;
  detectImageMimeType?(absolutePath: string): Promise<string | null>;
}

export function createReadFileTool(options: {
  operations?: ReadFileOperations;  // 可注入
  cwd?: string;
  permissionRules?: readonly PermissionRule[];
}) { ... }
```

**好处：**
- 可测试（注入 mock operations）
- 可扩展（SSH、WebDAV 等远程 I/O）
- 不破坏现有使用方式（默认使用本地 fs）

### 新增：Tool Definition / Instance 分离

```typescript
// ToolDefinition：描述、schema、执行、渲染
export interface ToolDefinition<TSchema, TDetails> {
  name: string;
  description: string;
  promptSnippet: string;           // 用于系统提示词的一句话描述
  promptGuidelines: string[];       // 用于系统提示词的使用指南
  parameters: TSchema;
  execute: (input, signal, ctx) => Promise<Result<TDetails>>;
  renderCall?: (args, theme, ctx) => Component;
  renderResult?: (result, options, theme, ctx) => Component;
}

// Tool：最终注入到 Vercel AI SDK 的实例
export type Tool = AgentTool<any>;  // wrapToolDefinition() 转换
```

**好处：**
- 系统提示词生成时从 `promptSnippet` + `promptGuidelines` 自动构建工具列表
- 类似 pi 的 `toolSnippets` —— 不再需要手动在 buildSystemPrompt 中写工具描述

### 新增：文件变异队列

```typescript
// 对同一文件的写入操作串行化，防止并发冲突
const mutationQueues = new Map<string, Promise<void>>();

async function withFileMutationQueue<T>(
  absolutePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = mutationQueues.get(absolutePath) ?? Promise.resolve();
  const next = existing.then(fn, fn);  // 即使前一个失败也继续
  mutationQueues.set(absolutePath, next);
  return next;
}
```

---

## 三、分阶段实施计划

### Phase 1：Edit 工具重构（最高优先级，预估 2-3 天）

Edit 工具是差距最大、影响最直接的。AI 编辑文件时如果因为 BOM/CRLF 匹配失败，用户体验极差。

#### 1.1 引入 BOM 和行尾处理

```typescript
// 新工具函数模块：packages/core/src/modules/tools/utils/text.ts

/** 剥离 UTF-8 BOM */
export function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xFEFF) {
    return { bom: '﻿', text: content.slice(1) };
  }
  return { bom: '', text: content };
}

/** 检测行尾风格 */
export function detectLineEnding(content: string): '\n' | '\r\n' | 'mixed' {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  if (crlfCount > 0 && lfCount === 0) return '\r\n';
  if (lfCount > 0 && crlfCount === 0) return '\n';
  return 'mixed';
}

/** 标准化为 LF */
export function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/** 恢复行尾风格 */
export function restoreLineEndings(content: string, ending: '\n' | '\r\n' | 'mixed'): string {
  if (ending === '\r\n') {
    return content.replace(/\n/g, '\r\n');
  }
  return content;
}
```

#### 1.2 引入文件变异队列

```typescript
// 新文件：packages/core/src/modules/tools/utils/file-mutation-queue.ts

const mutationQueues = new Map<string, Promise<unknown>>();

export function withFileMutationQueue<T>(
  absolutePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = mutationQueues.get(absolutePath) ?? Promise.resolve();
  const next = existing.then(fn).catch(() => fn());
  mutationQueues.set(absolutePath, next);
  return next;
}

/** 清理不再需要的队列 */
export function cleanupMutationQueues(): void {
  mutationQueues.clear();
}
```

#### 1.3 引入 Diff 预览

```typescript
// 生成 unified diff 格式供 AI 消费
export function generateUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string,
): UnifiedDiff {
  const lines = diff(originalContent, newContent);
  return {
    diff: formatUnifiedDiff(lines),
    firstChangedLine: findFirstChangedLine(lines),
    /** 改动的文本描述（非 diff，供 AI 快速理解） */
    summary: generateEditSummary(lines),
  };
}
```

#### 1.4 重写 Edit 工具

```typescript
// 重构后的核心逻辑

export function createEditFileTool(options: EditFileToolOptions = {}) {
  const ops = options.operations ?? defaultEditOperations;

  return tool({
    description: 'Edit a file using exact text replacement...',
    inputSchema: editSchema,
    execute: async ({ filePath, edits }, execOptions) => {
      const absolutePath = resolveToCwd(filePath, options.cwd);

      return withFileMutationQueue(absolutePath, async () => {
        // 1. 读取并预处理
        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);

        // 2. 验证 edits（所有匹配基于原始内容）
        validateEdits(normalizedContent, edits);

        // 3. 应用 edits
        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent, edits, filePath,
        );

        // 4. 恢复行尾 + BOM 后写回
        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await ops.writeFile(absolutePath, finalContent);

        // 5. 生成 diff 返回
        const diff = generateUnifiedDiff(filePath, baseContent, newContent);
        return { path: filePath, editsApplied: edits.length, ...diff };
      });
    },
  });
}
```

**改动范围：**
- 新增：`packages/core/src/modules/tools/utils/text.ts`
- 新增：`packages/core/src/modules/tools/utils/file-mutation-queue.ts`
- 新增：`packages/core/src/modules/tools/utils/diff.ts`
- 重写：`packages/core/src/modules/tools/edit.ts`

---

### Phase 2：Read 工具重构（中优先级，预估 2 天）

#### 2.1 引入 Operations 接口

```typescript
export interface ReadFileOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null>;
}
```

#### 2.2 引入图片检测和处理

```typescript
// 检测图片 MIME 类型（非侵入，仅文件头部检测）
const IMAGE_MAGIC_BYTES: Record<string, string[]> = {
  'image/png': ['89504E47'],
  'image/jpeg': ['FFD8FF'],
  'image/gif': ['47494638'],
  'image/webp': ['52494646'],
  'image/bmp': ['424D'],
};

export async function detectImageMimeType(
  absolutePath: string,
): Promise<string | null> { ... }
```

#### 2.3 引入语法高亮（增量，非侵入）

不需要引入完整的高亮引擎。在 read 工具的结果中加入 `language` 和 `codeFence` 标记，让下游渲染器（前端 / CLI）决定是否高亮：

```typescript
// 在 read 结果中加入代码围栏标记
const language = getLanguageFromPath(filePath);
const content = language
  ? `\`\`\`${language}\n${numberedContent}\n\`\`\``
  : numberedContent;
```

**影响：** 零额外依赖，只修改输出格式。但目前 thething 的输出是纯 JSON 给 AI 的，加 markdown 围栏可以让 AI 更容易识别代码块。

**改动范围：**
- 修改：`packages/core/src/modules/tools/read.ts`
- 新增：`packages/core/src/modules/tools/utils/image.ts`（图片检测）

---

### Phase 3：Bash 工具流式输出（中优先级，预估 2-3 天）

#### 3.1 从 `exec()` 迁移到 `spawn()`

```typescript
// 当前：child_process.exec（全缓冲）
const { stdout, stderr } = await execAsync(command, { cwd, timeout });

// 目标：child_process.spawn（流式）
function spawnWithStreaming(
  command: string,
  options: { cwd: string; signal?: AbortSignal; timeout?: number },
): Promise<BashResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, signal: options.signal });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // 可选：向 session 发送部分结果通知
      options.onPartialOutput?.(chunk.toString());
    });
    
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}
```

#### 3.2 引入 BashSpawnHook

```typescript
export interface BashSpawnHook {
  (command: string, context: BashSpawnContext): 
    BashSpawnContext | Promise<BashSpawnContext>;
}
```

钩子可以在命令执行前修改命令、注入环境变量、记录审计日志等。

**改动范围：**
- 重写：`packages/core/src/modules/tools/bash.ts`

---

### Phase 4：Tool Definition 抽象层（低优先级，但架构收益大，预估 3 天）

#### 4.1 定义核心类型

```typescript
// packages/core/src/modules/tools/types.ts

export interface ToolDefinition<
  TInput = unknown,
  TOutput = unknown,
  TState = unknown,
> {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: z.ZodType<TInput>;
  execute: (
    toolCallId: string,
    input: TInput,
    signal?: AbortSignal,
    onUpdate?: (partial: Partial<TOutput>) => void,
    ctx?: ExecutionContext,
  ) => Promise<{ content: ToolContent[]; details?: TOutput }>;
  prepareArguments?: (input: unknown) => TInput;
}
```

#### 4.2 自动生成系统提示词

```typescript
// 在 loadAllTools 中收集所有工具的 promptSnippet 和 promptGuidelines
// 自动生成系统提示词中的工具描述部分

function buildToolDescriptions(tools: ToolDefinition[]): string {
  return tools.map(t => `- ${t.name}: ${t.promptSnippet}`).join('\n');
}

function buildToolGuidelines(tools: ToolDefinition[]): string[] {
  return tools.flatMap(t => t.promptGuidelines);
}
```

对比现在的系统提示词生成方式——每个工具的描述散落在 builder.ts 中，工具定义变化时需要同步修改 system prompt。自动生成后消除了这个维护点。

**改动范围：**
- 新增：`packages/core/src/modules/tools/types.ts`
- 新增：`packages/core/src/modules/tools/tool-definition-wrapper.ts`
- 修改：`packages/core/src/modules/tools/index.ts`
- 修改：`packages/core/src/modules/tools/*.ts`（每个工具增加 Definition 导出）

---

## 四、兼容性策略

### 不要做的事

1. **不改变现有工具名称** —— `read_file`, `edit_file`, `write_file`, `bash`, `grep` 等名称维持不变
2. **不改变返回格式** —— 新字段只能新增，不可移除或重命名旧字段
3. **不改变 `loadAllTools()` 的调用签名** —— 外围调用代码不需要修改
4. **不做 TUI 渲染** —— thething 的 core 是 headless 的，渲染在 app/cli 层处理

### 向后兼容做法

```typescript
// 每个工具保留旧接口作为默认实现
export function createReadFileTool(options: FileToolOptions = {}) {
  // 内部使用新架构，但对外保持相同签名和返回格式
  const definition = createReadFileToolDefinition(options.cwd ?? '', {
    operations: options.operations,
    ...options,
  });
  return wrapToolDefinition(definition);
}

// 高级用户可跳过 wrap，直接使用 Definition
export { createReadFileToolDefinition };
```

---

## 五、实施时间线

| 阶段 | 内容 | 预估工时 | 影响范围 |
|------|------|---------|---------|
| **Phase 1** | Edit 重构（BOM/CRLF/Queue/Diff） | 2-3 天 | edit.ts + 3 个新工具 utils 文件 |
| **Phase 2** | Read 重构（Operations/图片/高亮） | 2 天 | read.ts + 1 个新 utils 文件 |
| **Phase 3** | Bash 流式输出 | 2-3 天 | bash.ts |
| **Phase 4** | Tool Definition 抽象层 | 3 天 | 9 个工具文件 + types.ts + wrapper |
| **总计** | | **9-11 天** | |

### 建议优先级

**Phase 1（Edit）> Phase 2（Read）> Phase 3（Bash）> Phase 4（抽象层）**

Edit 工具的用户影响最大（AI 编辑文件失败是高频痛点），实现难度最低（新文件不破坏现有逻辑），应优先做。

Phase 4（抽象层）虽然架构收益大，但涉及所有工具文件的统一改动，可以在前三个 Phase 建立信心后实施。

---

## 六、实施中的风险和对策

### 风险 1：BOM/CRLF 处理导致字符不一致
**对策：** 在 `stripBom` 和 `normalizeToLF` 之后，用 `diff` 验证原始内容和处理后的内容只在 BOM/行尾上有差异。单元测试覆盖三到四个场景（无 BOM + LF、有 BOM + CRLF、混合、纯 CR）。

### 风险 2：文件变异队列引入死锁
**对策：** 队列只对**同一文件路径**串行化，不同文件互不影响。超时保护（`Promise.race` 加上时限）。

### 风险 3：流式 bash 改变现有返回格式
**对策：** 维持最终返回 `{ stdout, stderr, exitCode, command, duration }` 不变。流式只作为中间通知机制（通过 `onPartialOutput` 回调），不影响最终结果结构。

### 风险 4：Tool Definition 层过度抽象
**对策：** 采用渐进式——只从 Edit 和 Read 两个工具开始定义 `ToolDefinition`，其他工具保持原样。验证模式可行后再推广。

---

## 七、测试策略

每个 Phase 完成后需要验证：

### Edit 重构验证
```
✅ BOM 文件编辑后 BOM 保留
✅ CRLF 文件编辑后行尾不变
✅ 多个 edits 在同一文件上原子性执行
✅ 重叠 edits 被检测并拒绝
✅ 文件变异队列防止并发写入冲突
✅ diff 预览包含 firstChangedLine
```

### Read 重构验证
```
✅ 图片文件返回正确的 MIME 类型
✅ 非图片文件不触发图片检测
✅ Operations 接口可以注入 mock 读取
```

### Bash 流式验证
```
✅ 长时间命令输出逐步到达而非一次性
✅ 最终结果格式与旧版相同
✅ 超时和 AbortSignal 正常触发
```

### Tool Definition 抽象层验证
```
✅ 所有工具保持相同的 `tool()` 输出格式
✅ system prompt 工具描述自动生成
✅ 新旧调用方式均可工作
```
