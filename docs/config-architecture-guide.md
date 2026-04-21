# packages/core 配置架构守则

> 基于 Claude Code 配置架构学习总结

## 1. 配置层级原则

Claude Code 采用**三层优先级**配置解析：

```
环境变量 > 配置文件/参数 > 默认值常量
```

**示例**（参考 `model-capabilities.ts`）：
```typescript
export function getModelContextLimit(modelName: string): number {
  // 1. 环境变量覆盖（最高优先级）
  const envLimit = process.env['THETHING_MODEL_CONTEXT_LIMIT'];
  if (envLimit) return parseInt(envLimit, 10);

  // 2. 模型名后缀解析（参数级）
  if (modelName.includes('[1m]')) return 1_000_000;

  // 3. 已知模型配置表（默认值）
  if (KNOWN_MODEL_LIMITS[modelName]) return KNOWN_MODEL_LIMITS[modelName];

  // 4. 兜底默认值
  return DEFAULT_CONTEXT_LIMIT;
}
```

## 2. 配置命名规范

### 2.1 类型命名

| 类型 | 命名模式 | 用途 |
|------|----------|------|
| 创建配置 | `CreateXxxConfig` | 创建实例时的配置 |
| 运行配置 | `XxxConfig` | 运行时使用的配置 |
| 选项 | `XxxOptions` | 可选参数（有默认值） |
| 定义 | `XxxDefinition` | 静态定义（YAML/JSON） |

**避免混用**：`Options` 和 `Config` 不要同时用于同一层级。

### 2.2 常量命名

```typescript
// 默认值常量：DEFAULT_<NAME>
export const DEFAULT_CONTEXT_LIMIT = 128_000;
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryCompactConfig = { ... };

// 环境变量名：ENV_<NAME>
export const ENV_CONTEXT_LIMIT = 'THETHING_MODEL_CONTEXT_LIMIT';
export const ENV_MODEL = 'THETHING_MODEL';

// 阈值常量：<NAME>_THRESHOLD / <NAME>_BUFFER
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
export const COMPACT_TOKEN_THRESHOLD = 25_000;
```

## 3. 配置目录结构

```
packages/core/src/config/
├── index.ts           # 统一导出入口
├── defaults.ts        # 所有 DEFAULT_* 常量集中定义
├── types.ts           # 所有配置接口集中定义
├── model.ts           # 模型能力配置（model-capabilities.ts 迁移）
├── compaction.ts      # 压缩相关配置
├── session.ts         # Session 状态配置
├── connector.ts       # Connector 配置
└── agent.ts           # Agent 创建配置
```

**原则**：
1. 每个模块的配置独立文件
2. `defaults.ts` 集中所有默认值常量
3. `types.ts` 集中所有配置接口定义
4. `index.ts` 统一导出

## 4. 配置接口设计原则

### 4.1 分层设计

```typescript
// 第一层：全局初始化配置
interface InitConfig {
  dataDir: string;
  databaseConfig?: SQLiteDataStoreConfig;
  connectorConfig?: ConnectorGatewayConfig;
}

// 第二层：模块创建配置
interface CreateAgentConfig {
  conversationId: string;           // 必填
  modelConfig: ModelProviderConfig; // 必填
  sessionOptions?: SessionStateOptions; // 可选，有默认值
  enableMcp?: boolean;              // 可选，默认 true
}

// 第三层：运行时选项
interface SessionStateOptions {
  maxContextTokens?: number;  // 默认从 modelConfig 获取
  compactThreshold?: number;  // 默认动态计算
}
```

### 4.2 配置继承与覆盖

```typescript
// 子配置可覆盖父配置的默认值
function createSessionState(conversationId: string, options?: SessionStateOptions) {
  const maxContextTokens = options?.maxContextTokens
    ?? getModelContextLimit(options?.model)
    ?? DEFAULT_CONTEXT_LIMIT;
}
```

## 5. 环境变量设计原则

### 5.1 环境变量命名

```typescript
// 模块前缀 + 配置名
THETHING_MODEL_CONTEXT_LIMIT   // 模型上下文限制
THETHING_MCP_DIR               // MCP 配置目录
THETHING_CONNECTORS_DIR        // Connector 配置目录
THETHING_GLOBAL_CONFIG_DIR     // 全局配置目录
```

### 5.2 环境变量解析函数

```typescript
// 统一的环境变量解析模式
export function getConfigFromEnv<T>(
  envKey: string,
  defaultValue: T,
  parser?: (value: string) => T
): T {
  const value = process.env[envKey];
  if (!value) return defaultValue;
  return parser ? parser(value) : value as T;
}
```

## 6. 默认值设计原则

### 6.1 保守默认值

```typescript
// 默认值应保守，确保安全运行
export const DEFAULT_CONTEXT_LIMIT = 128_000;  // 不假设模型能力
export const DEFAULT_MAX_OUTPUT_CHARS = 50_000; // 限制输出大小
export const DEFAULT_MAX_BUDGET_USD = 5.0;      // 成本上限
```

### 6.2 默认值集中定义

```typescript
// defaults.ts 中集中定义
export const DEFAULT_CONTEXT_LIMIT = 128_000;
export const DEFAULT_OUTPUT_TOKENS = 8_000;
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  maxTokens: 40_000,
  minTextBlockMessages: 5,
};
```

## 7. 配置验证原则

### 7.1 必填字段验证

```typescript
interface CreateAgentConfig {
  conversationId: string;  // 必填，无默认值
  modelConfig: ModelProviderConfig; // 必填
}

// 创建时验证
function createChatAgent(config: CreateAgentConfig) {
  if (!config.conversationId) throw new Error('conversationId is required');
  if (!config.modelConfig) throw new Error('modelConfig is required');
}
```

### 7.2 可选字段类型

```typescript
// 可选字段使用 ? + 默认值处理
interface SessionStateOptions {
  maxContextTokens?: number;  // 可选
}

// 使用时提供默认值
const maxContextTokens = options?.maxContextTokens ?? DEFAULT_CONTEXT_LIMIT;
```

## 8. 配置文档原则

### 8.1 README.md 配置说明

每个模块的 README 应包含：
1. 配置类型列表
2. 必填/可选说明
3. 默认值说明
4. 环境变量说明

### 8.2 配置变更日志

配置变更应记录在 CHANGELOG 中，标注：
- 新增配置
- 弃用配置
- 默认值变更

## 9. 避免的配置模式

### 9.1 避免嵌套过深

```typescript
// ❌ 避免
interface Config {
  agent: {
    session: {
      state: {
        options: {
          maxTokens: number;
        }
      }
    }
  }
}

// ✅ 推荐：扁平化
interface SessionStateOptions {
  maxTokens: number;
}
```

### 9.2 避免配置与状态混用

```typescript
// ❌ 避免：配置和运行状态混在一起
interface SessionState {
  maxContextTokens: number;  // 配置
  currentTokens: number;     // 运行状态
}

// ✅ 推荐：分离
interface SessionStateOptions {
  maxContextTokens: number;  // 配置
}

interface SessionState {
  options: SessionStateOptions;  // 配置引用
  tokenBudget: TokenBudgetTracker; // 运行状态
}
```

### 9.3 避免硬编码配置

```typescript
// ❌ 避免
function createSessionState() {
  const maxTokens = 128_000;  // 硬编码
}

// ✅ 推荐
function createSessionState(options?: SessionStateOptions) {
  const maxTokens = options?.maxTokens ?? DEFAULT_CONTEXT_LIMIT;
}
```

## 10. 配置迁移指南

当需要整理分散的配置时：

1. **收集**: 找出所有 `interface.*Config` 定义
2. **分类**: 按 `CreateConfig` / `Options` / `Definition` 分类
3. **命名**: 统一命名规范
4. **集中**: 创建 `config/` 目录集中定义
5. **导出**: 通过 `config/index.ts` 统一导出
6. **更新**: 修改各模块引用新配置位置
7. **测试**: 确保所有功能正常运行

---

## 参考资料

- `docs/context-budget-and-tool-output-management-design.md` - ClaudeCode 预算管理参考
- `docs/architecture-gaps-and-completion-plan.md` - 架构差距分析
- `packages/core/src/model-capabilities.ts` - 环境变量优先级实现示例