# @the-thing/core 未完成任务清单

> 基于 `plans/core-internal-redesign-musk-method.md` 的设计，本文档列出所有尚未实施的项目，
> 并为每项提供具体的实施计划和验收标准。

---

## 一、高优先级（架构 + 性能）

### 1.1 物理目录重组（计划 3.1）

**目标：** 将当前 5 层目录结构重组为 4 层，消除 Extensions 作为独立层的概念。

**当前结构：**
```
src/
├── foundation/      # Layer 1: Primitives + Services 混合
├── config/          # Layer 2: Services
├── runtime/         # Layer 3: Modules（session-state, compaction, budget, tasks, tools, middleware, agent-control）
├── extensions/      # Layer 3: Modules（skills, mcp, connector, subagents, memory, permissions, system-prompt, attachments）
├── api/             # Layer 4: Composition（loaders, app）
├── application/     # Layer 4: Composition
└── bootstrap.ts     # Layer 4: Composition
```

**目标结构：**
```
src/
├── primitives/      # Layer 1: 纯类型 + 纯函数
│   ├── constants.ts
│   ├── parser/
│   ├── paths/       # 仅 compute* 纯函数
│   ├── clock/
│   └── datastore/types.ts
│
├── services/        # Layer 2: 有状态服务
│   ├── model/       # capabilities + pricing（不含 provider）
│   ├── datastore/sqlite/
│   ├── config/      # layout + behavior + defaults
│   └── scanner/
│
├── modules/         # Layer 3: 业务逻辑（runtime + extensions 合并）
│   ├── session/     # ← runtime/session-state 重命名
│   ├── compaction/
│   ├── budget/
│   ├── tasks/
│   ├── tools/
│   ├── middleware/
│   ├── agent-control/
│   ├── skills/
│   ├── mcp/
│   ├── connector/
│   ├── subagents/
│   ├── memory/
│   ├── permissions/
│   ├── system-prompt/
│   └── attachments/
│
├── composition/     # Layer 4: 组装层
│   ├── loaders/     # ← api/loaders
│   ├── app/         # ← api/app
│   ├── inbound-agent/ # ← application/
│   └── bootstrap.ts
│
└── index.ts         # 公共 API 入口
```

**实施步骤：**

1. 创建新目录结构（`primitives/`, `services/`, `modules/`, `composition/`）
2. 移动文件（逐模块移动，每移一个模块跑一次 typecheck）
3. 更新所有 import 路径
4. 删除旧目录
5. 更新 `package.json` 的 `exports` 字段
6. 运行全量测试验证

**移动清单：**

| 源文件 | 目标位置 |
|--------|----------|
| `foundation/constants.ts` | `primitives/constants.ts` |
| `foundation/parser/*` | `primitives/parser/` |
| `foundation/paths/compute.ts` | `primitives/paths/compute.ts` |
| `foundation/paths/resolve.ts` | `primitives/paths/resolve.ts` |
| `foundation/clock/*` | `primitives/clock/` |
| `foundation/datastore/types.ts` | `primitives/datastore/types.ts` |
| `foundation/model/capabilities*` | `services/model/capabilities*` |
| `foundation/model/pricing.ts` | `services/model/pricing.ts` |
| `foundation/model/constants.ts` | `services/model/constants.ts` |
| `foundation/datastore/sqlite/*` | `services/datastore/sqlite/` |
| `foundation/datastore/constants.ts` | `services/datastore/constants.ts` |
| `foundation/scanner/*` | `services/scanner/` |
| `config/*` | `services/config/` |
| `runtime/session-state/*` | `modules/session/` |
| `runtime/compaction/*` | `modules/compaction/` |
| `runtime/budget/*` | `modules/budget/` |
| `runtime/tasks/*` | `modules/tasks/` |
| `runtime/tools/*` | `modules/tools/` |
| `runtime/middleware/*` | `modules/middleware/` |
| `runtime/agent-control/*` | `modules/agent-control/` |
| `runtime/agent/*` | `modules/agent/` |
| `extensions/skills/*` | `modules/skills/` |
| `extensions/mcp/*` | `modules/mcp/` |
| `extensions/connector/*` | `modules/connector/` |
| `extensions/subagents/*` | `modules/subagents/` |
| `extensions/memory/*` | `modules/memory/` |
| `extensions/permissions/*` | `modules/permissions/` |
| `extensions/system-prompt/*` | `modules/system-prompt/` |
| `extensions/attachments/*` | `modules/attachments/` |
| `api/loaders/*` | `composition/loaders/` |
| `api/app/*` | `composition/app/` |
| `application/*` | `composition/inbound-agent/` |
| `bootstrap.ts` | `composition/bootstrap.ts` |

**验收标准：**
- `pnpm typecheck` 无新增错误
- `pnpm test` 结果与重组前一致（25 个 pre-existing 失败不变）
- 无循环依赖（`npx madge --circular --extensions ts ./src` 通过）
- 层级依赖方向正确（primitives → services → modules → composition，无反向）

**风险：** 高。涉及 80+ 文件的 import 路径修改。建议分批执行，每批移动 2-3 个模块。

---

### 1.2 AppModule 标准接口（计划 3.11）

**目标：** 为所有 extension 模块建立统一的生命周期接口，替代当前的散装函数模式。

**当前问题：**
- 只有 `ConnectorRuntime` 有 `create/initialize/dispose` 模式
- 其他模块（skills, mcp, memory, permissions）都是散装函数
- `api/app/loadAll` 无法用统一循环初始化和销毁

**实施步骤：**

1. 在 `modules/` 层定义 `AppModule` 接口：

```typescript
// modules/types.ts
interface AppModule {
  name: string;
  init?(context: ModuleContext): Promise<void>;
  dispose?(): Promise<void>;
  snapshot?(): unknown;
}

interface ModuleContext {
  cwd: string;
  configDirName: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  resourceDirs: ResourceDirs;
}
```

2. 为每个 extension 模块实现 `AppModule`：

| 模块 | init | dispose | snapshot |
|------|------|---------|----------|
| skills | 扫描 + 缓存 | 清缓存 | 返回 Skill[] |
| mcp | 创建 Registry + 连接 | 断开连接 | 返回 McpServerConfig[] |
| connector | 创建 Runtime + 初始化 | dispose Runtime | 返回 ConnectorFrontmatter[] |
| subagents | 注册 builtin agents | 无 | 返回 AgentDefinition[] |
| memory | 扫描 memory 文件 | 无 | 返回 MemoryEntry[] |
| permissions | 加载规则 | 无 | 返回 PermissionRule[] |
| system-prompt | 无 | 无 | 无 |
| attachments | 初始化 tracker | 清 tracker | 无 |

3. 重构 `api/app/loaders/index.ts` 的 `loadAll` 为统一循环：

```typescript
const modules: AppModule[] = [skillsModule, mcpModule, connectorModule, ...];
for (const mod of modules) {
  await mod.init(context);
}
// ...
for (const mod of modules) {
  await mod.dispose?.();
}
```

4. 更新 `api/app/context.ts` 的 `AppContext.reload()` 使用统一 dispose + re-init

**验收标准：**
- 每个 extension 模块导出一个 `AppModule` 实例
- `loadAll` 使用统一循环
- `AppContext.dispose()` 调用所有模块的 `dispose`
- 测试通过

---

### 1.3 条件加载非必需模块（计划 4.1）

**目标：** `createChatAgent` 中按需动态导入非必需模块（memory, skills, system-prompt）。

**当前问题：** 即使 `modules.memory = false`，`createChatAgent` 仍然 import 了 `loadMemoryContext`、`buildAgentInstructions` 等函数，导致不必要的模块加载。

**实施步骤：**

1. 将 `runtime/agent/context.ts` 拆分为独立可导入的模块：

```
modules/agent/
├── context/
│   ├── memory-context.ts    # loadMemoryContext
│   ├── skill-context.ts     # resolveActiveSkills (已内联)
│   └── instructions.ts      # buildAgentInstructions
```

2. 在 `create.ts` 中按需动态导入：

```typescript
// 之前（静态 import）
import { loadMemoryContext, buildAgentInstructions } from './context';

// 之后（动态 import）
let memoryContext: MemoryContext | null = null;
if (modules.memory) {
  const { loadMemoryContext } = await import('./context/memory-context');
  memoryContext = await loadMemoryContext(...);
}

let instructions: string;
if (modules.systemPrompt !== false) {
  const { buildAgentInstructions } = await import('./context/instructions');
  instructions = await buildAgentInstructions(...);
} else {
  instructions = 'You are a helpful assistant.';
}
```

3. 更新 `agent/index.ts` 的导出

**验收标准：**
- `modules.memory = false` 时不加载 memory 相关模块
- `modules.skills = false` 时不加载 skill 相关模块
- 测试通过
- 打包体积减小（可通过 `npx esbuild --bundle` 对比验证）

---

### 1.4 并行化独立初始化步骤（计划 4.2）

**目标：** `createChatAgent` 中将独立的异步操作改为 `Promise.all` 并行执行。

**当前代码（顺序执行）：**
```typescript
const sessionState = createSessionState(...);
const skillResolution = await resolveSkills(...);
const memoryContext = await loadMemory(...);
const projectContext = await loadProjectContext(...);
const instructions = await buildAgentInstructions(...);
```

**优化后（并行执行）：**
```typescript
const sessionState = createSessionState(...);

// 并行执行独立步骤
const [skillResolution, memoryContext, projectContext] = await Promise.all([
  modules.skills ? resolveSkills(...) : null,
  modules.memory ? loadMemory(...) : null,
  loadProjectContext(...),
]);

const instructions = await buildAgentInstructions(memoryContext, { ... });
```

**依赖分析：**
- `resolveSkills`：依赖 `messagesWithAttachments` + `preloadedData.skills` → 独立
- `loadMemory`：依赖 `messagesWithAttachments` + `userId` + `memoryBaseDir` → 独立
- `loadProjectContext`：依赖 `projectRoot` → 独立
- `buildAgentInstructions`：依赖 `memoryContext` + `projectContext` → 必须在后面

**实施步骤：**

1. 在 `create.ts` 中将 `resolveSkills`、`loadMemory`、`loadProjectContext` 改为 `Promise.all`
2. 确保 `buildAgentInstructions` 在 `Promise.all` 之后执行
3. 运行测试验证

**验收标准：**
- 3 个独立操作并行执行
- 测试通过
- 启动时间缩短（可通过 `console.time` 测量验证）

---

## 二、中优先级（代码整洁度）

### 2.1 删除 3 个全局单例（计划 2.2）

**目标：** 消除模块级全局可变状态，改为由调用者持有实例。

#### 2.1.1 `paths/compute.ts:resolvedConfigDirName`

**当前：**
```typescript
let resolvedConfigDirName = DEFAULT_PROJECT_CONFIG_DIR_NAME;
export function setResolvedConfigDirName(name: string): void { resolvedConfigDirName = name; }
export function getResolvedConfigDirName(): string { return resolvedConfigDirName; }
```

**修复：** 这些 `get*` 便捷函数已被 `ResolvedLayout` 模式替代。检查所有调用者，确认都已使用 `ResolvedLayout` 后删除。

**实施步骤：**
1. 搜索所有 `getResolvedConfigDirName` 和 `setResolvedConfigDirName` 调用
2. 确认都已迁移到 `ResolvedLayout.configDirName`
3. 删除全局变量和 getter/setter
4. 删除 `get*` 便捷函数（`getResolvedCwd` 等）

#### 2.1.2 `tasks/store.ts:globalTaskStore`

**当前：**
```typescript
let globalTaskStore: TaskStore | null = null;
export function initGlobalTaskStoreFromDataStore(dataStore: DataStore): void { ... }
export function getGlobalTaskStore(): TaskStore { ... }
```

**修复：** 由 `CoreRuntime` 持有 `TaskStore` 实例，通过 `AppContext` 传递。

**实施步骤：**
1. 在 `CoreRuntime` 中添加 `taskStore: TaskStore` 字段
2. 在 `bootstrap.ts` 中从 `DataStore` 初始化 `TaskStore`
3. 将 `taskStore` 传递到 `AppContext` 和 `createAgent`
4. 删除 `globalTaskStore` 全局变量
5. 更新 `getGlobalTaskStore` 的调用者

#### 2.1.3 `scanner/merge.ts:LoadingCache` 全局实例

**当前：** `LoadingCache` 本身是类，没有全局实例。但某些调用者在模块级创建实例。

**修复：** 确认所有 `LoadingCache` 实例都由调用者持有（已是如此，无需修改）。

**验收标准：**
- 无模块级 `let` 可变全局状态（`const` 导出的单例除外）
- `pnpm typecheck` 无错误
- 测试通过

---

### 2.2 迁移 console.log 到 logger（计划 4.3）

**目标：** 将 core 内 173 处裸 `console.log/warn/error` 迁移到 `foundation/logger.ts`。

**当前：** 已创建 `foundation/logger.ts`，但未迁移任何调用。

**实施步骤：**

1. 在 `bootstrap.ts` 初始化时调用 `setDebugEnabled(env.DEBUG)`
2. 按模块逐步迁移（优先级从高到低）：

| 模块 | 调用数 | 优先级 |
|------|--------|--------|
| `runtime/agent/tools.ts` | 6 | 高 |
| `runtime/agent/create.ts` | 3 | 高 |
| `api/app/context.ts` | 7 | 高 |
| `runtime/compaction/index.ts` | 2 | 中 |
| `extensions/mcp/registry.ts` | ~5 | 中 |
| `extensions/connector/` | ~20 | 中 |
| `runtime/budget/tool-result-storage.ts` | 5 | 低 |
| `foundation/datastore/sqlite/` | ~10 | 低 |
| 其他 | ~115 | 低 |

3. 迁移规则：
   - `console.log` → `logger.debug(tag, message)` 或 `logger.info(tag, message)`
   - `console.warn` → `logger.warn(tag, message)`
   - `console.error` → `logger.error(tag, message)`
   - 保留用户可见的关键日志（如 bootstrap 完成、token budget 警告）

**验收标准：**
- `grep -r "console\.\(log\|warn\|error\)" packages/core/src --include="*.ts" | grep -v "__tests__"` 数量显著减少
- 所有 debug 日志在 `debugEnabled = false` 时不输出
- 测试通过

---

### 2.3 迁移剩余 3 个 loader 到 MultiSourceConfigLoader（计划 3.5）

**目标：** 将 skills、agents、connectors loader 迁移到 `createMultiSourceLoader`。

**当前：** 仅 MCPs loader 已迁移验证。

**实施步骤：**

#### 2.3.1 Skills Loader

```typescript
// api/loaders/skills.ts
const skillsLoader = createMultiSourceLoader<SkillConfigWithSource>({
  subcategory: 'skills',
  filePattern: 'SKILL.md',
  parse: async (filePath, source) => {
    const result = await parseFrontmatterFile(filePath, SkillFrontmatterSchema);
    return { ...result.data, source, filePath };
  },
  getMergeKey: (item) => item.name,
});
```

注意：Skills 使用 `scanConfigDirs`（子目录结构 `{skillName}/SKILL.md`），而非 `scanDirs`。`MultiSourceConfigLoader` 当前只支持 `scanDirs`，需要扩展支持 `scanConfigDirs` 模式。

#### 2.3.2 Agents Loader

```typescript
// api/loaders/agents.ts
const agentsLoader = createMultiSourceLoader<AgentConfigWithSource>({
  subcategory: 'agents',
  filePattern: '*.md',
  parse: async (filePath, source) => {
    const result = await parseFrontmatterFile(filePath, AgentFrontmatterSchema);
    return { ...result.data, source, filePath, agentType: extractAgentType(result.data, filePath) };
  },
  getMergeKey: (item) => item.agentType,
});
```

#### 2.3.3 Connectors Loader

```typescript
// api/loaders/connectors.ts
const connectorsLoader = createMultiSourceLoader<ConnectorConfigWithSource>({
  subcategory: 'connectors',
  filePattern: '*.{yaml,yml}',  // 需要扩展支持多扩展名
  parse: async (filePath, source) => {
    const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
    return { ...result.data, source, filePath };
  },
  getMergeKey: (item) => item.id,
});
```

注意：Connectors 有环境变量替换逻辑，需要在 `parse` 回调中处理。

**验收标准：**
- 每个迁移后的 loader 测试通过
- `MultiSourceConfigLoader` 支持 `scanConfigDirs` 模式（Skills 需要）
- `MultiSourceConfigLoader` 支持多扩展名匹配（Connectors 需要）

---

## 三、低优先级（CI 保障）

### 3.1 层级依赖方向验证脚本（计划 5.1）

**目标：** 创建 `scripts/check-layer-deps.mjs`，验证依赖方向只能是 Primitives → Services → Modules → Composition。

**实施步骤：**

1. 创建 `scripts/check-layer-deps.mjs`：

```javascript
// 定义层级映射
const layerMap = {
  'primitives': 1,
  'services': 2,
  'modules': 3,
  'composition': 4,
};

// 扫描所有 .ts 文件的 import
// 检查每个 import 的来源层级是否 <= 当前文件层级
// 如果 import 了更高层级的模块，报错
```

2. 添加到 `package.json`：

```json
{
  "scripts": {
    "check:layers": "node scripts/check-layer-deps.mjs"
  }
}
```

3. 在 CI 中运行

**验收标准：**
- 脚本能检测到反向依赖
- 当前代码库通过检查（无反向依赖）

---

### 3.2 接口隔离验证脚本（计划 5.2）

**目标：** 检查 `SessionState` 的消费者是否只 import 了需要的接口。

**实施步骤：**

1. 创建 `scripts/check-interface-isolation.mjs`：

```javascript
// 定义每个模块应该使用的接口
const allowedInterfaces = {
  'compaction': ['TokenBudget', 'ToolOutputState'],
  'agent-control/stop-conditions': ['CostTracking', 'DenialTracking', 'SessionContext'],
  'agent-control/pipeline': ['TokenBudget', 'CostTracking', 'DenialTracking', 'ModelSwitching', 'ToolOutputState', 'SessionContext', 'CompactionService'],
  'tools': ['SessionContext', 'ToolOutputState'],
};

// 扫描每个模块的 import
// 检查是否只 import 了允许的接口
// 如果 import 了完整 SessionState，报错
```

2. 添加到 `package.json`

**验收标准：**
- 脚本能检测到接口隔离违规
- 当前代码库通过检查

---

### 3.3 导出面积监控脚本（计划 5.3）

**目标：** 监控 `index.ts` 的导出数量，防止无限膨胀。

**实施步骤：**

1. 创建 `scripts/check-export-surface.mjs`：

```javascript
import { readFileSync } from 'fs';
const content = readFileSync('./src/index.ts', 'utf-8');
const exportCount = (content.match(/^export /gm) || []).length;
const maxExports = 50;
if (exportCount > maxExports) {
  console.error(`Export surface: ${exportCount} > ${maxExports}`);
  process.exit(1);
}
console.log(`Export surface: ${exportCount} / ${maxExports}`);
```

2. 添加到 `package.json`

**验收标准：**
- 脚本能正确计算导出数量
- 当前导出数量在限制内

---

## 执行计划总览

| 阶段 | 任务 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **Phase A** | 1.2 AppModule 标准接口 | 中 | 无 |
| **Phase A** | 1.3 条件加载非必需模块 | 中 | 无 |
| **Phase A** | 1.4 并行化初始化步骤 | 小 | 1.3 |
| **Phase B** | 2.1 删除全局单例 | 中 | 无 |
| **Phase B** | 2.2 迁移 console.log | 大（173处） | 无 |
| **Phase B** | 2.3 迁移剩余 loader | 中 | 无 |
| **Phase C** | 1.1 物理目录重组 | 大（80+文件） | A+B 完成后 |
| **Phase D** | 3.1 层级依赖验证脚本 | 小 | 1.1 |
| **Phase D** | 3.2 接口隔离验证脚本 | 小 | 1.2 |
| **Phase D** | 3.3 导出面积监控脚本 | 小 | 无 |

**建议执行顺序：** Phase A → Phase B → Phase C → Phase D

Phase A 和 B 可以并行执行（无依赖）。Phase C 必须在 A+B 之后（目录重组时如果还有散装函数会增加冲突）。Phase D 在 C 之后（层级验证需要新的目录结构）。
