# defaults.ts 常量迁移到配置系统

## Context

**问题**：业务模块直接引用 `defaults.ts` 的常量，绕过了 bootstrap 的配置注入系统。

**正确的设计应该是**：
```
用户配置 → bootstrap() → CoreRuntime { layout, behavior } → 业务模块
                    ↑
               defaults.ts (仅作为 fallback)
```

**当前实际情况**：26 个文件直接 `import { X } from './config/defaults'`，违反了"配置显式注入"原则。

**目标**：让 `defaults.ts` 仅作为 `buildBehaviorConfig()` 和 `resolveLayout()` 的默认值来源，业务模块通过 `runtime.behavior` 或 `runtime.layout` 获取配置。

---

## 分阶段实施计划

### 阶段一：扩展 BehaviorConfig

**目标**：将业务行为常量迁移到 BehaviorConfig，通过 `runtime.behavior` 传递。

**新增字段**：

```typescript
interface BehaviorConfig {
  // 现有字段保持不变...

  // 新增：压缩配置
  compaction: {
    sessionMemory: { minTokens: number; maxTokens: number; minTextBlockMessages: number };
    micro: { timeWindowMs: number; imageMaxTokenSize: number; compactableTools: string[]; gapThresholdMinutes: number; keepRecent: number };
    postCompact: { totalBudget: number; maxFilesToRestore: number; maxTokensPerFile: number; maxTokensPerSkill: number; skillsTokenBudget: number };
  };

  // 新增：工具输出限制
  toolOutput: {
    maxResultSizeChars: number;
    maxToolResultTokens: number;
    maxToolResultsPerMessageChars: number;
    previewSizeChars: number;
  };

  // 新增：Memory 系统限制
  memory: {
    mdMaxLines: number;
    mdMaxSizeKb: number;
    entrypointMaxLines: number;
    entrypointMaxBytes: number;
  };
}
```

**关键文件**：
1. [config/behavior.ts](../packages/core/src/config/behavior.ts) - 扩展接口和 `buildBehaviorConfig()`
2. [runtime/compaction/types.ts](../packages/core/src/runtime/compaction/types.ts) - 从 behavior 获取配置
3. [runtime/budget/tool-output-manager.ts](../packages/core/src/runtime/budget/tool-output-manager.ts) - 从 behavior 获取配置
4. [runtime/session-state/cost.ts](../packages/core/src/runtime/session-state/cost.ts) - 移除对 `DEFAULT_MAX_BUDGET_USD` 的直接引用
5. [extensions/memory/memdir.ts](../packages/core/src/extensions/memory/memdir.ts) - 从 behavior 获取配置
6. [api/loaders/memory.ts](../packages/core/src/api/loaders/memory.ts) - 从 behavior 获取配置

**验证方式**：
- 单元测试：`buildBehaviorConfig()` 默认值与原 `defaults.ts` 一致
- 集成测试：通过 `bootstrap({ behavior: { compaction: {...} } })` 覆盖配置

---

### 阶段二：扩展 ResolvedLayout

**目标**：将布局相关常量迁移到 ResolvedLayout。

**新增字段**：

```typescript
interface ResolvedLayout {
  // 现有字段保持不变...

  // 新增：文件名常量
  filenames: {
    permissions: string;  // 'permissions.json'
    db: string;           // 'chat.db'
  };
}
```

**关键文件**：
1. [config/layout.ts](../packages/core/src/config/layout.ts) - 扩展接口和 `resolveLayout()`
2. [extensions/permissions/loader.ts](../packages/core/src/extensions/permissions/loader.ts) - 从 layout.filenames.permissions 获取
3. [api/loaders/permissions.ts](../packages/core/src/api/loaders/permissions.ts) - 从 layout.filenames.permissions 获取
4. [foundation/datastore/sqlite/sqlite-data-store.ts](../packages/core/src/foundation/datastore/sqlite/sqlite-data-store.ts) - 从 layout.filenames.db 获取

**验证方式**：
- 单元测试：`resolveLayout()` 默认值与原 `defaults.ts` 一致
- TypeScript 编译检查

---

### 阶段三：foundation 层配置注入

**目标**：为 foundation 层模块提供配置获取机制。

**方案**：复用现有的全局单例模式 `resolvedConfigDirName`，扩展为更完整的配置快照。

**关键文件**：
1. [foundation/paths/compute.ts](../packages/core/src/foundation/paths/compute.ts) - 已有 `setResolvedConfigDirName()`
2. [bootstrap.ts](../packages/core/src/bootstrap.ts) - 在 bootstrap 时设置配置快照
3. [foundation/model/capabilities.ts](../packages/core/src/foundation/model/capabilities.ts) - 通过参数接收配置

**验证方式**：
- 确保现有全局单例继续工作
- 新增测试验证配置注入生效

---

### 阶段四：清理 deprecated 导出

**目标**：移除 `config/index.ts` 和 `index.ts` 中的 deprecated 导出。

**移除的导出**：
- `DEFAULT_MAX_BUDGET_USD` → `BehaviorConfig.maxBudgetUsdPerSession`
- `DEFAULT_MAX_DENIALS_PER_TOOL` → `BehaviorConfig.maxDenialsPerTool`
- `MODEL_MAPPING` → `BehaviorConfig.modelAliases`
- `PERMISSIONS_FILENAME` → `ResolvedLayout.filenames.permissions`
- 其他未使用的导出

**关键文件**：
1. [config/index.ts](../packages/core/src/config/index.ts) - 移除 deprecated 导出
2. [index.ts](../packages/core/src/index.ts) - 移除 deprecated 导出
3. [config/defaults.ts](../packages/core/src/config/defaults.ts) - 移除已迁移的常量定义

**验证方式**：
- TypeScript 编译检查：无模块引用已移除的导出
- 发布 breaking change 通知

---

### 阶段五：defaults.ts 重构为纯默认值

**目标**：`defaults.ts` 仅作为内部默认值定义，不对外导出业务常量。

**最终结构**：
```typescript
// defaults.ts - 仅被 behavior.ts 和 layout.ts 内部使用
// 不对外导出业务常量

// 保留导出（基础设施常量，无业务决策）
export const BYTES_PER_TOKEN = 4;
export const TOKENIZER_CACHE_DIR_NAME = 'tokenizers';
```

**关键文件**：
1. [config/behavior.ts](../packages/core/src/config/behavior.ts) - 内部 import defaults
2. [config/layout.ts](../packages/core/src/config/layout.ts) - 内部 import defaults
3. [config/defaults.ts](../packages/core/src/config/defaults.ts) - 精简为纯默认值

---

## 需要迁移的常量清单

### BehaviorConfig 新增字段（来源：defaults.ts）

| 字段路径 | 常量来源 | 默认值 |
|---------|---------|-------|
| `compaction.sessionMemory.minTokens` | DEFAULT_SESSION_MEMORY_CONFIG | 10_000 |
| `compaction.sessionMemory.maxTokens` | DEFAULT_SESSION_MEMORY_CONFIG | 40_000 |
| `compaction.sessionMemory.minTextBlockMessages` | DEFAULT_SESSION_MEMORY_CONFIG | 5 |
| `compaction.micro.*` | DEFAULT_MICRO_COMPACT_CONFIG_RAW | ... |
| `compaction.postCompact.*` | DEFAULT_POST_COMPACT_CONFIG | ... |
| `toolOutput.maxResultSizeChars` | DEFAULT_MAX_RESULT_SIZE_CHARS | 50_000 |
| `toolOutput.maxToolResultTokens` | MAX_TOOL_RESULT_TOKENS | 100_000 |
| `toolOutput.maxToolResultsPerMessageChars` | MAX_TOOL_RESULTS_PER_MESSAGE_CHARS | 200_000 |
| `toolOutput.previewSizeChars` | PREVIEW_SIZE_CHARS | 2_000 |
| `memory.mdMaxLines` | MEMORY_MD_MAX_LINES | 200 |
| `memory.mdMaxSizeKb` | MEMORY_MD_MAX_SIZE_KB | 25 |
| `memory.entrypointMaxLines` | MAX_ENTRYPOINT_LINES | 200 |
| `memory.entrypointMaxBytes` | MAX_ENTRYPOINT_BYTES | 25_000 |

### ResolvedLayout 新增字段（来源：defaults.ts）

| 字段路径 | 常量来源 | 默认值 |
|---------|---------|-------|
| `filenames.permissions` | PERMISSIONS_FILENAME | 'permissions.json' |
| `filenames.db` | DEFAULT_DB_FILENAME | 'chat.db' |

### 保留全局可用的常量

| 常量 | 保留原因 |
|------|---------|
| `DEFAULT_PROJECT_CONFIG_DIR_NAME` | foundation 层全局单例 fallback |
| `BYTES_PER_TOKEN` | 纯计算常量，无业务决策 |
| `TOKENIZER_CACHE_DIR_NAME` | 已在 layout 中使用 |

---

## 验证计划

1. **类型检查**：`pnpm typecheck` 无错误
2. **单元测试**：`pnpm --filter @the-thing/core test` 全部通过
3. **集成测试**：启动 CLI/Web，验证配置覆盖生效
4. **grep 检查**：业务模块不再直接 `import from './config/defaults'`

---

## 风险评估

| 阶段 | 风险 | 缓解措施 |
|------|------|---------|
| 阶段一 | 低 | BehaviorConfig 已有成熟传递机制 |
| 阶段二 | 低 | ResolvedLayout 已是 immutable 快照 |
| 阶段三 | 中 | 保留向后兼容的全局单例 |
| 阶段四 | 低 | 发布前充分 deprecated 通知 |
| 阶段五 | 低 | 确保所有引用已迁移 |