# 模型配置重构设计:模型列表 + 后台模型

> 状态:已实施(2026-08-02,步骤 1-7 完成;透明度补充[第七节]未实施)
> 日期:2026-08-02

## 一、动机

现有的 fast/smart/default 三级模型别名同时面向两类受众,造成双重困惑:

- **用户侧**:输入框选择器显示别名而非真名,用户不知道"我这句话发给谁";设置页要理解三个抽象等级的含义才能配置。
- **代码侧**:ModelSwapper 的三条运行时自动切换(关键词意图/复杂度升级/成本降级)全部空转——`availableModels` 恒为空数组、复杂度开关默认关闭、且切换后只改 `sessionState.model` 字符串,实际请求仍走创建时固定的 `wrappedModel`。真触发反而导致 token 估算与实际模型错位。
- **供应商侧**:全局只有一对 apiKey/baseURL,三个别名只能是同一供应商下的不同模型,无法混用多家供应商。

经分析,三级别名中只有一个区分是真实的:**前台(用户对话)vs 后台(子 Agent / 杂活)**。本次重构把配置收敛为两个用户能直接理解的概念,同时顺带解决多供应商接入。

## 二、目标形态

### 用户心智模型(一句话)

> **我聊天用哪个我自己选,后台杂活用哪个我勾一个。**

### 设置页

只管两件事:

1. **模型列表**:添加/删除模型。每条模型 = `baseURL + apiKey + 模型名(+ 可选 contextLimit)`。不同条目可以指向不同供应商——多供应商由此天然解决。
2. **后台任务模型**:在列表中勾选一个,子 Agent(explore 等)、标题生成等高频低价值调用走它。

### 输入框选择器

从模型列表**直选真名**(显示 `deepseek-v4-flash`,不显示 `fast`)。选哪个,当前对话就走哪个。chat 路由本就每条消息重建 agent,中途换选下一条消息即生效,无需任何运行时切换机制。

## 三、配置文件

### 新格式 `~/.thething/models.json`(经 ~/.agents symlink)

> 2026-08-02 迭代:存储单位从摊平的 `models[]` 改为 **`providers[]` 分组**——凭据属于供应商而非模型,
> 加模型只需在已有供应商下追加,不用重填凭据。运行时消费方仍使用摊平视图(`models[]`,由 loadGlobalConfig 派生,不落盘)。

```json
{
  "providers": [
    {
      "name": "智谱 GLM",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "sk-...",
      "models": [
        { "id": "glm-5.2", "contextLimit": 200000 },
        { "id": "glm-5-air" }
      ]
    },
    {
      "name": "豆包 (火山引擎)",
      "baseURL": "https://ark.cn-beijing.volces.com/api/coding/v3",
      "apiKey": "ark-...",
      "models": [{ "id": "deepseek-v4-flash", "contextLimit": 128000 }]
    }
  ],
  "defaultModel": "glm-5.2",
  "backgroundModel": "deepseek-v4-flash"
}
```

字段说明:

| 字段 | 必填 | 说明 |
|---|---|---|
| `providers[]` | 是 | 供应商条目:一份凭据 + 该供应商下的模型列表 |
| `providers[].name` | 否 | 展示名(设置页/选择器分组标题),缺省用 baseURL |
| `providers[].baseURL` / `apiKey` | 是 | 供应商端点与凭据(OpenAI 兼容协议) |
| `providers[].models[].id` | 是 | 模型名,即 API 调用的 model 参数,全局唯一 |
| `providers[].models[].contextLimit` | 否 | 上下文窗口,缺省用系统默认 |
| `defaultModel` | 是 | 选择器初始值 / 未指定模型时的兜底 |
| `backgroundModel` | 否 | 后台任务模型;**缺省时后台任务 inherit 主模型** |

### 旧格式迁移(读取兼容)

`loadGlobalConfig`/`normalizeGlobalConfig` 兼容三代格式,归一化为 providers 分组 + 派生摊平 `models[]` 视图:

- **v1**(顶层 `apiKey`/`baseURL` + `modelAliases`):三别名去重收集为模型,凭据升为单 provider;`default` → `defaultModel`,`fast`(若不同于 default)→ `backgroundModel`
- **v2**(摊平 `models[]`,短暂过渡格式):按 `baseURL+apiKey` 聚合成 providers
- **v3**(providers 分组):派生 `models[]` 后原样使用

保存时一律写 v3 格式(设置页任意保存即完成落盘迁移),派生的 `models[]` 不落盘。

## 四、核心层改造(packages/core)

### 4.1 GlobalConfig 与加载

[global-config.ts](../packages/core/src/services/config/global-config.ts)

```ts
export interface ModelEntry {
  id: string
  baseURL: string
  apiKey: string
  contextLimit?: number
}

export interface GlobalConfig {
  models?: ModelEntry[]
  defaultModel?: string
  backgroundModel?: string
  // —— 旧格式字段,仅迁移期读取 ——
  apiKey?: string
  baseURL?: string
  modelAliases?: Partial<ModelAliases>
}
```

`loadGlobalConfig` 内做旧→新归一化,调用方只见新格式。

### 4.2 Provider Registry(多供应商核心)

[provider.ts](../packages/core/src/services/model/provider.ts) 从"单实例工厂"升级为 registry:

```ts
export interface ModelRegistryConfig {
  models: ModelEntry[]
  defaultModel: string
  backgroundModel?: string
  includeUsage?: boolean
  enableThinking?: boolean
}

// 按 baseURL+apiKey 懒创建并缓存 createOpenAICompatible 实例;
// 对外签名保持 (modelName: string) => LanguageModelV3 不变。
// modelName 在 models[] 中查到哪条,就用哪条的凭据创建。
// 查不到时回落 defaultModel 条目的凭据(容错,不抛错)。
export function createModelRegistry(config: ModelRegistryConfig): ModelProviderFn
```

关键点:

- **`ModelProviderFn` 签名不变**,[create.ts](../packages/core/src/composition/app/create.ts) 中 `rawProvider`、`createTrackedModel`、`resolveStepModel`、cost/telemetry 中间件包装的结构全部不动,只是背后从单实例换成按模型名分发。
- `resolveModelForAgent`([model-resolver.ts](../packages/core/src/modules/agent/model-resolver.ts))与 skill override([pipeline.ts getSkillStepOverrides](../packages/core/src/modules/agent-control/pipeline.ts))自动获得跨供应商能力,零改动。
- 仍只支持 OpenAI 兼容协议;非兼容协议(Anthropic 原生等)是后续阶段,届时在 registry 内按 entry 增加 `type` 字段分发到不同 SDK。

### 4.3 别名语义收敛

`ModelAliases` 类型与 `resolveModelAlias` 保留(代码侧声明层继续存在),但**语义收敛为两档**:

| 定义文件里写 | 解析为 |
|---|---|
| `'fast'` | `backgroundModel`(未配置时 → 主模型) |
| `'smart'` | 主模型(即 inherit) |
| `'default'` / `'inherit'` / 未写 | 主模型 |
| 具体模型名 | 原样(经 registry 用对应凭据创建) |

实现:`resolveModelAlias(name, aliases)` 的 aliases 参数由新配置构造:

```ts
{ fast: { model: backgroundModel ?? defaultModel }, smart: { model: 当前主模型 }, default: { model: 当前主模型 } }
```

这样 [explore.ts](../packages/core/src/modules/agent/built-in/explore.ts) 的 `model: 'fast'`、[research.ts](../packages/core/src/modules/agent/built-in/research.ts) 的 `model: 'smart'`、用户自定义 agent/skill 的写法**全部不用改**,只是解析结果变了(research 从"smart 别名"变为跟随主模型)。AgentDefinition 的 zod schema([agent/types.ts](../packages/core/src/modules/agent/types.ts))不动。

### 4.4 删除清单(纯减法)

整条 ModelSwapper 链路删除:

| 文件 | 动作 |
|---|---|
| [model-switching.ts](../packages/core/src/modules/session/model-switching.ts) | 整文件删除(ModelSwapper、detectModelSwitchIntent、SWITCH_KEYWORDS) |
| [task-complexity.ts](../packages/core/src/modules/session/task-complexity.ts) | 整文件删除(estimateTaskComplexity、getRecommendedModel) |
| [pipeline.ts:152-196](../packages/core/src/modules/agent-control/pipeline.ts) | 删除三段切换检查(checkUserIntent / checkTaskComplexity / checkCostBudget) |
| [session/state.ts](../packages/core/src/modules/session/state.ts) | 删除 modelSwapper 创建;`sessionState.modelSwapper` 字段移除 |
| [session/types.ts](../packages/core/src/modules/session/types.ts) / [interfaces.ts](../packages/core/src/modules/session/interfaces.ts) | 移除 modelSwapper 相关类型 |
| [session/index.ts](../packages/core/src/modules/session/index.ts) | 移除相关导出 |
| [behavior.ts](../packages/core/src/services/config/behavior.ts) | 删除 `availableModels`(ModelSpec)、`autoDowngradeCostThreshold`、`taskComplexitySwitch`;`modelAliases` 保留(由新配置构造注入) |

连带影响须一并处理:

- `sessionState.model` 保留——token 估算([pipeline.ts:211](../packages/core/src/modules/agent-control/pipeline.ts))和压缩标注仍消费它,只是不再被 swapper 改写。
- `createPricingResolver(undefined, availableModels)`([state.ts:61](../packages/core/src/modules/session/state.ts)):availableModels 删除后改为 `createPricingResolver(undefined, [])` 或从 `behavior.modelPricing` 走,实施时确认 pricing 路径。
- `ModelSwapper.getCurrentContextLimit` 的职责由新配置承接:主模型的 `contextLimit` 在建 agent 时从 `models[]` 条目读取,传入 `sessionOptions.maxContextTokens`(现有参数,已有消费链)。
- resolve-agent-config.ts 中 `FIELD_CONSUMERS` 表同步清理被删字段。
- 相关测试文件(agent-control.test.ts 等涉及 swapper 的用例)同步删除/调整。

## 五、应用层改造(packages/app)

### 5.1 runtime.ts

[getModelConfig](../packages/app/lib/runtime.ts) 签名从 `(aliasKey?)` 改为 `(modelId?)`:

```ts
// modelId 为空 → defaultModel;'__background__' 或语义化参数 → backgroundModel
export function getModelConfig(modelId?: string): { apiKey: string; baseURL: string; modelName?: string; contextLimit?: number }
```

按 `models[]` 查条目返回对应凭据。`bootstrap` 的 `behavior.modelAliases` 注入改为由新配置构造(见 4.3)。connector inbound 的 modelConfig 同步改为 defaultModel 条目。

### 5.2 API 路由

- [/api/config](../packages/app/app/api/config/route.ts):GET/PUT 直接透传新格式(`models` / `defaultModel` / `backgroundModel`);GET 对旧文件返回归一化后的新格式。
- [/api/chat](../packages/app/app/api/chat/route.ts):`modelName` 参数语义从"别名 key"变为"模型真名 id",`getModelConfig(modelName)` 按 id 查凭据。消息元数据存的 `model` 已是此值,无需改。
- [/api/models](../packages/app/app/api/models/route.ts):不变(仍按传入 baseURL/apiKey 拉取供应商模型列表,供设置页添加模型时选择)。

### 5.3 设置页 ModelSettings.tsx

重写为列表式:

- **模型列表区**:每行显示 `模型名 + 供应商(从 baseURL 推断,复用现有 PROVIDERS/detectProvider)+ contextLimit`,行操作 = 编辑/删除。
- **添加模型**:弹窗内选供应商预设(填 baseURL)→ 填 apiKey → 拉取模型列表(`/api/models`)选模型或手填 → 可选 contextLimit。现有的拉取模型 Dialog 逻辑基本复用。
- **两个单选标记**:列表行上勾选"默认模型"(必有一个)与"后台任务模型"(可不勾 = 跟随主模型)。
- 删除 fast/smart/default 三卡片 UI 及其 i18n 文案,新增列表相关文案。

### 5.4 输入框选择器 chat-selectors.tsx

[ModelSelector](../packages/app/components/chat-selectors.tsx) 数据源从 `data.modelAliases` 改为 `data.models`,`value` 为模型 id 真名,初始值 `defaultModel`。显示即真名,不再有别名→真名的映射层。

## 六、CLI 层(packages/cli)

[chat.tsx](../packages/cli/src/commands/chat.tsx) 首次配置引导:写入新格式(单条 model + defaultModel);`ensureConfig` 读取 `defaultModel` 对应条目。改动小,跟随核心层类型即可。

## 七、透明度补充(与本次重构同 PR 或紧随)

"用得明白"的另一半:

1. **消息标注模型**:消息元数据已存 `model`,聊天气泡/详情处显示本条回复由哪个模型生成。
2. **子 Agent 结果卡标注**:explore 等子 Agent 用了 backgroundModel 时,结果卡片标"由 deepseek-v4-flash 执行",用户可理解为何快/便宜。

## 八、实施顺序

```
1. core: GlobalConfig 新格式 + 归一化迁移        → verify: 新旧两种 models.json 均能加载,单测覆盖
2. core: createModelRegistry 替换单实例工厂       → verify: 多凭据条目各自命中;现有 provider 消费方零改动编译通过
3. core: 别名语义收敛(fast→background)          → verify: explore 走 backgroundModel、research 走主模型的单测
4. core: 删除 ModelSwapper 全链路                → verify: 全量测试通过,grep 无残留引用
5. app: runtime.ts + /api/config + chat 路由      → verify: 选择器选真名,对话按所选模型出账(costTracker 模型名核对)
6. app: ModelSettings 列表式重写 + 选择器改造     → verify: 添加两个不同供应商模型,分别对话均成功
7. cli: 配置引导与读取跟随                        → verify: cli chat 冒烟
8. 透明度:消息/子 Agent 卡标注模型               → verify: UI 目测
```

## 九、明确不做的事

- 不做运行时自动切换(复杂度升级/成本降级)——静默改变用户选择与透明原则冲突;预算问题未来以"提醒用户"形态解决。
- 不做对话中关键词换模型——UI 选择器已覆盖,且中文高频词("用"/"换")误触发不可接受。
- 不接非 OpenAI 兼容协议——registry 结构已预留 entry 级扩展点,需要时再加 `type` 分发。
- 不为"等级"保留任何用户可见概念——fast/smart 仅存在于 agent/skill 定义文件中,作为面向代码的声明。
