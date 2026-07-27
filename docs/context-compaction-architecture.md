# 上下文压缩机制架构文档

> 最后更新：2026-07-26
> 状态：已实施。2026-07-25 经对话 A5j5lHn 四轮重跑验证端到端生效。

## 概览

压缩系统从"agent 的行动记忆"视角设计，而非"待压缩的 token 预算"。核心是**四条不变式**贯穿所有压缩路径（lifecycle / 确定性压缩 / 紧急 LLM 摘要 / checkpoint），保证压缩不破坏 agent 继续任务的能力。

历史教训：2026-07-25 对话 A5j5lHn 暴露四个 bug（读循环、孤儿锚点、guard 误触发、摘要丢 provenance），都是"删了不该删的 key"的变体。根因是 `extractMessageText` 把工具调用输入（key=provenance）和工具结果输出（value=内容）当同类 content 一起处理。修复：立 key/value 分离不变式。

## 四条不变式

1. **感知-行动环不可断**：当前步（最近一次工具结果）永不 meta 化，超大改可见截断（保留头尾+省略标记+找回提示）。模型永远能看到刚执行的结果。
2. **key 永不被驱逐**：工具调用输入（toolName + input args，如 filePath/url/command）在所有压缩路径中保留全文。只有工具结果输出（value）走降级阶梯。
3. **语义类工具超大截断不 meta**：read_file / read_wiki_page 等模型主动要看的内容，超大时可见截断而非 meta 化（meta 化等于把模型要的信息抹掉）。
4. **读循环熔断**：同文件被读 ≥3 次 -> 自动 pin，最新读取豁免压缩 + 遥测上报。

## 架构层次

### Layer 2: 工具输出生命周期管理（主力）

**实现**：`packages/core/src/modules/compaction/lifecycle.ts`，每步 API 调用前同步执行。

唯一预算分配器，按优先级花 token 预算，降级阶梯**只作用于 value**：
```
完整 value -> 可见截断(_truncated,头尾+省略标记) -> meta(_compacted,元信息+落盘) -> evict(台账记录)
```

**决策优先级**（高到低）：
- 错误结果 / 小输出 / pin 的最新读取 -> 保留完整
- 当前步结果 -> 永不 meta；超大截断（不变式 1）
- 同文件重复读的更早副本 -> meta（去重）
- 超出最近 K step 且未被引用 -> meta
- 边界内超大：语义类截断（不变式 3），瞬态类（bash/grep/web）meta + 落盘

**key 保留**：lifecycle 压缩时只替换 output，`input` 字段原样保留（不变式 2）。

**读循环熔断**：`detectReadLoops` 统计同文件读取次数（含已 meta 的历史副本），≥3 次 -> `ContextLedger.autoPin`。

### Layer 2.5: 确定性文本压缩

**实现**：`packages/core/src/modules/compaction/message-compressor.ts`。Layer 2 后仍超限触发。

`extractKeyInformation` 用 `extractActionLog`（非丢 key 的 `extractMessageText`）抽取文件路径/URL/命令，生成结构化摘要。保留首尾消息。

### Layer 3: 紧急 LLM 摘要

**实现**：`packages/core/src/modules/compaction/emergency-summary.ts`。Layer 2.5 后仍超限触发。

摘要器输入用 `renderActionLog(extractActionLog(...))`（不变式 2）--LLM 能看到 `web_fetch(url=...)`、`read_file(filePath=...)`，保得了 provenance。带重试 + fallback models。

### 降级兜底: 强制截断

所有压缩失败时保留 15% 消息（首尾为主）。保证永不 413。

### 后台 Checkpoint（长期记忆）

**实现**：`packages/core/src/modules/compaction/checkpoint.ts` + `context-window.ts`。运行结束后 `finalizeAgentRun` 异步触发，水位 >50% 生成摘要落库。

**关键：summary 携带机器生成的 provenance 段**：`generateAndPersistCheckpointSummary` 持久化时 append `## 行动日志（provenance）` 段（`renderKeysOnlyActionLog`），列清所有曾执行的工具调用（URL/path/command）。provenance 由代码保证，不靠 LLM 听话。

**加载自愈**：`selfHealOrphanedCheckpoint`（在 `compactBeforeStep` 首轮 API 调用前）检测两种"无效 checkpoint"并强制重建：
1. 孤儿 anchor：regenerate/edit 让 anchor 消失出活跃链。
2. 旧格式摘要：缺 `## 行动日志（provenance）` 段（commit 4d461c0 之前），丢了 key。

绕过 50% 水位线（force=true）--大上下文模型 + Layer 2 meta 化后 in-memory token 变小，水位线永不触发，存量摘要不会自动升级，必须自愈。

**超大消息 split 修复**：`maybeCheckpointAfterRun` 的 split 循环遇到单条 `msgTokens >= keepBudget` 的超大消息时，`splitIndex = i+1`（该消息进 olderMessages 用摘要替换），而非 `splitIndex = i`（留在保留段）。否则 1MB 的 read-loop 产物会原样留在上下文里盖过用户指令。

## 数据流

```
用户消息 -> route.ts: applyCheckpointOnLoad(全量 activeMessages)
            (传全量含本次 user msg,避免 newerMessages 空 guard 误触发)
   ↓
Agent 运行 -> prepareStep -> sessionState.compact -> compactBeforeStep
   ↓
[1] selfHealOrphanedCheckpoint  检测孤儿/旧格式 -> 强制重建 checkpoint
   ↓
[2] applyCompactionView         跨步骤视图（Layer 3 摘要的前缀替换）
   ↓
[3] manageToolOutputLifecycle   Layer 2: key 保留,value 降级,读循环熔断
   ↓
[4] 预算检查 + applyEmergencyCompression (Layer 2.5 -> 3 -> 截断)
   ↓
发给模型
   ↓
──── 运行结束后 finalize ────
maybeCheckpointAfterRun -> generateAndPersistCheckpointSummary
   - 输入: renderActionLog (key 全文)
   - 持久化: LLM 语义摘要 + 机器 provenance 段
```

## 配置参数

**Lifecycle** (`DEFAULT_LIFECYCLE_CONFIG`):
```typescript
{
  keepRecentSteps: 3,              // 保留最近 3 个 step 完整 value
  largeOutputThreshold: 8000,      // >8KB value 走降级
  compactableTools: null,          // null = 默认列表 + mcp_* + connector_*
  protectedTools: new Set(),
  messageBudget: 100_000,          // 跨消息总预算
}
```

**Checkpoint**:
```typescript
{
  CHECKPOINT_TRIGGER_PERCENT: 0.5,  // 50% 水位触发后台 checkpoint
  CHECKPOINT_KEEP_PERCENT: 0.3,     // checkpoint 后保留 30% 完整消息
  MIN_KEEP_MESSAGES: 2,
  READ_LOOP_THRESHOLD: 3,           // 读循环熔断阈值
}
```

## 模型参与（闭环反馈）

- **context_pin 工具**：模型可 pin 住核心文件（豁免压缩）、release、查询台账（`formatLedger`）。
- **ContextLedger**（会话级，`state.ts` 注入）：记录 pin + 压缩动作，模型按需查询。台账不注入消息流（保 prompt cache）。
- **遥测**：`read_loop_detected` 等事件上报压缩副作用。

## 不变式

1. **感知-行动环不可断**：当前步结果永不 meta。
2. **key 永不被驱逐**：tool-call 输入在所有压缩路径保留全文。
3. **语义类超大截断不 meta**。
4. **读循环熔断**：同文件读 ≥3 次自动 pin。

## 测试覆盖

- `lifecycle.test.ts` / `compaction.test.ts` / `compaction-config-driven.test.ts` - Layer 2 + 不变式
- `value-aware.test.ts` - 错误保护 / 去重 / 引用感知
- `read-loop-regression.test.ts` - 读循环回归（事故复现）
- `action-log.test.ts` - key/value 分离 + key 永不驱逐断言
- `checkpoint.test.ts` - checkpoint + 自愈（孤儿/旧格式）+ 超大消息 split
- `lifecycle-storage.test.ts` - 落盘可找回
- `guaranteed-compaction.test.ts` - 永不 413

## 历史演进

- **2026-07-21 事故**：525k tokens 泄漏 + `msg.parts is not iterable` 崩溃。八层机制 + 濒死同步 LLM 摘要（66s 失败）。
- **2026-07-23 重构**：删 Layer 1 / message-budget.ts / 同步 LLM 路径。统一消息格式（message-view.ts）。四层保证 + 后台摘要。
- **2026-07-25 读循环事故**（对话 A5j5lHn）：skill-creator/SKILL.md(489行)被 read_file 读取后 largeOutputThreshold 触发 tooLarge 把输出 meta 化为 "Read X -> N lines"，read_file 不落盘无法找回 -> 模型连读 7 次（另一轮 31 次）-> 目标漂移、幻觉用户指令、谎报完成。根因：压缩切断了感知-行动环 + key/value 不分。
- **2026-07-25~26 根治**（8 commits）：
  1. 感知-行动环保护 + 读循环熔断（`c42f48d`）
  2. pre-existing 测试 bug 修复（`a44bbcd`）
  3. pre-existing tsc 修复（`ecd6dca`）
  4. 孤儿锚点自愈（`1d0f6c6`）
  5. route.ts 传全量修复 guard 误触发（`7b7ffad`）
  6. key/value 不变式 + action-log 端到端（`4d461c0`）
  7. 旧格式摘要自愈（`582a050`）
  8. 超大消息 split 修复（`7056103`）

## 相关文件

**核心模块**：
- `lifecycle.ts` - Layer 2 唯一分配器
- `action-log.ts` - key/value 分离的根（extractActionLog + renderActionLog）
- `checkpoint.ts` - 后台 checkpoint + 自愈
- `context-window.ts` - 摘要生成 + provenance 段
- `emergency-summary.ts` - Layer 3
- `message-compressor.ts` - Layer 2.5
- `message-view.ts` - 消息格式统一（双轨收敛）
- `context-ledger.ts` - 台账 + pin 注册表
- `compaction-telemetry.ts` - 遥测
- `token-counter.ts` - token 估算

**路线图**：见 [`compaction-road-to-excellent.md`](./compaction-road-to-excellent.md)（从"可用"到"优秀"的差距与方向）。
