# Compaction 统一化设计：消除双轨格式与双入口重复

> 起因：2026-07-21 生产事故。长 agent 运行后重新加载会话，上下文膨胀到 525k tokens，
> budget 检查全策略失败，Layer 3 的 ModelMessage 格式摘要消息泄漏到 route 层，
> `msg.parts is not iterable` 崩溃返回 500。
> 事故的补丁修复（lifecycle 双格式兼容、route 守卫、appendMessages 防重、后台 checkpoint）
> 已于 2026-07-22 落地。本文档是**根治方案**：让这类问题在结构上不可能再发生。

## 1. 问题定性

### 1.1 双轨格式从哪来

AI SDK 有两种消息格式，各有存在理由，我们无法消灭任何一种：

| 格式 | 结构 | 谁在用 |
|---|---|---|
| `UIMessage` | `.parts` 数组，工具结果是 `tool-<name>` / `dynamic-tool` part（`state: 'output-available'`，带 `.input`） | DB 存储、route 层、前端流 |
| `ModelMessage` | `.content` 数组，工具结果是 `type: 'tool-result'` 项（带 `.toolName`，无 `.input`） | `ToolLoopAgent` 内部循环、发给模型的实际请求 |

compaction 有两个接入点，恰好各在一轨上：

```
加载时（UIMessage）                    运行时（ModelMessage）
DB → route.ts → create.ts             ToolLoopAgent 内部
       ↓                                    ↓
checkInitialBudget                    prepareStep → compactBeforeStep
（budget-check.ts）                    （compaction/index.ts）
       ↓                                    ↓
   ┌─────────── 同一批底层函数 ───────────┐
   │  manageToolOutputLifecycle (Layer 2) │
   │  enforceContextWindow     (Layer 3) │
   │  estimateMessagesTokens             │
   └─────────────────────────────────────┘
```

事故根源：底层函数最初只认 ModelMessage。运行时路径一直正常（日志里
`[Context] 22-24%`），**加载时路径静默 no-op**，525k 就是这样累积的。
补丁修复让底层函数兼容两种格式，但代价是格式分发散布在
lifecycle.ts / token-counter.ts / context-window.ts / checkpoint.ts / index.ts
五个文件、约 15-20 个判断点。每个新功能、每个 bug 修复、每个测试都要考虑两轨。

### 1.2 双入口为什么存在（这部分是合理的）

| | `checkInitialBudget`（闸门） | `compactBeforeStep`（维护） |
|---|---|---|
| 时机 | Agent 创建前，一次性 | Agent 运行中，每步 |
| 失败语义 | 阻断：抛 `CONTEXT_BUDGET_EXCEEDED` → 413 | 不阻断：尽力压缩后继续 |
| 独有能力 | 工具过滤（策略 2）、紧急截断（策略 4）——只能在 Agent 创建前做 | Layer 1（Agent 主动释放 pendingCompactIds） |
| 输入格式 | UIMessage | ModelMessage |

**两个入口本身不是问题**——闸门和维护是真实的两种场景。问题是：

1. 两边各写了一套 "Layer 2 → 重新估算 → Layer 3 → 重新估算" 的编排循环
   （budget-check.ts:88-150 vs index.ts:57-92），参数各自硬编码
   （闸门用 `keepRecentSteps: 1`，维护用配置默认值 3）
2. 两边把**不同格式**的消息传给**同一批底层函数**，迫使底层函数双轨兼容

### 1.3 第三个隐患：摘要消息有两份格式实现

同一个"压缩摘要消息"概念存在两份构造代码：

- `context-window.ts:126-136`：`.content` 格式（ModelMessage），服务运行时管道
- `checkpoint.ts:27-36`：`.parts` 格式（UIMessage），服务 route 层加载

事故的直接崩溃点正是前者经 `budgetCheck.adjustedMessages` 泄漏到 route 层
（route 层假设全是 `.parts`）。目前靠 route 层的 `Array.isArray(msg.parts)`
守卫兜底，但"格式取决于哪条代码路径构造了它"这个结构性风险仍在。

## 2. 方案选型

### 方案 A：完整归一化（normalize/denormalize 往返）——不推荐

入口处把两种格式都转成内部 `CompactionMessage`，内部单格式处理，出口转回原格式。

**为什么不推荐**：UIMessage 的 part 类型开放且持续增长
（text / reasoning / file / source-url / source-document / data-* / step-start /
tool-* / dynamic-tool ...）。无损往返要求适配器穷举所有类型，
**漏一种就是静默丢数据**——和本次事故同类的错误模式（"不认识的格式 → 静默错误行为"）。
维护成本换了个地方存在，没有消失。

### 方案 B：视图 + 补丁（view + patch）——推荐

关键洞察：compaction 对消息的**读**很宽（要看文本、工具结果、大小、错误标记），
但**写**极窄——唯一的变更是"把某个工具输出替换为摘要字符串并打上 `_compacted` 标记"。

因此不转换消息本身：

```
原消息（任意格式，不动）
   │
   ├─► extractToolResultView(msg)      只读视图，唯一的"读格式"判断点
   │      → { role, items: [{ toolName, toolCallId, output, input,
   │                          size, isError, isCompacted, ref }] }
   │
   ├─► 决策逻辑（老化 / 超大 / 重复读 / 引用感知 / 错误保护）
   │      只操作视图，零格式判断                → patches: [{ ref, summary }]
   │
   └─► applyCompactionPatches(msg, patches)   唯一的"写格式"判断点
          UIMessage 分支：替换对应 part 的 output
          ModelMessage 分支：替换对应 content 项的 output
          不认识的 part/content 项 → 原样保留（天然无损）
```

格式知识收敛到**两个函数**（一读一写，各 ~40 行），决策逻辑（~400 行）完全格式无关。
新增 part 类型时视图函数最多"看不见它"（漏压缩，安全侧失败），
绝不会破坏消息结构（丢数据侧失败）。

### 入口统一：共享编排核心

```typescript
// compaction/core.ts（新）—— Layer 1/2/3 编排只写一次
async function runCompaction(
  messages: PipelineMessage[],
  config: CompactionConfig,        // 激进程度由 config 表达，不再硬编码在入口里
  context: CompactionContext,
): Promise<{ messages: PipelineMessage[]; tokensFreed: number; actions: string[] }>

// budget-check.ts —— 闸门 = 核心 + 独有策略
export async function checkInitialBudget(...) {
  let r = await runCompaction(messages, aggressiveConfig(config), context)  // Layer 1+2+3
  // 策略 2：工具过滤（独有）
  // 策略 4：紧急截断（独有）
  // 闸门语义：不通过 → passed: false（调用方抛 CONTEXT_BUDGET_EXCEEDED）
}

// compaction/index.ts —— 维护 = 核心本身
export async function compactBeforeStep(...) {
  return runCompaction(messages, config, context)
}
```

### 摘要消息：单一构造函数

```typescript
// 摘要消息构造收敛到一处，调用方声明目标格式
function buildSummaryMessage(summary: string, format: 'ui' | 'model'): PipelineMessage
```

`enforceContextWindow` 增加 `outputFormat` 参数（运行时管道传 `'model'`，
闸门路径传 `'ui'`），checkpoint.ts 复用 `'ui'` 分支。
从此"摘要消息是什么格式"由调用方显式声明，而非隐含在哪条代码路径里。

## 3. 实施步骤

每步独立可验证、可单独提交，测试基线：compaction + datastore 全部 99 个用例保持绿。

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | 新建 `compaction/message-view.ts`：`extractToolResultView` + `applyCompactionPatches`，先写测试（用现有 UIMessage / ModelMessage 两轨用例，验证视图提取正确、补丁写回无损、未知 part 原样保留） | 新测试全绿 |
| 2 | `lifecycle.ts` 内部改用视图+补丁：`hasToolResults` / `getToolResultItems` / `compactToolResults` / `isErrorResult` / `findStaleDuplicateReads` / `findReferencedResults` 的格式分发全部删除，只留决策逻辑 | 现有 lifecycle 测试（含 UIMessage 6 例）不改动、全绿；行数预期从 ~680 降到 ~450 |
| 3 | `token-counter.ts` 的 `estimateMessageTokens` / `extractMessageText` / `hasTextBlocks` / `stripImagesFromMessages` 改用视图（视图需补充 text/reasoning/file 条目——只加"读"，不加"写"） | token-counter 相关测试全绿 |
| 4 | 摘要消息统一：新建 `buildSummaryMessage(summary, format)`，`enforceContextWindow` 加 `outputFormat` 参数，checkpoint.ts 复用；删除两处内联构造 | checkpoint + context-window 测试全绿；加一例断言闸门路径产出 `.parts` 格式摘要 |
| 5 | 抽 `runCompaction` 核心：`compactBeforeStep` 改为薄封装；`checkInitialBudget` 策略 1/3 改调核心（`outputFormat: 'ui'`），保留策略 2/4 | budget-check + 集成测试全绿 |
| 6 | 清理：route.ts 的 `Array.isArray(msg.parts)` 守卫**保留**（防御纵深），create.ts:279 的双轨警示注释更新为指向本文档 | 全量 core 测试，无新增失败（既有 20 个失败与本模块无关，见基线记录） |

预计规模：新增 ~250 行（视图+补丁+核心+测试），删除 ~400 行（分发代码+重复编排），净 -150 行。

## 4. 不做什么（范围边界）

- **不消灭双入口**：闸门/维护是真实的两种场景，统一的是编排核心，不是入口
- **不做完整消息格式转换**（方案 A 的往返 normalize），理由见 2 节
- **不动 DB 存储格式**：UIMessage 入库是 AI SDK 生态的自然选择，不改
- **不动 `PipelineMessage` 联合类型的对外签名**：对 create.ts / pipeline.ts 调用方透明
- **不在本次重构里顺手改压缩策略**（水位线、keepRecentSteps 等参数维持现状）

## 5. 完成判据

1. `grep -c "Array.isArray(parts)\|Array.isArray(content)" compaction/*.ts` 在
   message-view.ts 之外为 0
2. 全部 compaction / datastore / budget 测试通过（含事故回归用例：
   UIMessage 工具输出压缩、摘要消息格式、appendMessages 防重）
3. 新增 part 类型的假想演练：只需改 `extractToolResultView` 一个函数
4. 摘要消息构造点全仓唯一（`buildSummaryMessage`）

## 6. 相关文档

- `docs/context-compaction-analysis.md` —— 三层压缩体系的原始设计
- `docs/compaction-execution-plan.md` —— Layer 2 步进老化的落地计划
- 2026-07-21 事故的补丁修复：lifecycle 双格式兼容、route 层守卫、
  `CONTEXT_BUDGET_EXCEEDED` 413、appendMessages 同内容防重、
  `maybeCheckpointAfterRun` 后台 checkpoint（本文档步骤完成后，
  双格式兼容代码将被视图+补丁替代，其余修复保留）
