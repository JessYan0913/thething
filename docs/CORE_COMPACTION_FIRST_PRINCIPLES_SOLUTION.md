# Core 上下文压缩第一性原理解决方案

> 日期：2026-05-14  
> 范围：`packages/core` 中上下文预算、自动压缩、Session Memory Compact、MicroCompact、API 摘要压缩、PTL 降级以及相关配置传递。  
> 参考：
> - `docs/CORE_COMPACTION_ANALYSIS_AND_FIX_PLAN.md`
> - https://ccb.agent-aura.top/docs/context/compaction
> - https://ccb.agent-aura.top/docs/context/token-budget

---

## 1. 问题定义

当前 `packages/core` 的上下文压缩问题，本质不是某个阈值设置错误，而是系统没有围绕同一个“预算对象”做决策。

压缩系统真正要解决的问题只有一个：

```text
下一次发给模型的完整请求必须放进模型上下文窗口。
```

完整请求不是单纯的 `messages`，而是：

```text
完整请求 token =
  messages token
  + system instructions token
  + tools schema token
  + output reserve token
```

因此，压缩触发、压缩执行、初始预算检查、后台摘要、PTL 兜底，都必须回答同一个问题：

```text
当前完整请求是否接近或超过模型可用上下文预算？
```

当前代码的问题在于，不同模块分别使用了三种不同 token 口径：

| 口径 | 当前用途 | 根本问题 |
| --- | --- | --- |
| 累计会话 usage | `TokenBudgetTracker.shouldCompact()` | 这是历史消耗，不是下一次请求大小 |
| 当前 messages token | `estimateMessagesTokens(messages)` | 漏算 instructions、tools schema、output reserve |
| 完整请求 token | `estimateFullRequest(messages, instructions, tools, model)` | 目前只主要用于初始预算检查，没有成为统一策略 |

只要这三套口径继续并存，系统就会持续出现触发过早、触发过晚、重复压缩、触发后不执行、PTL 过早截断、不同模型行为不一致等问题。

---

## 2. 第一性原理

### 2.1 不可再分的硬约束

1. 模型上下文窗口是硬限制。请求 token 超过窗口，模型调用会失败。
2. 输出也需要上下文空间。不能把整个窗口都留给输入。
3. 工具 schema 和系统提示词是请求的一部分。它们消耗真实上下文。
4. 压缩的目标是让下一次完整请求可发送，而不是降低历史累计 usage。
5. PTL hard truncate 会丢失语义，只能作为紧急兜底，不能作为常规压缩策略。
6. 不同模型上下文窗口不同，压缩阈值必须从模型能力推导，而不是固定写死。

### 2.2 应被挑战的软约束和错误假设

| 假设 | 类型 | 为什么不成立 |
| --- | --- | --- |
| “累计 input/output usage 接近窗口就该压缩” | 错误假设 | 累计 usage 不是当前 prompt 大小；压缩后累计 output 仍会增长 |
| “messages token 足够代表请求大小” | 错误假设 | tools schema、instructions、output reserve 可能很大 |
| “25K/30K 是通用压缩阈值” | 错误假设 | 对 64K、128K、1M 模型含义完全不同 |
| “后台摘要可以保证当前请求可发送” | 错误假设 | 当前请求是否 fit 不能依赖异步后台任务 |
| “PTL 可以作为普通压缩步骤” | 错误假设 | PTL 是失败恢复或接近硬限制时的最后兜底 |
| “公开 API 定义了 compaction 就等于生效” | 错误假设 | 配置必须实际传到 runtime 并参与 policy 构建 |

---

## 3. 目标设计

### 3.1 单一事实来源：Prompt Budget Policy

新增统一预算策略，例如：

```ts
export interface PromptBudgetPolicy {
  modelName: string;
  contextLimit: number;
  outputReserve: number;
  bufferTokens: number;
  triggerPercent: number;
  triggerTokens: number;
  hardLimitTokens: number;
  emergencyBufferTokens: number;
}
```

建议默认值：

```ts
outputReserve = 8_000;
bufferTokens = 13_000;
triggerPercent = 0.85;
emergencyBufferTokens = 3_000;
```

推导方式：

```ts
const effectiveBudget = contextLimit - outputReserve;

const triggerTokens = Math.min(
  effectiveBudget - bufferTokens,
  Math.floor(effectiveBudget * triggerPercent),
);

const hardLimitTokens = effectiveBudget - emergencyBufferTokens;
```

这样可以同时满足：

1. 小窗口模型不会压到太晚。
2. 大窗口模型不会在 25K/30K 这种低位过早压缩。
3. 输出预留和安全缓冲始终被考虑。
4. 所有路径都使用同一套触发语义。

### 3.2 当前完整请求估算

统一使用当前完整请求估算：

```ts
export interface PromptBudgetEstimation {
  totalTokens: number;
  messagesTokens: number;
  instructionsTokens: number;
  toolsTokens: number;
  outputReserve: number;
  contextLimit: number;
  utilizationPercent: number;
}
```

核心计算：

```ts
totalTokens =
  messagesTokens +
  instructionsTokens +
  toolsTokens +
  outputReserve;
```

如果 pipeline 每步难以重新计算固定部分，可以在 agent 创建后缓存：

```ts
fixedPromptOverhead =
  instructionsTokens +
  toolsTokens +
  outputReserve;

currentRequestTokens =
  estimateMessagesTokens(messages, modelName) +
  fixedPromptOverhead;
```

这比 messages-only 判断更接近真实请求，也比累计 usage 更符合压缩目标。

---

## 4. 运行时职责重划

### 4.1 TokenBudgetTracker 只做 telemetry

`TokenBudgetTracker` 应继续记录：

1. 累计 input tokens。
2. 累计 output tokens。
3. cached input tokens。
4. 成本和使用率统计。

但它不应该决定是否压缩。

需要废弃或重命名：

```ts
tokenBudget.shouldCompact()
```

替代为：

```ts
shouldCompactRequest(estimation, policy)
```

原因很简单：累计 usage 是账单和统计口径，不是下一次 prompt 是否能放进窗口的判断口径。

### 4.2 Pipeline 使用完整请求预算触发

`runtime/agent-control/pipeline.ts` 中当前逻辑：

```ts
if (sessionState.tokenBudget.shouldCompact()) {
  const compactionResult = await sessionState.compact(messages);
}
```

应改成：

```ts
const budget = await sessionState.estimatePromptBudget(messages);

if (shouldCompactRequest(budget, sessionState.promptBudgetPolicy)) {
  const compactionResult = await sessionState.compact(messages, budget);
}
```

其中 `estimatePromptBudget()` 应基于：

```text
messages + cached instructions/tools/output reserve
```

如果工具集或模型发生变化，必须刷新缓存的 fixed overhead 和 policy。

### 4.3 compactMessagesIfNeeded 不再自行发明阈值

当前 `compactMessagesIfNeeded()` 内部又用 `COMPACT_TOKEN_THRESHOLD` 和 `estimateMessagesTokens()` 做二次判断，这会和 pipeline 的触发口径不一致。

应改为：

```ts
compactMessagesIfNeeded(messages, context)
```

其中 `context` 至少包含：

```ts
{
  conversationId: string;
  dataStore: DataStore;
  model?: LanguageModelV3;
  policy: PromptBudgetPolicy;
  fixedPromptOverhead: number;
  currentEstimation: PromptBudgetEstimation;
  compactionConfig: CompactionConfig;
}
```

执行函数可以判断“压缩收益是否太小”，但必须基于同一 policy 和同一目标预算。

---

## 5. 确定性的压缩链路

自动压缩应按以下顺序执行。

### 5.1 Step 0：预算判断

如果：

```ts
currentRequestTokens < policy.triggerTokens
```

直接跳过。

如果：

```ts
currentRequestTokens >= policy.triggerTokens
```

进入压缩。

如果：

```ts
currentRequestTokens >= policy.hardLimitTokens
```

标记为 emergency 风险，但仍应先尝试语义压缩，PTL 只作为最后兜底。

### 5.2 Step 1：已有 summary + boundary 快路径

如果当前 messages 中已有 summary，并且 `getMessagesAfterCompactBoundary()` 后的消息加上 summary 已经低于目标预算，应直接返回该结果。

注意：只要返回的 messages 发生变化，`executed` 就应该是 `true`，否则调用方可能不会应用结果。

### 5.3 Step 2：Session Memory Compact

如果数据库中已有摘要，优先使用它恢复历史语义，然后保留最近上下文。

适用场景：

1. 历史摘要已经存在。
2. 当前请求因后续对话增长再次接近上限。
3. 不需要同步 LLM 调用即可快速压缩。

执行后必须重新估算完整请求，而不是只看 messages token。

### 5.4 Step 3：MicroCompact

MicroCompact 只负责清理可安全降级的大工具输出，例如旧的 grep、read、web、connector 结果。

它不应该承担总结对话历史的职责。

执行后继续重新估算：

```ts
newRequestTokens =
  estimateMessagesTokens(newMessages) +
  fixedPromptOverhead;
```

如果已经低于目标预算，返回。

### 5.5 Step 4：同步 API 摘要压缩

如果 Session Memory Compact 和 MicroCompact 后仍然超过目标预算，必须同步调用 `compactViaAPI()` 生成摘要。

原因：

```text
当前请求是否能发送，是当前路径的正确性问题，不能依赖后台任务未来完成。
```

后台压缩可以作为优化，但不能作为当前请求 fit 的必要条件。

### 5.6 Step 5：PTL emergency fallback

只有当同步摘要压缩后仍然接近或超过 hard limit，才允许 PTL hard truncate。

PTL 判断应改为：

```ts
shouldRunPtl =
  currentRequestTokens >= policy.hardLimitTokens;
```

截断目标也应从 policy 推导：

```ts
hardTruncateTargetRequestTokens =
  Math.floor(policy.triggerTokens * 0.7);
```

再扣除 fixed overhead，得到 messages 目标：

```ts
hardTruncateTargetMessagesTokens =
  hardTruncateTargetRequestTokens - fixedPromptOverhead;
```

禁止继续使用固定：

```ts
30_000;
20_000;
```

---

## 6. 立即修复项

### 6.1 修复 autoCompactIfNeeded 的 await bug

当前代码：

```ts
if (!shouldTriggerAutoCompact(messages, conversationId)) {
  return false;
}
```

应改为：

```ts
if (!(await shouldTriggerAutoCompact(messages, conversationId))) {
  return false;
}
```

这是正确性 bug，应作为第一优先级修复。

### 6.2 停止使用累计 usage 触发压缩

移除 pipeline 中的：

```ts
sessionState.tokenBudget.shouldCompact()
```

改用当前请求估算：

```ts
const estimation = await sessionState.estimatePromptBudget(messages);

if (shouldCompactRequest(estimation, policy)) {
  ...
}
```

### 6.3 让自动压缩能同步生成摘要

`compactMessagesIfNeeded()` 在 fast paths 都不足时，应调用：

```ts
compactViaAPI(messages, conversationId, dataStore, model)
```

而不是只打印“后台会生成摘要”。

### 6.4 PTL 改为模型自适应

`tryPtlDegradation()` 应接收 policy 和 fixed overhead：

```ts
tryPtlDegradation(messages, {
  policy,
  fixedPromptOverhead,
})
```

触发和目标都从 policy 推导。

### 6.5 配置完整传递

`CreateAgentOptions.compaction` 和 `BehaviorConfig.compaction` 必须合并后传入 runtime。

需要至少打通：

1. `api/app/create.ts`
2. `runtime/agent/create.ts`
3. `runtime/session-state/state.ts`
4. `runtime/compaction/index.ts`

同时应传递：

1. `availableModels`
2. `autoDowngradeCostThreshold`
3. `maxDenialsPerTool`
4. `compactionConfig`

---

## 7. 建议实施计划

### 阶段 1：P0 正确性修复

目标：先让系统不再做明显错误的判断。

1. 修复 `autoCompactIfNeeded()` 缺少 `await`。
2. pipeline 不再使用 `TokenBudgetTracker.shouldCompact()`。
3. 为 session state 增加当前 prompt budget 估算能力。
4. `compactMessagesIfNeeded()` 接收统一 policy。
5. 自动链路在 fast paths 不足时同步调用 `compactViaAPI()`。
6. PTL 只在 emergency hard limit 附近触发。

### 阶段 2：统一预算策略

目标：让所有路径使用同一套模型自适应预算。

1. 新增 `runtime/compaction/prompt-budget-policy.ts`。
2. 将 `getAutoCompactThreshold()` 改为兼容 wrapper，内部调用新 policy。
3. `checkInitialBudget()` 使用 policy 判断 trigger/hard limit。
4. pipeline 使用 policy。
5. background compact 使用 policy。
6. PTL 使用 policy。

### 阶段 3：重构压缩执行链

目标：把当前分散路径整理成确定性顺序。

顺序固定为：

```text
budget check
-> summary + boundary fast path
-> session memory compact
-> micro compact
-> compactViaAPI
-> PTL emergency fallback
```

每一步后都重新估算完整请求。

### 阶段 4：配置/API 对齐

目标：公开 API、BehaviorConfig、runtime 行为一致。

1. `CreateAgentOptions.compaction` 合并进有效配置。
2. `modules.compaction === false` 时明确禁用自动压缩。
3. 删除或实现 `ENV_CONFIG.md` 中未生效的环境变量说明。
4. 明确 core 不直接读取环境变量，环境变量由 CLI/server 层解析后注入 BehaviorConfig。

### 阶段 5：测试覆盖

必须新增测试：

1. `autoCompactIfNeeded()` 会 await 异步触发函数。
2. pipeline 基于当前完整请求触发，而不是累计 usage。
3. 累计 usage 很高但当前请求很小时，不反复压缩。
4. tools schema 很大时，即使 messages 不大也会触发预算保护。
5. 128K 模型在 policy 触发点附近压缩。
6. 1M 模型不会在 25K 或 30K 过早压缩。
7. 没有已有 summary 时，自动路径会调用 `compactViaAPI()`。
8. PTL 只在 hard limit 附近运行。
9. `CreateAgentOptions.compaction` 实际影响 runtime 行为。

---

## 8. 推荐代码结构

建议新增文件：

```text
packages/core/src/runtime/compaction/prompt-budget-policy.ts
packages/core/src/runtime/compaction/request-budget.ts
```

### 8.1 prompt-budget-policy.ts

职责：

1. 从模型名、BehaviorConfig、用户 override 构建 policy。
2. 提供 trigger/hard limit 判断。
3. 屏蔽固定阈值。

示例 API：

```ts
export function buildPromptBudgetPolicy(input: {
  modelName: string;
  contextLimitOverride?: number;
  outputReserveOverride?: number;
  bufferTokens?: number;
  triggerPercent?: number;
  emergencyBufferTokens?: number;
}): PromptBudgetPolicy;

export function shouldCompactRequest(
  estimation: PromptBudgetEstimation,
  policy: PromptBudgetPolicy,
): boolean;

export function shouldRunEmergencyDegradation(
  estimation: PromptBudgetEstimation,
  policy: PromptBudgetPolicy,
): boolean;
```

### 8.2 request-budget.ts

职责：

1. 包装 `estimateFullRequest()`。
2. 支持固定开销缓存。
3. 给 pipeline 提供轻量估算。

示例 API：

```ts
export async function estimateRequestBudget(input: {
  messages: UIMessage[];
  instructions: string;
  tools: Record<string, Tool>;
  modelName: string;
  policy: PromptBudgetPolicy;
}): Promise<PromptBudgetEstimation>;

export async function estimateRequestBudgetWithFixedOverhead(input: {
  messages: UIMessage[];
  modelName: string;
  fixedPromptOverhead: number;
  policy: PromptBudgetPolicy;
}): Promise<PromptBudgetEstimation>;
```

---

## 9. 最终目标状态

修复后的系统应满足：

1. 初始预算检查和 pipeline 每步检查使用同一 budget policy。
2. 压缩触发基于当前完整请求，不基于历史累计 usage。
3. 压缩执行链不会使用另一个无关阈值二次否决。
4. 大模型不会被 25K/30K 固定阈值误伤。
5. 小模型仍有足够输出预留和安全缓冲。
6. 没有已有 summary 时，自动压缩能同步生成新摘要。
7. PTL hard truncate 只在 emergency 场景运行。
8. BehaviorConfig、CreateAgentOptions 和 runtime 行为一致。

---

## 10. 全量修复必须补充的边界细节

前面的方案可以解决主链路上的架构性问题，但要让“当前 Agent 的上下文压缩问题”在真实运行中完整闭环，还必须处理以下边界条件。

### 10.1 模型切换后刷新预算策略

Agent 运行中可能因为用户意图、成本阈值或技能要求切换模型。

模型一旦变化，以下值都可能变化：

1. `contextLimit`
2. `outputReserve`
3. `triggerTokens`
4. `hardLimitTokens`
5. tokenizer 选择

因此模型切换后必须刷新：

```ts
sessionState.promptBudgetPolicy;
sessionState.fixedPromptOverhead;
```

否则会出现旧模型预算继续约束新模型，或新模型窗口更小但仍使用旧的大窗口预算的问题。

实现要求：

1. `ModelSwapper` 成功切换模型后触发 budget policy rebuild。
2. `estimateMessagesTokens()` 和 `estimateFullRequest()` 使用当前模型名。
3. 如果模型切换会改变工具能力或 system prompt，也要重新估算 tools 和 instructions。

### 10.2 工具集变化后刷新 tools schema token

工具 schema 是完整请求的一部分。

当前 Agent 的工具集可能因为以下原因变化：

1. MCP 开启或关闭。
2. Connector 工具动态加载。
3. 权限过滤导致工具可见性变化。
4. 子代理或技能激活改变可用工具。
5. 初始预算检查执行了工具过滤。

因此不能假设 `toolsTokens` 在整个会话中永远不变。

建议做法：

```ts
fixedPromptOverhead =
  instructionsTokens +
  toolsTokens +
  outputReserve;
```

其中 `toolsTokens` 应在工具集变化后重新计算。

可以通过工具签名缓存避免重复计算：

```ts
toolsSignature = hash(tool names + tool descriptions + input schemas);
```

当 `toolsSignature` 变化时，刷新 `toolsTokens`。

### 10.3 Summary 新鲜度与 lastMessageOrder 可靠性

Session Memory Compact 依赖数据库中的 summary 和 `lastMessageOrder`。

这里存在几个风险：

1. messages 保存时重新编号，导致 `lastMessageOrder` 和当前数组索引不一致。
2. summary 是旧会话或旧分支生成的，和当前上下文不匹配。
3. 压缩后又插入了 attachment、memory、skill listing，summary 覆盖范围变得不清晰。
4. 多次压缩后 boundary 和 summary 的覆盖范围可能重叠或断裂。

建议补充 summary 元数据：

```ts
interface StoredSummary {
  conversationId: string;
  summary: string;
  lastMessageOrder: number;
  lastMessageId?: string;
  boundaryId?: string;
  sourceMessageHash?: string;
  modelName?: string;
  createdAt: string;
}
```

使用 summary 前至少校验：

1. `conversationId` 一致。
2. `lastMessageOrder` 在当前 messages 范围内。
3. 如果有 `lastMessageId`，当前对应位置或附近能找到该 message id。
4. 如果有 `sourceMessageHash`，可验证摘要覆盖段未发生重大漂移。

校验失败时，不使用旧 summary，改走 `compactViaAPI()`。

### 10.4 Tool call 与 tool result 必须成对保留

上下文压缩不能破坏模型协议结构。

如果保留了 tool result，却删除了对应 tool call，或者保留了 tool call 却删除了 result，模型可能报错或误解上下文。

压缩时必须保证：

1. tool call 和 tool result 成对保留或成对移除。
2. 同一个 assistant message 被拆成多个 records 时，相关 reasoning、tool call、text block 不能被拆断。
3. 对于仍处于当前 step 的工具调用，不允许压缩其输入输出。
4. MicroCompact 可以清空旧工具结果内容，但不能删除协议所需的结构字段。

建议增加独立校验函数：

```ts
validateToolPairIntegrity(messages): ValidationResult;
```

所有压缩步骤返回前都执行一次。

### 10.5 Post-compact reinjection 与 hooks 要么纳入主链路，要么明确废弃

当前代码中存在 post-compact reinjection 和 compact hooks 能力，但它们没有成为主压缩链路的一部分。

这会产生两个问题：

1. 用户以为重要文件、技能、项目上下文会在压缩后恢复，实际可能没有发生。
2. hooks 注册后如果不执行，会形成误导性的扩展点。

建议二选一：

1. 纳入主链路：在 `compactViaAPI()` 成功后执行 post hooks 和 reinjection，并重新估算预算。
2. 暂不支持：从公开 API 和文档中移除或标记为 experimental/internal。

如果纳入主链路，必须遵守同一 budget policy：

```text
summary + reinjected context + recent messages + fixed overhead <= trigger target
```

不能因为 reinjection 又把请求推回高水位。

### 10.6 Tokenizer 误差必须由 buffer 吸收

token 估算不可能完全等于模型服务端真实计数，尤其在以下场景：

1. 模型 tokenizer 与本地 tokenizer 不一致。
2. 工具 schema 在 provider 层被重新包装。
3. 图片、文件、reasoning block、tool call 结构有额外开销。
4. 不同 provider 对 system/tool 消息格式化不同。

因此 `bufferTokens` 和 `emergencyBufferTokens` 不是可选优化，而是预算正确性的一部分。

建议：

1. 默认 `bufferTokens` 不低于 `13_000`。
2. 对 tokenizer 未就绪或未知模型，使用更保守 buffer。
3. 记录服务端返回的 prompt token，与本地估算做 telemetry 对比。
4. 如果长期发现本地低估，应自动提高该 provider/model 的安全 buffer。

### 10.7 并发压缩与 circuit breaker 状态一致性

同一 conversation 可能出现：

1. pipeline 同步压缩。
2. background compact。
3. 用户手动 compact。
4. dispose 时等待后台压缩。

如果没有统一状态机，可能出现重复生成摘要、旧摘要覆盖新摘要、circuit breaker 状态和真实执行结果不一致等问题。

建议为每个 conversation 建立压缩状态：

```ts
type CompactionState =
  | "idle"
  | "sync-compacting"
  | "background-compacting"
  | "failed-open"
  | "circuit-open";
```

规则：

1. 同一 conversation 同一时间只允许一个写 summary 的压缩任务。
2. 同步压缩优先级高于后台压缩。
3. 后台压缩发现同步压缩已运行时应退出或等待。
4. 只有实际压缩失败才记录 circuit breaker failure。
5. 成功生成并保存 summary 后才记录 compact success。

### 10.8 modules.compaction 必须有明确语义

公开 API 中存在：

```ts
modules?: {
  compaction?: boolean;
}
```

该字段必须有明确行为。

建议语义：

1. `compaction !== false`：启用自动压缩。
2. `compaction === false`：禁用自动摘要和普通压缩，但仍允许最终 emergency PTL，除非另有更强配置显式禁止。

原因是 PTL 属于请求失败保护。即使用户禁用普通压缩，也通常不应让进程直接构造必然失败的请求。

### 10.9 请求失败后的 reactive compact/retry

即使预算估算正确，模型服务端仍可能返回 prompt too long。

因此还需要失败后的 reactive path：

```text
model call fails with context length error
-> refresh server-observed limit if available
-> run emergency compact/PTL
-> retry once
```

该路径必须限制重试次数，避免无限循环。

建议：

1. 只对明确的 context length error 触发。
2. 最多重试一次。
3. 重试前更新 policy 或临时提高 safety buffer。
4. 重试仍失败时返回可诊断错误，包含本地估算、模型限制、工具 tokens、instructions tokens、messages tokens。

### 10.10 压缩结果必须可观测

为排查压缩问题，运行时日志和 telemetry 至少应记录：

1. modelName
2. contextLimit
3. triggerTokens
4. hardLimitTokens
5. requestTokens before/after
6. messagesTokens before/after
7. instructionsTokens
8. toolsTokens
9. outputReserve
10. compaction type
11. tokensFreed
12. 是否调用 `compactViaAPI()`
13. 是否触发 PTL

这可以避免再次出现“看起来有阈值，但真实路径没有使用”的问题。

### 10.11 全量完成标准

只有满足以下条件，才能认为当前 Agent 的上下文压缩问题被完整解决：

1. 主链路使用统一 `PromptBudgetPolicy`。
2. pipeline 基于当前完整请求触发压缩。
3. 初始预算检查、自动压缩、后台压缩、PTL 使用同一 policy。
4. 模型切换和工具变化会刷新预算。
5. Session Memory Compact 校验 summary 新鲜度。
6. 所有压缩结果通过 tool pair integrity 校验。
7. 没有已有 summary 时会同步生成新摘要。
8. PTL 只作为 emergency fallback 或 reactive retry 使用。
9. `CreateAgentOptions.compaction` 和 `modules.compaction` 有真实运行时语义。
10. tokenizer 误差有 buffer 和 telemetry 闭环。
11. 并发压缩不会互相覆盖 summary。
12. 关键场景都有测试覆盖。

一句话总结：

```text
上下文压缩系统应该围绕“下一次完整模型请求是否放得下”设计，
而不是围绕历史累计 token、messages-only token 或固定阈值设计。
```
