# 上下文压缩重构设计（V3）

> 日期：2026-08-15（文档合并重构，收敛为单一权威文档）
> 范围：`packages/core/src/modules/compaction/` 及其调用链（`composition/app/create.ts`、`modules/agent-control/pipeline.ts`、`modules/session/state.ts`、`composition/finalize.ts`）
> 状态：**设计稿 + 实施记录 + 历史档案**。输入侧（塞得进）为主体，输出侧（写不完）见 §10。
>
> **本文档是上下文压缩的唯一权威文档**，已并入并取代以下文档（均已删除）：
> - V1 架构（原 `docs/context-compaction-architecture.md`）→ §12.1 历史档案
> - 减负重构计划（原 `docs/compaction-refactoring-plan.md`）→ §12.2
> - 模型驱动压缩草案（原 `docs/model-driven-compaction-design.md`）→ §12.3
> - 输出侧问题记录（原 `docs/output-truncation-and-compaction.md`）→ §10
> - 历史/已回退：5月20号第一性原理设计、`COMPACTION_V2_DESIGN.md`、`compaction-bug-analysis.md`、token-estimation-v3 基座（精华已并入正文）
> - 外部对标来源见 §11.1（Anthropic context engineering / MemGPT / externalization）

> **实施状态（2026-08-15）**：
> - ✅ Step 1（L0 估算地基）、Step 2（L1 统一预算策略）、Step 3（触发语义主动水位）已实施。
> - ✅ §5.4 最小消息预算保护、§4.6 reactive retry 诊断错误、§4.8 UI 水位从 policy 读已实施（A 组补全）。
> - ⏸ Step 4（增量扫描）已推迟，见 §5.1 实施决定。
> - 📐 §10 输出侧预算模型（写不完）为**设计稿，未实施**；修复候选见 §10.7。

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

**P0-4 输出侧"写不完"（静默截断，详见 §10）**
- 应用**未给模型设 `max_tokens`** → 用 provider 默认输出上限；`capabilities.ts:100` 的 `outputReserve = min(defaultOutputTokens, 20000)` 是**静态预留**，不随上下文占用动态调整。
- 长任务多轮累积 + 续做时历史已占大量窗口，输出空间被挤压；模型生成中途耗尽输出预算 → **静默截断**。
- 循环层**无截断检测**：最后一步只有文本、无工具调用即视为完成（`ToolLoopAgent`）→ 半截结果被当最终答案，run 正常 `committed`、任务实际未完成。
- 真实复现：conversation_id=`sKYk66c0Q3N5rc4EL-WIc`（证据与诊断见 §10.1/§10.2）。

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
| G7 | 输出必可写完 | 每步显式预留输出预算；长输出不因预算耗尽被静默截断 |
| G8 | 截断可检测 | 任何截断均被识别（finishReason / 文本完整性），不误判完成 |
| G9 | 截断可恢复 | 检测到截断后自动压缩/续写，不丢失已产出内容 |

### 2.2 原则（不变式，贯穿所有档位）

1. **P1 单一预算对象**：所有路径（load / per-step / retry / checkpoint / gate / UI）读同一个 `BudgetPolicy`，禁止魔法阈值。
2. **P2 估算即真相**：触发/决策基于「完整请求估算 + 校准 buffer」，不基于累计 usage、不基于 messages-only。
3. **P3 只降级 value，永不驱逐 key**：工具调用输入（provenance）全程保留；输出走 完整→可见截断→meta→台账 阶梯。
4. **P4 感知-行动环不可断**：当前步结果永不 meta；语义类工具可见截断不 meta；读循环自动 pin。
5. **P5 先便宜后昂贵**：先同步无成本手段（value 降级/确定性），LLM 摘要只在后台非濒死时刻，强制截断是最后保底。
6. **P6 DB 永远是全量真相**：压缩只在内存对请求生效，绝不改写 DB 历史；加载/自愈一律以 DB 为准。
7. **P7 摘要只在后台**：不在每步同步调 LLM（濒死时刻是最差时机）；checkpoint + compaction view 保证前缀稳定。
8. **P8 可观测 + 自纠**：每个决策可追溯（telemetry/ledger），并有自我纠错机制（过度压缩检测 → autoPin）。
9. **P9 输出与输入共享同一预算对象**：`totalWithBuffer` 含输出预留；上下文占用大 → 输出预留紧 → 触发更早（§10.4.4）。压缩既管"塞得进"也管"写得完"。

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

> **输出侧（§10）**：以上分层管"输入塞得进"。输出侧"写得完"是另一条正交预算线——动态输出预留 + 截断检测 + 截断后续写，与输入侧共享同一个 `BudgetPolicy`（P9）。

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

> **实施修正（2026-08-14）**：校准**只在预算层聚合应用**，计数源头（`countTokensForModel` 及各 `countTokens*`）**保持 drift-agnostic**。原因：
> 1. 消息级缓存 key 不含 drift——源头乘校准后，drift 更新旧缓存永不刷新，源头校准基本失效；
> 2. 源头校准 + 聚合 tokenizerBuffer 会**双重放大**（char 路径实测 ×1.3 变 ×1.69）。
> 因此 `totalTokensWithBuffer` 是决策/闸门的唯一权威口径（含 `exceedsLimitWithBuffer` 硬不变量）。

**组装**（`request-budget.ts`）：
```
totalWithBuffer = messagesTokens + instructionsTokens + toolsTokens + outputReserve
                + tokenizerBuffer        // tokenizerBuffer = baseTokens × (driftRatio − 1),对全部模型统一
```

> `outputReserve` 目前是静态常量（`capabilities.ts:100`，`min(defaultOutputTokens, 20000)`）——这是输出侧"写不完"病灶的一部分，动态化设计见 §10.4.1。

### 4.2 L1 预算策略层（单一事实来源）

```ts
// prompt-budget-policy.ts —— 纯函数，无副作用
deriveBudget(contextLimit, outputReserve, modelName?) → BudgetPolicy {
  effectiveBudget = contextLimit − outputReserve
  bufferTokens = max(误差距离, 反应空间, EMERGENCY_BUFFER=3000)，受 MAX_BUFFER=50_000 封顶
    误差距离 = clamp(effectiveBudget × ratio[encodingLevel], min[level], 50_000)
    //   exact 4%·min2000 / approximate 8%·min3000 / char 15%·min5000
    反应空间 = min(effectiveBudget × 10%, 30_000)   // 触发→压缩执行间的增长，防 128k–256k 触发点过晚
  triggerTokens   = contextLimit − bufferTokens      // 达到 → 主动升档压缩
  hardLimitTokens = contextLimit − 3000              // 达到 → 强制降级
}
targetTokens(contextLimit, targetPercent)               // 压缩后目标（默认 0.6~0.7）
```

**坐标系说明**：`triggerTokens / hardLimitTokens` 是**窗口坐标系**（含 outputReserve），与 `totalWithBuffer`（= 纯输入 + outputReserve + 校准 buffer）同口径比较，避免 outputReserve 双计（从阈值扣除又加到比较量上）。触发时纯输入 = `contextLimit − buffer − outputReserve` = `effectiveBudget − buffer`，即输入触发线。`buffer` 下限 = `EMERGENCY_BUFFER`，保证 `trigger ≤ hard`（防小窗口红黄倒置）；`反应空间` 下限解决 exact 4% 误差 buffer 把触发点推到窗口 90%+、黄→红只剩 1.8k–5k tokens 的问题。

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
prepareStep: base = estimateFullRequest(不含 buffer)   // 计数源头 drift-agnostic
next usage: actualInputTokens = provider usage.inputTokens
sample = actualInputTokens / base
异常拒绝(<0.5 或 >3) → 忽略（估算基准与本次请求不对应）
EMA: ratio = clamp(α·sample + (1−α)·ratio),  α=0.3, clamp [0.85, 1.6]
tokenizerBuffer = max(0, baseTokens × (ratio − 1))    // 聚合层统一应用（见 §4.1 实施修正）
```
冷启动 ratio=1 → buffer=0，由 `deriveBudget` 的静态 encode-level buffer 兜底；首个真值样本接管后收敛。**这替代"拍脑袋 buffer"，把估算误差变成可自我修正的闭环。** 校准只作用于聚合 `totalWithBuffer`（触发/闸门口径），不污染逐条缓存。

**设计契约（非负 tokenizerBuffer）**：校准比率 <1（本地估算偏保守）时 `ratio − 1` 为负，数学上允许负 buffer（抵消高估），但 `ContextBudgetSnapshotSchema` 要求 `tokenizerBuffer ≥ 0`（`.nonnegative()`），因此 `request-budget` 对最终值做 `max(0, …)` 截断——宁保守不报错。冷启动默认值：`driftRatio = 1.0`、`tokenizerBuffer = 0`（`usage-calibrator` 的 `getDriftRatio`/`getTokenizerBufferRatio` 用 `?? 1` 兜底已保证）。

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

**Step 5 输出侧预算（§10）— 📐 设计稿，未实施**
- 动态 `outputReserve`（随窗口余量推导）+ 截断检测（finishReason/文本完整性）+ 截断后续写；与 §4.1/§4.3 统一到同一 `BudgetPolicy`。
- 验证：长任务多轮续做不再静默截断；构造截断能被检测且不 committed；截断后自动续写产出完整。

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
| 截断检测漏判（finishReason 不可靠） | 高 | 多信号融合：finishReason + 文本完整性启发式 + 预期长度比对（§10.4.2） |
| 续写引入重复/漂移 | 中 | 续写请求显式携带"已产出文本截至位置"，要求模型接续而非重写（§10.4.3） |
| 动态 outputReserve 挤压输入空间 | 中 | 与 §4.3 触发语义联动：预留变紧 → 更早压缩，由同一 policy 保证不自相矛盾 |

---

## 8. 验证方案

**单元测试（新增/增强）**
- 估算：BPE 精确（GPT 家族）/ CJK / 未知模型字符回退 / 图片计费 / compacted summary 只计 summary / 消息缓存指纹 miss 语义。
- policy：`deriveBudget` 在 22.8k 小窗口、128k、1M 下的 trigger/hardLimit 边界；encode-level 对 buffer 的影响。
- 触发：总量（含 overhead）达 trigger 触发 vs messages-only 不触发；hardLimit 激进路径。
- ~~增量：长对话每步只扫 delta；跨步路径去重；TTL 惰性老化。~~（推迟，见 §5.1；若实施则补）
- 校准：EMA 收敛、异常样本拒绝、clamp、模型切换重置。
- 失败：reactive retry 诊断错误包含估算分解；重试只一次。
- 输出侧（§10）：模型调用显式设 `maxOutputTokens`；构造 `finishReason='length'` 的截断响应能被检测且 run 不 committed；截断后自动续写产出完整；动态 outputReserve 随上下文占用收紧。

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
7. 输出侧（§10）：每步显式预留输出预算（动态 `outputReserve`）；任何截断被检测且不误判完成；截断后可自动续写。

---

## 10. 输出侧预算模型（写不完）——设计稿

> 本节为**输出侧**设计稿（📐 未实施）。来源：`output-truncation-and-compaction.md`（已并入本节省略原文）+ 2026-08-15 业界对标（§11）。
> 与 §3-§9 的关系：§3-§9 管**输入侧"塞不进"**，本节管**输出侧"写不完"**，两者统一到同一预算模型（P9）。
> **实施计划（P0-P3：输出侧落地 / 外部化读回 / 模型主动 / 精益化）见 `docs/context-usage-redesign.md` §14**。

### 10.1 问题定义

压缩系统目前的全部注意力在**输入侧**："这一次请求能不能塞进窗口"（`request-budget.ts`、`capabilities.ts` 的 `outputReserve`）。它防的是**"塞不进"**。但长任务真正的瓶颈往往是**输出侧**：**"写不完"**。截断是"写不完"的极端形态，而它发生在**多轮累积 + 续做**场景下，正是压缩系统最该介入却没介入的地方。

**真实复现（有数据）**：本地 Web 跑 2000 字深度长文任务（六步：大纲→三部分→润色→总览），中途停止再发"继续"续做：
1. 续做正确续完第二部分（`todo_write` 置 completed）✓
2. 写第三部分时，输出从"在个人效"处被**硬截断**（断在词中间，明显非正常收尾）
3. **`ToolLoopAgent` 把不完整文字当成"最终答案"，run 正常 `committed`、无任何 error**
4. 结果：第三部分 `in_progress` 卡住、润色/总览未做——**任务静默地没完成**

**关键证据**：`conversation_runs` 两次 run 均 `status='committed'`、`error=None`；续跑 assistant 消息最后一个 text part 以"在个人效"结尾（词被切断）；全链路 grep 不到 `maxTokens`/`max_tokens`（`models.json` 里模型条目只有 `{id}`）。

### 10.2 现状盘点

| 病灶 | 位置 | 后果 |
|---|---|---|
| 未设 `max_tokens` | 模型创建/调用层（`createLanguageModel` 等） | 用 provider 默认输出上限 |
| thinking 占输出预算 | deepseek-v4-pro 开 thinking | 推理 token 大量占输出，正文剩余不足 → 截断 |
| `outputReserve` 静态 | `capabilities.ts:100` = `min(defaultOutputTokens, 20000)` | 不随上下文占用动态调整；上下文越大输出空间越紧 |
| 无截断检测 | `ToolLoopAgent`（node_modules/ai） | 最后一步纯文本即视为完成；半截结果进库 |

### 10.3 设计目标

| 编号 | 目标 | 可验证标准 |
|------|------|-----------|
| G7 | 输出必可写完 | 每步显式预留输出预算；长输出不因预算耗尽被静默截断 |
| G8 | 截断可检测 | 任何截断均被识别（finishReason / 文本完整性），不误判完成 |
| G9 | 截断可恢复 | 检测到截断后自动压缩/续写，不丢失已产出内容 |

### 10.4 机制设计

**10.4.1 动态输出预留（outputReserve）**

现状：`outputReserve = min(defaultOutputTokens, 20000)` 静态，不随上下文变化。

```
reserve = clamp(目标输出预算,
                minReserve,               // 下限：保证"写完"的最小空间（对齐 §5.4 最小预算保护）
                availableWindow)          // 上限：窗口余量 = contextLimit − 当前输入占用
```

- 输入占用 = messages + instructions + tools（含校准 buffer）。
- 上下文占用越大 → 可用窗口越小 → 输出预留越紧 → **联动 §4.3 触发语义更早压缩**（压缩释放输入空间 → 输出预留恢复）。
- 与 §4.1 的关系：`totalWithBuffer` 本就含 `outputReserve`，本设计把它的取值从"静态常量"改为"随窗口余量推导"，并让 §4.2 `deriveBudget` 在推导 trigger/hardLimit 时纳入动态预留。

**10.4.2 截断检测**

多信号融合，任一命中即判截断：
1. **provider/模型层**：`finishReason === 'length'`（AI SDK 暴露的 stop reason）；模型调用需显式设 `maxTokens`，截断才有信号可依。
2. **文本完整性启发式**：末尾是否断在词中间、是否有未闭合结构（markdown 代码块/列表）、是否以预期收尾终止。
3. **预期长度比对**：输出显著短于该步任务预期时标记可疑（待 §10.6 调查确认信号可用性）。

检测到截断 → 该步**不 committed**，进入 10.4.3。

**10.4.3 截断后行为（自动续写）**

1. 把已产出文本（截至截断点）作为上下文追加，显式要求模型"从该处继续，不要重写"。
2. 若上下文已满（续写请求塞不进）→ **先压缩（§4）再续写**。
3. **分片输出（对齐 externalization，§11.2）**：长任务拆成多段输出，模型分段生成、已产出落盘/追加，下一段续写——从源头避免单次输出耗尽预算。与"超大工具输出落盘 + 分片读"是同一机制的两面：输出侧分片写、输入侧分片读。

**10.4.4 与输入侧的统一预算模型**

请求预算 = 输入预算 + 输出预留。输出侧不再是"别的东西"，而是 `BudgetPolicy` 的组成部分：
- `outputReserve` 成为 policy 字段，参与 §4.2 `deriveBudget` 的 trigger/hardLimit 推导。
- §4.3 触发语义补一条：上下文占用大 → 输出预留紧张 → 触发更早（输出侧与输入侧共享同一水位线）。

### 10.5 输入侧 vs 输出侧对照

| | 输入侧（塞得进，§3-§9） | 输出侧（写得完，本节） |
|---|---|---|
| 核心机制 | 估算 / 触发 / 降级 / 摘要 | 预留 / 检测 / 续写 |
| 关键动作 | value 阶梯 + compaction | 动态 outputReserve + 截断检测 + 自动续写 |
| 共用 | BudgetPolicy、triggerTokens、checkpoint 落库 | 同左 |

### 10.6 待调查问题（作业清单）

1. **截断检测**：如何可靠判断"响应被 provider 截断"？（`finishReason` 是否含 `length`/`max_tokens`？AI SDK 是否暴露截断信号？文本是否完整收尾？）
2. **截断后行为**：检测到截断后应该怎样——自动续写？先压缩上下文再续？还是应预先把 `max_tokens` 设够？
3. **输出预算自适应**：`outputReserve` 是否应随上下文占用动态调整（上下文越大，输出预留越紧张）？
4. **续做/多轮累积下的压缩触发**：长任务多轮后，压缩是否该更早介入，给输出留空间？
5. **与输入侧的统一**：输入侧（估算/时机/代价）与输出侧（写不完）如何统一到同一个预算模型？

### 10.7 修复候选

- **治标（已可做）**：模型调用显式设 `maxOutputTokens`（如 8192+），长输出不再静默截断。
- **治本（属压缩域，待做）**：截断检测 + 自动压缩后续写；输出预算随上下文自适应。
- 方向应作为压缩系统的"输出侧"一等公民并入，而非补丁。

---

## 11. 外部参考与业界对标

### 11.1 来源（2026-08-15 联网检索）

- Anthropic 官方《Effective context engineering for AI agents》— https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- MemGPT《Towards LLMs as Operating Systems》— https://arxiv.org/abs/2310.08560
- 《Let Me Take This Outside：On the Importance of Externalization for Computation Offloading in LLM-Based Agents》— https://www.semanticscholar.org/search?q=%22Let%20Me%20Take%20This%20Outside%22%20externalization&sort=relevance

### 11.2 学到的心智模型

1. **上下文是有限资源 + context rot**：不只"塞不下"——上下文越长，模型召回精度越低（context rot）。目标是"最小高信号 token 集"，而非"塞进去就行"。→ 压缩动机 = 防溢出 + 保质量，故水位未满时就应主动介入（对应 §4.3 主动水位）。
2. **compaction 与 tool result clearing 是两种机制**：
   - compaction = 有损摘要（调 LLM，贵）；
   - tool result clearing / context editing = 手术式定点删除旧工具输出（零成本）。
   - 后者是最轻量优先手段（Anthropic 称 tool result clearing 为"最安全最轻量的压缩"）。对应我们的 value 阶梯（完整→截断→meta→evict）。
3. **externalization / just-in-time retrieval**：上下文只留轻量指针（文件路径/查询/URL），运行时按需加载（`head`/`tail`/`grep` 渐进披露）。超大内容落盘 + 分片读，避免一次性加载撑爆窗口（→ 对应 §10.4.3 分片写）。
4. **记忆分层（MemGPT）**：工作记忆（窗口）vs 长期记忆（外存/持久化笔记）。对应我们的 checkpoint + provenance 段（机器生成的行动日志，不靠 LLM 听话）。
5. **sub-agent 架构**：每个子代理干净窗口，探索用几万 token 只回传 1-2k 浓缩摘要。与压缩正交的杠杆——压缩在同一窗口省，子代理给每个任务独立窗口（独立方向，非本文档范围）。

### 11.3 对标表（业界概念 → TheThing 实现 → 差距）

| 业界概念 | TheThing 实现 | 差距 |
|---|---|---|
| tool result clearing | value 阶梯（完整→截断→meta→evict）+ 跨消息预算 ✓ | — |
| compaction | L1-L3 阶梯 + checkpoint + compaction view ✓ | — |
| context rot / 主动水位 | §4.3 触发语义提前到水位线 ✓ | 输出侧质量监控缺失（§10 待做） |
| externalization | outputs/ 移出 git（2026-08-15）；超大工具输出落盘已有雏形 | 超限自动落盘 + 分片读 未做 → §10.4.3 |
| memory tiers | checkpoint + provenance 段 ✓ | — |
| sub-agent | 独立方向 | 与压缩正交，另行评估 |

---

## 12. 历史档案（附录）

> 本节为被合并/删除文档的归档。正文（§1-§11）是现行权威设计；本节保留历史与未实施草案，供追溯与未来评估。V1 的"四条不变式"现已是 §2.2 的现行原则，此处保留历史出处与事故由来。

### 12.1 V1 架构（2026-07 已实施，原 context-compaction-architecture.md）

压缩系统从"agent 的行动记忆"视角设计，而非"待压缩的 token 预算"。核心是**四条不变式**贯穿所有压缩路径（lifecycle / 确定性压缩 / 紧急 LLM 摘要 / checkpoint），保证压缩不破坏 agent 继续任务的能力。

**历史教训**：2026-07-25 对话 A5j5lHn 暴露四个 bug（读循环、孤儿锚点、guard 误触发、摘要丢 provenance），都是"删了该删的 key"的变体。根因是 `extractMessageText` 把工具调用输入（key=provenance）和工具结果输出（value=内容）当同类 content 处理。修复：立 key/value 分离不变式。

**四条不变式**（现行原则见 §2.2）：
1. **感知-行动环不可断**：当前步（最近一次工具结果）永不 meta 化，超大改可见截断（保留头尾+省略标记+找回提示）。
2. **key 永不被驱逐**：工具调用输入（toolName + input args）在所有压缩路径保留全文。只有工具结果输出（value）走降级阶梯。
3. **语义类工具超大截断不 meta**：read_file / read_wiki_page 等模型主动要看的内容，超大时可见截断而非 meta 化。
4. **读循环熔断**：同文件被读 ≥3 次 → 自动 pin，最新读取豁免压缩 + 遥测上报。

**Layer 2: 工具输出生命周期管理（主力）**（`lifecycle.ts`，每步 API 调用前同步执行）。唯一预算分配器，按优先级花 token 预算，降级阶梯**只作用于 value**：
```
完整 value -> 可见截断(_truncated,头尾+省略标记) -> meta(_compacted,元信息+落盘) -> evict(台账记录)
```
决策优先级（高到低）：错误结果/小输出/pin 的最新读取 → 保留完整；当前步结果 → 永不 meta；同文件重复读的更早副本 → meta（去重）；超出最近 K step 且未被引用 → meta；边界内超大：语义类截断（不变式 3），瞬态类（bash/grep/web）meta + 落盘。

**Layer 2.5: 确定性文本压缩**（`message-compressor.ts`）：`extractKeyInformation` 用 `extractActionLog`（非丢 key 的 `extractMessageText`）抽取文件路径/URL/命令，生成结构化摘要。保留首尾消息。

**Layer 3: 紧急 LLM 摘要**（`emergency-summary.ts`）：摘要器输入用 `renderActionLog(extractActionLog(...))`——LLM 能看到 `web_fetch(url=...)`、`read_file(filePath=...)`，保得了 provenance。带重试 + fallback models。

**降级兜底: 强制截断**：所有压缩失败时保留 15% 消息（首尾为主）。保证永不 413。

**后台 Checkpoint（长期记忆）**（`checkpoint.ts` + `context-window.ts`）：运行结束后 `finalizeAgentRun` 异步触发，水位 >50% 生成摘要落库。摘要携带机器生成的 provenance 段（`renderKeysOnlyActionLog`），列清所有曾执行的工具调用。加载自愈 `selfHealOrphanedCheckpoint` 检测两种"无效 checkpoint"并强制重建（孤儿 anchor / 缺 provenance 段的旧格式）。超大消息 split 修复：单条 `msgTokens >= keepBudget` 时 `splitIndex = i+1`（该消息进 olderMessages 用摘要替换）。

**数据流**：
```
用户消息 -> route.ts: applyCheckpointOnLoad(全量 activeMessages)
Agent 运行 -> prepareStep -> sessionState.compact -> compactBeforeStep
  [1] selfHealOrphanedCheckpoint -> [2] applyCompactionView
  [3] manageToolOutputLifecycle -> [4] 预算检查 + applyEmergencyCompression
  -> 发给模型
运行结束 finalize: maybeCheckpointAfterRun -> generateAndPersistCheckpointSummary
```

**配置参数（V1，部分已被 §4.8 收敛）**：
```typescript
Lifecycle: { keepRecentSteps: 3, largeOutputThreshold: 8000,
             compactableTools: null, protectedTools: new Set(), messageBudget: 100_000 }
Checkpoint: { CHECKPOINT_TRIGGER_PERCENT: 0.5, CHECKPOINT_KEEP_PERCENT: 0.3,
              MIN_KEEP_MESSAGES: 2, READ_LOOP_THRESHOLD: 3 }
```

**模型参与（闭环反馈）**：`context_pin` 工具（豁免压缩 / 释放 / 查询台账）；ContextLedger 台账不注入消息流（保 prompt cache）；遥测 `read_loop_detected` 等事件。

**测试覆盖（沿用）**：`lifecycle.test.ts` / `compaction.test.ts` / `compaction-config-driven.test.ts`（Layer 2 + 不变式）、`value-aware.test.ts`（错误保护/去重/引用感知）、`read-loop-regression.test.ts`（事故复现）、`action-log.test.ts`（key/value 分离）、`checkpoint.test.ts`（自愈 + 超大消息 split）、`lifecycle-storage.test.ts`（落盘可找回）、`guaranteed-compaction.test.ts`（永不 413）。

**历史演进**：
- **2026-07-21 事故**：525k tokens 泄漏 + `msg.parts is not iterable` 崩溃。八层机制 + 濒死同步 LLM 摘要（66s 失败）。
- **2026-07-23 重构**：删 Layer 1 / message-budget.ts / 同步 LLM 路径。统一消息格式（message-view.ts）。
- **2026-07-25 读循环事故**（A5j5lHn）：SKILL.md(489行) 被 read_file 读取后 largeOutputThreshold 触发 tooLarge 把输出 meta 化，read_file 不落盘无法找回 → 模型连读 7 次（另一轮 31 次）→ 目标漂移、幻觉用户指令、谎报完成。根因：压缩切断感知-行动环 + key/value 不分。
- **2026-07-25~26 根治（8 commits）**：感知-行动环保护 + 读循环熔断（`c42f48d`）；pre-existing 测试/tsc 修复（`a44bbcd`/`ecd6dca`）；孤儿锚点自愈（`1d0f6c6`）；route.ts 传全量修复 guard 误触发（`7b7ffad`）；key/value 不变式 + action-log 端到端（`4d461c0`）；旧格式摘要自愈（`582a050`）；超大消息 split 修复（`7056103`）。

### 12.2 减负重构精华（原 compaction-refactoring-plan.md）

大部分已并入正文（TTL 惰性化→§4.4；checkpoint 步数触发→§4.5；UI 水位→§4.8）。未吸收/已实施记录的要点：

- **CompactionMeta**：`_compactedAt` 步数标记（`compactedAtCounter`）→ TTL 三级老化：age>20 替换为占位符 stub、>40 移除并 `ContextLedger.recordEviction`（供 `context_pin` 找回）。
- **checkpoint 步数触发**：`CHECKPOINT_STEP_THRESHOLD=20`、`CHECKPOINT_COMPACTION_THRESHOLD=3`，水位判断改 OR（已并入 §4.5）。
- **压缩可见性**：`CompactionUINotification` 事件（layer/messagesAffected/tokensSaved/strategy），UI 系统消息展示（已并入 §4.8 UI 水位）。
- **成功度量**：核心文件 18→15；长对话 meta 碎片 O(n)~4000 → O(1)~500 tokens；checkpoint 触发率 <5%→100%（>20 步任务）。

### 12.3 模型驱动压缩草案精华（原 model-driven-compaction-design.md，未实施）

- **思路**：模型主动压缩（60-80% 水位）为 Layer 0，系统自动压缩（85%）兜底——混合模式。
- **CompactContext 工具**：`strategy: compress_old_outputs | summarize_conversation | archive_files`；`target`（toolNames / filePatterns / messageRange）+ `reason`（审计）。输出含 `tokensFreed`、`newUsagePercent`。
- **验证 5 规则（`validateCompactionRequest`）**：低水位（<50%）拒绝；不压缩最近 2 步（安全边界）；1 分钟内 ≤1 次压缩（防循环）；`summarize_conversation` 需 messageRange 且 ≥5 条消息；`archive_files` 禁核心源码（`src/**`、`*.ts` 等）。
- **与 §4.7 的关系**：§4.7 已把 `compact_tool_result`（模型主动释放，V2 提议）列为 roadmap；本节 CompactContext 即该方向的设计细化。实施时以 §10/§4.7 的预算模型为准，勿叠加新机制。

---

一句话总结：

```text
输入侧：降级策略已经对了，重构做四件事——
换一把对的标尺（估算地基 + 校准）、
统一一本账（单一预算策略）、
把动手时机从 100% 提前到水位线（触发语义）、
让每步代价有界（增量扫描）。
输出侧（§10）：把"写不完"并进同一预算模型——
动态输出预留 + 截断检测 + 截断后续写。
```
