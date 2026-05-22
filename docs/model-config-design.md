# 模型配置设计

## 1. 现状

```
用户配置模型的唯一方式:
  CLI:    ~/.thething/config.json (已有) + 环境变量 (DASHSCOPE_*)
  Server: 仅环境变量

问题:
  1. provider.ts 硬编码 name: "dashscope" — 换 provider 就露馅
  2. Server 不读 config.json — 配好 CLI 后 Server 还要再配一次
  3. config schema 嵌套别扭 — api.key / api.baseUrl / default.model
  4. 环境变量名绑死 DashScope — DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL
```

核心痛点：**切换模型服务商太麻烦**。改环境变量要改多处，还要重启终端。需要一个 config.json 改三行就能切 provider。

## 2. 设计原则

用马斯克五步法：

1. **质疑需求** — 只解决真实痛点（切 provider 麻烦），不预设未来需求
2. **删除** — 零用户项目不做兼容，不加没人用的配置项
3. **简化** — 不新建文件，不引入新抽象，改最少的代码
4. **加速** — 半小时内能改完、测完、合并

Core 已做对的事不动：Core 不读环境变量，`createAgent` 接收 `ModelConfig` 对象。

## 3. 配置 Schema

```typescript
interface GlobalConfig {
  apiKey: string
  baseURL: string
  model?: string
}
```

实际文件 `~/.thething/config.json`：

```json
{
  "apiKey": "sk-xxx",
  "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-plus"
}
```

切 DeepSeek？改三行：

```json
{
  "apiKey": "sk-yyy",
  "baseURL": "https://api.deepseek.com/v1",
  "model": "deepseek-chat"
}
```

切 OpenAI？改三行：

```json
{
  "apiKey": "sk-zzz",
  "baseURL": "https://api.openai.com/v1",
  "model": "gpt-4o"
}
```

三个字段，没有嵌套，没有可选的花里胡哨。

### 与旧 Schema 的对比

| 旧 | 新 | 原因 |
|---|---|------|
| `api.key` | `apiKey` | 扁平化，减少嵌套 |
| `api.baseUrl` | `baseURL` | 与 Core 类型 `ModelProviderConfig.baseURL` 一致 |
| `default.model` | `model` | 直觉化 |

删掉的：`default.port`、`default.dataDir` — 跟模型配置无关，不该在这里。

## 4. 配置优先级

```
环境变量 THETHING_* > config.json > 报错提示用户配置
```

不搞多层合并，不搞 CLI 和 Server 不同的优先级链。环境变量能覆盖 config.json，够用了。

## 5. 环境变量

直接替换，不做旧名兼容（零用户，没有迁移成本）：

| 旧 | 新 |
|---|---|
| `DASHSCOPE_API_KEY` | `THETHING_API_KEY` |
| `DASHSCOPE_BASE_URL` | `THETHING_BASE_URL` |
| `DASHSCOPE_ENABLE_THINKING` | `THETHING_ENABLE_THINKING` |
| `THETHING_MODEL` | 不变 |

## 6. 具体改动

### 1. `core/src/services/model/provider.ts` — 去掉硬编码

```typescript
// 之前
createOpenAICompatible({ name: "dashscope", ... })

// 之后
createOpenAICompatible({ name: "openai-compatible", ... })
```

一行改动。不搞 `deriveProviderName` 从 URL 推导 — provider name 只用于日志，一个通用名够了。

### 2. `cli/src/lib/config-store.ts` — 扁平化 Schema

```typescript
// 之前
interface AppConfig {
  api?: { key?: string; baseUrl?: string }
  default?: { model?: string; port?: number; dataDir?: string }
}

// 之后
interface AppConfig {
  apiKey?: string
  baseURL?: string
  model?: string
}
```

`loadConfig` / `saveConfig` / `setConfigValue` 逻辑不变，只改类型。

### 3. `cli/src/commands/chat.ts` — 适配新 Schema + 替换环境变量名

```typescript
// 之前
let apiKey = fileConfig.api?.key || process.env.DASHSCOPE_API_KEY
let baseURL = fileConfig.api?.baseUrl || process.env.DASHSCOPE_BASE_URL

// 之后
let apiKey = process.env.THETHING_API_KEY || fileConfig.apiKey
let baseURL = process.env.THETHING_BASE_URL || fileConfig.baseURL
let model = process.env.THETHING_MODEL || fileConfig.model || 'qwen-plus'
```

环境变量优先于 config.json（容器部署场景）。

### 4. `server/src/routes/chat.ts` — 读 config.json

```typescript
// 之前
apiKey: process.env.DASHSCOPE_API_KEY || ''
baseURL: process.env.DASHSCOPE_BASE_URL || ''

// 之后 — 复用 CLI 的 loadConfig，或直接读文件
const config = loadConfig()
apiKey: process.env.THETHING_API_KEY || config.apiKey || ''
baseURL: process.env.THETHING_BASE_URL || config.baseURL || ''
```

Server 和 CLI 读同一个 config.json，配一次两边都生效。

### 5. 全局替换 `DASHSCOPE_*` 引用

涉及文件：
- `cli/src/commands/chat.ts`
- `cli/src/lib/env-names.ts`
- `server/src/routes/chat.ts`
- `server/src/serve.ts`
- `core/README.md`（示例代码）

直接 find & replace，不做兼容。

## 7. 文件变更汇总

| 文件 | 改动 |
|------|------|
| `core/src/services/model/provider.ts` | `"dashscope"` → `"openai-compatible"` |
| `cli/src/lib/config-store.ts` | `AppConfig` 扁平化 |
| `cli/src/commands/chat.ts` | 读新 schema + `THETHING_*` 环境变量 |
| `server/src/routes/chat.ts` | 读 config.json + `THETHING_*` 环境变量 |
| 全局 | `DASHSCOPE_*` → `THETHING_*` |

**不新建文件。不改 Core 的 API 契约。**

## 8. 验证

1. 编辑 `~/.thething/config.json` 为新 schema → `thething` 正常启动对话
2. 修改 config.json 中的 `baseURL` / `apiKey` → 切换到另一个 provider 成功
3. 设置 `THETHING_API_KEY` 环境变量 → 覆盖 config.json 中的值
4. `pnpm dev:server` → Server 读取同一个 config.json，API 正常
5. `pnpm typecheck` 通过
