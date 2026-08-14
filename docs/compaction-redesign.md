# 上下文压缩重构设计（V3）

> 日期：2026-08-14
> 范围：`packages/core/src/modules/compaction/` 及其调用链（`composition/app/create.ts`、`modules/agent-control/pipeline.ts`、`modules/session/state.ts`、`composition/finalize.ts`）
> 状态：**设计稿 + 实施记录**。基于已提交的 V1（7 月架构）重新思考，吸收三代教训。
> 参考：
> - `docs/CORE_COMPACTION_FIRST_PRINCIPLES_SOLUTION.md`（5月20号设计，第一性原理）
> - `docs/context-compaction-architecture.md`（V1 架构，已实施）
> - `docs/model-driven-compaction-design.md`（模型主动压缩草案）
> - 已回退的 `COMPACTION_V2_DESIGN.md` / `compaction-bug-analysis.md` / token-estimation-v3 基座（本设计将其精华正式纳入）

> **实施状态（2026-08-14）**：
> - ✅ Step 1（L0 估算地基）、Step 2（L1 统一预算策略）、Step 3（触发语义主动水位）已实施。
> - ✅ §5.4 最小消息预算保护、§4.6 reactive retry 诊断错误、§4.8 UI 水位从 policy 读已实施（A 组补全）。
> - ⏸ Step 4（增量扫描）已推迟，见 §5.1 实施决定。

---

## 1. 问题定义与现状盘点

### 1.1 三代演进的教训

| 代 | 核心思想 | 最终归宿 |
|----|---------|---------|
| **5月20号设计**（第一性原理） | 一切围绕「下一次完整请求能否塞进窗口」；单一 `PromptBudgetPolicy`；统一请求估算；确定性压缩链；模型自适应阈值 | 原则大多被 7 月实现吸收（budget-check / checkpoint / reactive retry / PTL），但「单一预算对象」落地不彻底——阈值仍散落各处 |
| **V1（7月，已提交）** | 四条不变式（感知-行动环 / key 永不驱逐 / 语义类截断 / 读循环熔断）+ 每步 value 降级阶梯 + 后台 checkpoint + compaction view | 价值阶梯正确，是压缩的"心脏"，必须保留。但估算仍是字符级、触发滞后、每步全量重扫 |
| **V2 设计（未提交）** | 源头管理：每步自动替换旧工具输出，极少调 LLM；另附 token-estimation-v3 基座 | V2 的前提（"V1 = 6 步事后补救"）对已提交代码已过时——V1 早已是每步统一分配器。真正的新增量是估算基座（BPE + 校准 + 缓存 + 图片计费），被回退，需重新纳入 |

**一句话总结教训**：降级策略（怎么压）已经做对了；错的是**标尺**（估算不准）、**时机**（100% 才升档）、**代价**（每步全量重扫）、**复杂度**（机制堆叠、阈值散落）。

### 1.2 现状架构盘点（V1，23 文件 ~5000 行）

```
compactBeforeStep (index.ts) —— 每步入口
  ├─ selfHealOrphanedCheckpoint   (checkpoint.ts) 孤儿锚点/旧格式自愈
  ├─ applyCompactionView          (compaction-view.ts) L3 摘要后 O(1) 前缀复用
  └─ manageCompaction             (lifecycle.ts) 统一分配器
       ├─ 档1: manageToolOutputLifecycle  value 阶梯(完整→截断→meta→TTL台账) + 跨消息预算
       ├─ 估算: estimateFullRequest       (token-counter.ts, 字符级)
       └─ 档2-4: applyEmergencyCompression  确定性摘要→LLM摘要→强制截断
checkInitialBudget (budget-check.ts) —— Agent 创建时: 4 策略(压 value→紧急→过滤工具→极简)
maybeCheckpointAfterRun (checkpoint.ts + context-window.ts) —— 运行结束后后台摘要落库
handleReactiveRetry (retry.ts) —— context-length 错误 → 激进 Layer 2
支撑: message-view(格式无关视图) / action-log(provenance) / context-ledger(pin+台账)
     / compaction-telemetry / state-tracker / deterministic-compressor / emergency-summary
     / force-truncate / gate(最终不变量) / incremental-estimation(存在但被绕过)
```

接线（已确认）：
- `create.ts:327` 初始预算 → `:357` gate 最终不变量 → `:381` 注入 `sessionState.compact`（带 tools/instructions/storage）
- `pipeline.ts:168` 每步 `sessionState.compact(messages)` → `compactBeforeStep`
- `finalize.ts:83` 运行结束 `maybeCheckpointAfterRun`
- `agent/tools.ts:87` `context_pin` 工具已存在（模型主动 pin）；无 `compact_tool_result`（主动释放）

### 1.3 真实问题清单（按严重性）

**P0-1 估算地基失真（标尺是错的）**
- `token-counter.ts` 全链路字符估算（`estimateTokensFromChars`），对 CJK/代码/结构文本系统性偏差，且**不随模型/provider 变化自校正**。
- 图片/文件 part **完全不计数**（`estimateMessageTokens` 只累加文本）→ 多图会话严重低估 → 触发过晚。
- **无 usage 真值闭环**：provider 返回的 `usage.inputTokens` 是免费真值，当前完全没用。
- **无消息级缓存**：每步 `estimateFullRequest` 全量重算（含 `JSON.stringify` 每个工具输出）。
- 后果：所有百分比阈值都挂在错误标尺上。触发过早/过晚表面上像"时机问题"，根因在估算。

**P0-2 触发语义滞后（动手太晚）**
- 每步 `manageCompaction` 只在 `estimation.exceedsLimit`（**总量 > 窗口 = 100%**）时才升档到确定性/LLM/截断（`lifecycle.ts:956`）。重档压缩永远发生在"请求已经超限"之后，先放任再抢救。
- 85% 水位只存在于 `pipeline.ts` 的 UI 展示（TRIGGER 标签），**不驱动任何动作**。
- load-time 的 `checkInitialBudget` 用另一套阈值（messages>0.2、tools>0.1、0.3）——两套标尺、口径不一致。

**P0-3 预算/阈值无单一事实来源**
- 魔法数字散布：`0.2 / 0.1 / 0.3 / 0.8 / 0.6 / 0.5 / 0.15`、`30k`、`50`、`20`、`40`、`200`、`8000`、`100k`。
- 5月20设计的核心原则（单一 `PromptBudgetPolicy`）未完全落地；`outputReserve`/`buffer` 与窗口关系没有统一推导。
- `targetPercent` 配置存在（types.ts 默认 0.7），但各调用点各自硬编码（emergency 0.6、force-truncate 0.15、budget-check 0.3/0.05）。

**P1-1 每步全量重扫的代价**
- `manageToolOutputLifecycle` 每步对全量消息 map：`extractToolResultView`（序列化输出算 size）、全局扫描（`analyzeReads`/`findReferencedResults`/`detectReadLoops`）、`applyCompactionPatches`。长对话 O(n) + 字符串开销每步重复。
- `incremental-estimation.ts` 已存在，但 `manageCompaction` 注释明确"压缩后缓存失效"绕过它，每步全量 `estimateFullRequest`。

**P1-2 复杂度 / 认知负荷**
- 23 文件 ~5000 行。机制堆叠：value 阶梯 + 跨消息预算 + 读去重 + pin + TTL 老化 + 引用感知 + compaction view + checkpoint（两触发+自愈）+ budget-check（4 策略）+ reactive retry + ledger + telemetry + state-tracker + 确定性压缩 + 紧急摘要 + 强制截断 + action-log + gate + 增量估算。
- 缺乏清晰的分层心智模型，维护成本高。

**P2-1 配置面与魔法数字**（见 P0-3）
**P2-2 失败诊断缺失**：reactive retry 无法恢复时抛 `CONTEXT_BUDGET_EXCEEDED`，但错误信息不含估算分解（本地估算/模型窗口/tools/instructions/messages/outputReserve），排障困难。

---

## 2. 设计目标与原则

### 2.1 目标

| 编号 | 目标 | 可验证标准 |
|------|------|-----------|
| G1 | 下一次完整请求必可发送 | 永不因 context-length 失败（reactive 兜底除外） |
| G2 | 信息损失最小，感知-行动环永不中断 | 四条不变式在全部档位成立 |
| G3 | 长期记忆可持续 | checkpoint 落库、增量摘要、跨会话恢复 |
| G4 | 每步代价有界 | 不随历史线性增长，O(delta) |
| G5 | 系统副作用有反馈闭环 | 读循环/过度压缩 → 自动 pin |
| G6 | 复杂度可维护 | 单一心智模型、阈值单一来源 |

### 2.2 原则（不变式，贯穿所有档位）

1. **P1 单一预算对象**：所有路径（load / per-step / retry / checkpoint / gate / UI）读同一个 `BudgetPolicy`，禁止魔法阈值。
2. **P2 估算即真相**：触发/决策基于「完整请求估算 + 校准 buffer」，不基于累计 usage、不基于 messages-only。
3. **P3 只降级 value，永不驱逐 key**：工具调用输入（provenance）全程保留；输出走 完整→可见截断→meta→台账 阶梯。
4. **P4 感知-行动环不可断**：当前步结果永不 meta；语义类工具可见截断不 meta；读循环自动 pin。
5. **P5 先便宜后昂贵**：先同步无成本手段（value 降级/确定性），LLM 摘要只在后台非濒死时刻，强制截断是最后保底。
6. **P6 DB 永远是全量真相**：压缩只在内存对请求生效，绝不改写 DB 历史；加载/自愈一律以 DB 为准。
7. **P7 摘要只在后台**：不在每步同步调 LLM（濒死时刻是最差时机）；checkpoint + compaction view 保证前缀稳定。
8. **P8 可观测 + 自纠**：每个决策可追溯（telemetry/ledger），并有自我纠错机制（过度压缩检测 → autoPin）。

---

## 3. 目标架构总览

### 3.1 分层

```
┌───────────────────────────────────────────────────────────┐
│  L5 反馈层  ContextLedger(pin/台账/读循环/过度压缩) + Telemetry │
├───────────────────────────────────────────────────────────┤
│  L4 失败层  ReactiveRetry + 诊断错误                         │
├───────────────────────────────────────────────────────────┤
│  L3 摘要记忆层  Checkpoint(后台) + CompactionView(O(1)复用)   │
├───────────────────────────────────────────────────────────┤
│  L2 降级层  value 阶梯 + 四不变式 + 增量扫描(compaction cursor) │
├───────────────────────────────────────────────────────────┤
│  L1 预算策略层  deriveBudget → trigger/hardLimit/target     │
├───────────────────────────────────────────────────────────┤
│  L0 估算层  三级引擎(BPE/近似/字符) + usage校准 + 消息缓存      │
└───────────────────────────────────────────────────────────┘
        │ 唯一入口：compactBeforeStep（load 用 checkInitialBudget）
        ▼
   DB 全量历史（永不被压缩改写）⇄ 内存压缩视图（仅对请求生效）
```

### 3.2 模块布局建议（文件映射）

| 层 | 建议文件 | 处置 |
|----|---------|------|
| L0 | `primitives/tokenizer/`（encoding-registry / tiktoken-engine / message-token-cache / usage-calibrator / index） | **新增**（即被回退的 V3 基座，正式纳入） |
| L0 | `modules/compaction/tokenizer.ts`（适配层，保持导出签名） | 重写（接入三级引擎 + 校准 + 缓存） |
| L0 | `modules/compaction/token-counter.ts` | 改造（图片计费 + compacted summary 计费 + 消息级缓存 + contextLimitOverride 已存在） |
| L1 | `modules/compaction/prompt-budget-policy.ts`（`deriveBudget`） | **新增**（收敛散落阈值） |
| L1 | `modules/compaction/request-budget.ts`（含校准 buffer 的组装） | **新增**（组装 totalWithBuffer） |
| L2 | `lifecycle.ts`（阶梯+不变式） | 保留核心；TTL 惰性化；增量化 |
| L2 | `message-view.ts` / `action-log.ts` | 保留（不动） |
| L3 | `checkpoint.ts` / `context-window.ts` / `compaction-view.ts` | 保留（不动） |
| L4 | `retry.ts` | 保留 + 补诊断错误 |
| L5 | `context-ledger.ts` / `compaction-telemetry.ts` / `state-tracker.ts` | 保留（不动） |
| — | `budget-check.ts` / `gate.ts` | 改造（统一读 policy；策略同标尺） |
| — | `incremental-estimation.ts` | 合并进 L0 消息缓存 + L2 增量扫描（不再单独存在） |
| — | `deterministic-compressor.ts` / `emergency-summary.ts` / `force-truncate.ts` | 保留（目标 token 从 policy 取） |
| — | `types.ts` | 配置面收敛（见 4.8） |

**核心结论**：不推倒重来。V1 的价值阶梯、checkpoint、view、ledger 全部保留；重构聚焦 **L0 估算地基 + L1 统一策略 + 触发语义 + L2 增量代价** 四件事。

---

## 4. 分层设计

### 4.1 L0 估算层

**三级引擎**（`primitives/tokenizer/`）：
- `exact`：GPT 系列 → `o200k_base` / `cl100k_base`（js-tiktoken BPE，与训练词表一致）
- `approximate`：已知模型族（qwen/deepseek/glm/kimi/llama/claude…）→ `cl100k_base`（最近公开近似，系统性偏差交给校准）
- `char`：未知模型 → 字符估算回退
- 性能防护：小文本（<1000 chars）/ 超长文本（>20k chars）/ 高重复文本（O(n²) 病态）→ 字符估算

**消息级 token 缓存**（`message-token-cache.ts`）：`cacheFingerprint`（role + toolCallId + 输出长度/首64字符；文本首尾32字符）。压缩改写输出 → 指纹变 → 自动 miss 重算，等价精准失效，不依赖压缩层报告。

**图片/文件计费**：`estimateMessageTokens` 中 `image`/`file` part 记固定保守值（如 1500 tokens/张，只求不低估，宁可超估由校准吸收）。当前完全不计数是 P0-1 的真缺陷。

**usage 真值校准**（`usage-calibrator.ts`）：每步估算 base → 下一步 `usage.inputTokens` 配对 → EMA（α=0.3）→ `driftRatio` clamp [0.85, 1.6]；异常样本拒绝（<0.5 或 >3）；模型切换重置（词表不同不可迁移）。

**组装**（`request-budget.ts`）：
```
totalWithBuffer = messagesTokens + instructionsTokens + toolsTokens + outputReserve
                + tokenizerBuffer        // tokenizerBuffer = baseTokens × (driftRatio − 1)
```

### 4.2 L1 预算策略层（单一事实来源）

```ts
// prompt-budget-policy.ts —— 纯函数，无副作用
deriveBudget(contextLimit, outputReserve, modelName?) → BudgetPolicy {
  effectiveBudget = contextLimit − outputReserve
  bufferTokens = clamp(effectiveBudget × ratio[encodingLevel], min[level], 50_000)
  //   exact 4%·min2000 / approximate 8%·min3000 / char 15%·min5000
  triggerTokens   = effectiveBudget − bufferTokens      // 达到 → 主动升档压缩
  hardLimitTokens = effectiveBudget − 3000              // 达到 → 强制降级
}
targetTokens(contextLimit, targetPercent)               // 压缩后目标（默认 0.6~0.7）
```

**删除所有散落百分比**。`0.2 / 0.1 / 0.3 / 0.8 / 0.6 / 0.5 / 0.15` 一律改为从 policy 推导：
- 每步升档：`totalWithBuffer ≥ triggerTokens` → 压到 `targetTokens`
- 硬限：`totalWithBuffer ≥ hardLimitTokens` → 激进（keepRecent 收紧 / 强制）
- budget-check 各策略、retry、gate、UI 水位：同一 policy

### 4.3 触发语义（P0-2 修复：从"100% 才动手"改为"主动水位"）

**每步 `compactBeforeStep`**：
```
1. Layer 2（value 降级，恒跑，增量扫描）           ← 同步、无 LLM
2. 估算（增量 + 校准 buffer）
3. totalWithBuffer ≥ triggerTokens → 升档
     确定性摘要 → LLM 摘要(可选,见 4.5) → 截断，压到 targetTokens
4. totalWithBuffer ≥ hardLimitTokens → 激进降级
```
- **load-time**（`checkInitialBudget`）：同一 policy、同一标尺。消息/工具/窗口三者是否超标的判定全部从 policy 推导，不再各自乘比例。
- **UI 水位**：TRIGGER 标签从 policy 的 triggerTokens 换算，与真实动作一致。

### 4.4 L2 降级层（保留阶梯 + 增量化）

**保留（不动）**：value 阶梯（完整→可见截断→meta→台账移除）、key 永不驱逐、语义类工具截断不 meta、读循环 autoPin、引用感知延迟老化、跨消息 `messageBudget` 全局排序、storage 落盘 + 找回路径。

**TTL 老化惰性化**：`_compactedAt` 步数老化（>20 占位符 / >40 移除）目前每步对全量已压缩消息计算。改为**惰性**：仅在消息被扫描到（增量 delta）或累计步数到阈值时检查，避免每步全量遍历。

**增量扫描（compaction cursor）**——G4 的关键，见 §5.1。

### 4.5 L3 摘要记忆层（后台-only，不动）

保留：`applyCheckpointOnLoad`（[summary, …newer]）、`maybeCheckpointAfterRun`（水位/步数/压缩次数触发，从上次 anchor 增量摘要）、`selfHealOrphanedCheckpoint`、`compaction-view`（L3 后 O(1) 前缀复用，KV cache 友好）、provenance 段。

**坚持"摘要只在后台"**：每步同步 LLM 摘要路径永不恢复——濒死时刻输入可能本身就超限、摘要请求也会失败（2026-07-21 事故），且拖慢用户响应。缺口的补救是 checkpoint 触发条件（步数 >20 / 压缩 >3 / 水位 >50%）在运行结束后尽早落库，配合 view 复用让长运行不重算。

### 4.6 L4 失败层（reactive retry + 诊断）

保留：`isContextLengthError`、reactive retry（激进 Layer 2，messageBudget 收紧）。

补充（P2-2）：重试后仍超限，抛出**带估算分解的诊断错误**：
```
CONTEXT_BUDGET_EXCEEDED {
  modelName, contextLimit, triggerTokens, hardLimitTokens,
  messagesTokens, instructionsTokens, toolsTokens, outputReserve,
  totalTokens, totalWithBuffer, calibrationRatio
}
```
限制重试一次（现状已满足）。

### 4.7 L5 反馈层 + 遥测（不动）

保留：`ContextLedger`（pin 注册表、压缩台账、过度压缩检测 → autoPin、re-read 检测）、`compaction-telemetry`、`state-tracker`。`context_pin` 工具已存在，保留。
可选扩展（不做默认）：`compact_tool_result` 工具（Layer 1 模型主动释放）——V2 提议、低风险，放 roadmap。

### 4.8 配置面收敛

```ts
interface CompactionConfig {
  lifecycle: {
    keepRecentSteps: 3;          // 保留最近 N 个含工具结果的消息
    largeOutputThreshold: 8000;  // chars，单条输出超此即考虑降级
    compactableTools?: Set<string>; protectedTools?: Set<string>;
    messageBudget?: number;      // 跨消息输出总额预算（可选）
  };
  contextWindow: {
    targetPercent: 0.7;          // 压缩后目标水位（policy 消费）
    contextHintMessages: 3;
    incrementalSummary: true;
  };
  budget?: {                     // 可选 override，缺省从模型推导
    contextLimit?: number;
    outputReserve?: number;
  };
}
```
删掉 `triggerPercent` 在代码里的硬编码分支（UI 从 policy 读）。

---

## 5. 关键机制详述

### 5.1 每步增量扫描（compaction cursor）

**问题**：现 `manageToolOutputLifecycle` 每步对全量消息 map + 全局扫描。长对话 O(n) 且每次 `JSON.stringify` 所有未压缩输出。

**方案**：压缩决策是"确定性 + 全局信号（路径最新读 / pin / 引用）"的函数。除"路径最新读"外，旧消息的决策在内容不变时**不会变化**（DB 全量历史只增改不删，消息内容仅在压缩自身改写后变化，而改写后即被标记不再变）。因此：

```
interface CompactionCursor { evaluatedThrough: number }   // 已评估到第几条
perStep(messages):
  // 1) 只评估 delta 尾部
  delta = messages.slice(cursor.evaluatedThrough)
  patches = evaluateLadder(delta, globalState)   // 逐条跑价值阶梯
  // 2) 路径最新读更新：新读到 path P 时，若 P 此前有未压缩的"最新读"→ 降级它
  for path in collectPaths(delta):
    if prevLatestFull[path] && !isCompacted(prevLatestFull[path]):
      meta(prevLatestFull[path])                 // 用索引 O(1) 定位
    prevLatestFull[path] = 最新读
  // 3) 引用感知：仅检查新 assistant 文本引用的旧路径（O(新文本))
  advance(cursor)
```

- 全局信号用索引维护（`ContextLedger` 已近于此）：`path → lastReadIndex`、`pinnedPaths`、`path → readCount`。
- **正确性不变式**：决策仍是全局一致的——"路径最新读"由索引保证唯一，跨步读去重不依赖全量重扫。
- 配合消息级 token 缓存（4.1），每步不再重编码未变消息，总代价 O(delta)。

> **实施决定（2026-08-14）：本机制推迟。** 实测（vitest 微基准）：
> `manageToolOutputLifecycle` 在 961 条消息（全压缩稳态）下每步约 **4.3ms**，
> 线性增长 ~0.0045ms/条；视图提取与指纹化成本相当（各 ~1.6ms @961 条），
> 剩余为全局扫描。原因：
> 1. 完整 cursor 需重写读去重 / pin / TTL / 引用感知子系统——该子系统 7 月
>    出过两次生产事故（读循环 A5j5lHn、孤儿锚点），正确性高度依赖每步全局
>    重算，任何增量索引的漂移都可能静默复发。
> 2. 收益（每步省几毫秒）相对 LLM 延迟（秒级）可忽略；且 Layer 2 压缩本身
>    约束了未压缩消息数量，每步成本有上界。
> 3. 唯一的实质性收益点是 `findReferencedResults` 的 O(assistant×文本) 子串
>    扫描——可安全改为**单调增长的 referencedPaths 集合**（只增不删 → 只多
>    保护不欠保护），留作未来若 profile 显示需要时的低风险第一步。
> 若未来长会话 profile 显示每步 >20ms 或消息数持续 >5000，再按上文 cursor
> 方案实施，并配套不变式属性测试 + 定期全量对账保底。

### 5.2 内容敏感指纹缓存（4.1 详述）

消息级缓存 key 用"内容敏感指纹"：工具消息 = role + toolCallId 列表 + 各输出长度/首 64 字符；文本 = role + 长度 + 首尾 32 字符。压缩改写输出 → 指纹变 → miss 重算。**不能**复用 `compaction-view.fingerprintMessage`（它只对 toolCallId 集合敏感，压缩改写输出但 toolCallId 不变时指纹不变 → 误命中旧值）。

### 5.3 usage 真值校准闭环

```
prepareStep: base = estimateFullRequest(不含 buffer)
next usage: actualInputTokens = provider usage.inputTokens
sample = actualInputTokens / base
异常拒绝(<0.5 或 >3) → 忽略（估算基准与本次请求不对应）
EMA: ratio = clamp(α·sample + (1−α)·ratio),  α=0.3, clamp [0.85, 1.6]
tokenizerBuffer = baseTokens × (ratio − 1)
```
冷启动 ratio=1 → buffer=0，由 `deriveBudget` 的静态 encode-level buffer 兜底；首个真值样本接管后收敛。**这替代"拍脑袋 buffer"，把估算误差变成可自我修正的闭环。**

### 5.4 最小消息预算保护

`targetMessageTokens = max(MIN=2000, targetTokens − instructions − tools − outputReserve)`。小窗口（如 22.8k）且固定开销占比高时，原始计算可能得负数/0 → 把所有历史都摘要化 → 对话退化为"一串摘要"。加下限 + 告警（提示 contextLimit 相对开销过小）。

### 5.5 摘要时序（后台-only + view 复用）

- 后台：`maybeCheckpointAfterRun`（finalize 触发）——不阻塞用户。
- 前台：`applyEmergencyCompression` 里的 LLM 摘要档保留，但**只在 `triggerTokens` 且确定性摘要不足以压到 target 时**调用一次；不每步调。
- 复用：`compaction-view` 保证跨步骤前缀逐字节稳定（KV cache 命中），L3 摘要不重复。

---

## 6. 接线与迁移

现状接线已确认（§1.2）。迁移分四步，每步独立可灰度、可回退：

**Step 1 估算地基**（L0）
- 新增 `primitives/tokenizer/`，重写 `tokenizer.ts` 适配层，接入 `token-counter.ts`（图片计费 + 缓存 + compacted summary 计费）。
- 验证：对真实会话输出"估算 vs usage 真值"对比；多图/长文/未知模型误差在可接受区间。

**Step 2 统一 policy**（L1）
- 新增 `deriveBudget`；`budget-check` / `manageCompaction` / `retry` / `gate` / UI 全部从 policy 取数，删除魔法比例。
- 验证：grep 压缩模块无魔法压缩阈值；小窗口（22.8k）与大窗口（128k/1M）行为符合预期。

**Step 3 触发语义**（P0-2）
- 每步 `totalWithBuffer ≥ triggerTokens` 升档；`≥ hardLimitTokens` 激进；load-time 与 per-step 同标尺。
- 验证：总量 85% 时确实触发压缩（对比现在 100% 才触发）。

**Step 4 增量扫描**（G4）— **已推迟（2026-08-14）**，见 §5.1 实施决定。
- 实测每步成本已温和（961 条消息 ≈ 4.3ms，~0.0045ms/条），收益相对风险不划算。
- 未来触发条件：长会话 profile 显示每步 >20ms 或消息数持续 >5000。
- 低风险第一步（可先做）：`findReferencedResults` 改为单调 `referencedPaths` 集合。

**兼容**：`compactBeforeStep` / `checkInitialBudget` / `handleReactiveRetry` 对外签名不变；所有新增模块是内聚新增，先并行后替换。

---

## 7. 风险与缓解

| 风险 | 严重性 | 缓解 |
|------|--------|------|
| 校准冷启动 buffer=0，头几步偏险 | 中 | `deriveBudget` 按 encode-level 给静态 buffer 兜底；校准首个真值样本（通常第 1-2 步）接管 |
| ~~增量扫描正确性~~（已推迟） | — | 见 §5.1 实施决定：完整 cursor 未实施，现无此风险 |
| BPE 对高重复文本 O(n²) 病态 | 高 | 启发式预检（重复块检测）+ 长度上限（<1000 / >20k 走字符） |
| 图片计费保守值偏差 | 低 | 只求不低估；超估部分由校准 buffer 吸收 |
| LLM 摘要质量退化 | 低 | 保留质量验证 + 模板 fallback + provenance 段；摘要频率低（后台/trigger 级） |
| 触发提前导致过度压缩（体验变差） | 中 | targetPercent 可配；过度压缩检测 → autoPin 反馈闭环兜底 |
| 迁移回归（不变式被破坏） | 高 | 现有 scenario-invariants / guaranteed-compaction / db-replay 测试作为回归基线，每步全绿 |

---

## 8. 验证方案

**单元测试（新增/增强）**
- 估算：BPE 精确（GPT 家族）/ CJK / 未知模型字符回退 / 图片计费 / compacted summary 只计 summary / 消息缓存指纹 miss 语义。
- policy：`deriveBudget` 在 22.8k 小窗口、128k、1M 下的 trigger/hardLimit 边界；encode-level 对 buffer 的影响。
- 触发：总量（含 overhead）达 trigger 触发 vs messages-only 不触发；hardLimit 激进路径。
- ~~增量：长对话每步只扫 delta；跨步路径去重；TTL 惰性老化。~~（推迟，见 §5.1；若实施则补）
- 校准：EMA 收敛、异常样本拒绝、clamp、模型切换重置。
- 失败：reactive retry 诊断错误包含估算分解；重试只一次。

**场景测试（复用现有框架）**
- 22.8k 小窗口 + 大工具 schema（9.2k）——不因魔法阈值漏触发。
- 多图会话——不低估导致 L3 延迟。
- 1MB read-loop 产物——感知-行动环不破、读循环 pin。
- 长运行（>20 步）——checkpoint 后台落库、view 复用无重复摘要。

**回归基线**：`scenario-invariants` / `guaranteed-compaction` / `db-replay` / `checkpoint` / `compaction-view` 全绿；DB 全量历史永不被改写。

---

## 9. 完成标准

1. 单一 `BudgetPolicy` 贯穿 load / per-step / retry / gate / UI，grep 压缩模块无魔法压缩阈值。
2. 触发基于 `totalWithBuffer` vs `triggerTokens` / `hardLimitTokens`，不再依赖 100% 才升档。
3. 估算：多图/长文/未知模型不低估，且 usage 真值 EMA 校准闭环生效。
4. ~~每步代价 O(delta)~~（推迟，见 §5.1 实施决定；当前每步成本实测已温和且有上界）。
5. 三层（load / per-step / retry）行为一致、可观测（telemetry/ledger 完整）。
6. 四条不变式 + DB 全量真相在全部档位成立；回归测试全绿。

---

一句话总结：

```text
降级策略已经对了，重构做四件事——
换一把对的标尺（估算地基 + 校准）、
统一一本账（单一预算策略）、
把动手时机从 100% 提前到水位线（触发语义）、
让每步代价有界（增量扫描）。
```
