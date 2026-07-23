# 上下文压缩机制架构文档

> 最后更新：2026-07-23  
> 状态：已实施并稳定运行

## 概览

上下文压缩机制采用**四层保证 + 后台 Checkpoint**的架构，确保长对话场景下永不因上下文超限而失败。

## 核心原则

1. **确定性优先** - 不依赖模型主动调用，系统自动管理
2. **分层降级** - 从无损到有损，逐层保证
3. **异步摘要** - 摘要生成在后台进行，不阻塞用户交互
4. **数据可恢复** - 压缩的大输出落盘可找回

## 架构层次

### Layer 2: 工具输出生命周期管理（主力）

**触发时机**：每步 API 调用前同步执行  
**实现位置**：`packages/core/src/modules/compaction/lifecycle.ts`

**压缩规则**：
1. **步数老化**：保留最近 K 个 assistant step 的完整输出，更早的降级为元信息
2. **超大输出**：单条输出 >8KB，无视步数立即压缩
3. **跨消息预算**：所有工具输出总和超限，按大小排序持久化最大的

**元信息格式**（保留关键语义）：
```
Read packages/core/src/index.ts → 120 lines (30-150)
Bash 'npm test' → exit 0: All tests passed
Grep 'TODO' → 12 matches in 3 files
```

**数据落盘**：
- 压缩的大输出写入 `.claude/sessions/<sessionId>/tool-results/`
- 元信息中包含恢复路径：`[Full output saved to: <path>]`
- 模型可通过 `Read` 工具找回

**性能**：微秒级，不涉及 LLM 调用

---

### Layer 2.5: 确定性文本压缩

**触发条件**：Layer 2 后仍超限  
**实现位置**：`packages/core/src/modules/compaction/message-compressor.ts`

**压缩策略**：
- 保留首尾消息（用户目标 + 最新状态）
- 中间消息按固定比例抽取
- 不调用 LLM，纯算法处理

**适用场景**：极长对话（>100 轮）快速降级

---

### Layer 3: 紧急 LLM 摘要

**触发条件**：Layer 2.5 后仍超限  
**实现位置**：`packages/core/src/modules/compaction/emergency-summary.ts`

**摘要策略**：
- 调用 LLM 生成结构化任务摘要
- 带超时保护（防止摘要请求本身超时）
- 支持 fallback models

**摘要模板**（任务型 Agent 专用）：
```markdown
## 用户目标 / 验收标准
...

## 已完成步骤 & 关键结论
...

## 涉及的文件路径及改动
...

## 当前卡点 / 下一步计划
...

## 用户明确表达的约束与偏好
...
```

**质量验证**：
- 长度检查（20-6000 字符）
- 防复制检测（避免逐字复制原文）

---

### 降级兜底: 强制截断

**触发条件**：所有压缩策略失败  
**行为**：保留 15% 消息（首尾为主）

**保证**：永不返回 413，确保系统可用性

---

### 后台 Checkpoint（长期记忆）

**触发时机**：运行结束后，上下文占比 >50% 时  
**实现位置**：`packages/core/src/modules/compaction/checkpoint.ts`

**工作流程**：
1. 异步判定：活跃路径是否达到水位线
2. 增量摘要：基于上次 checkpoint 继续摘要（非全量重做）
3. 落库：摘要 + 锚点消息 ID 持久化到 DB
4. 加载优化：下次加载直接返回 `[摘要消息, ...锚点后的消息]`

**关键优势**：
- ✅ 不在濒死时刻调用 LLM（之前的致命问题）
- ✅ 增量摘要，不重复处理历史
- ✅ 改善 prompt cache 命中率（前缀稳定）
- ✅ 失败无害，不影响当前运行

**质量保证**：
- 带重试机制（2 次主模型 + fallback models）
- 摘要质量验证
- 失败回退到全量历史

---

## 数据流

```
用户消息 → Agent 运行 → 产生工具输出
                ↓
        compactBeforeStep (每步执行)
                ↓
        Layer 2: 生命周期管理
           - 步数老化
           - 超大输出压缩
           - 跨消息预算
                ↓
        [估算] 仍超限？
           No → 发送给模型
           Yes ↓
        Layer 2.5: 确定性压缩
                ↓
        [估算] 仍超限？
           No → 发送给模型
           Yes ↓
        Layer 3: 紧急 LLM 摘要
                ↓
        [估算] 仍超限？
           No → 发送给模型
           Yes ↓
        降级: 强制截断
                ↓
        保证不超限 → 发送给模型

        ──── 运行结束后 ────
                ↓
        后台任务: maybeCheckpointAfterRun
           - 水位检查 >50%
           - 增量摘要生成
           - 落库 (summary + anchorMessageId)
```

---

## 配置参数

**生命周期配置** (`DEFAULT_LIFECYCLE_CONFIG`):
```typescript
{
  keepRecentSteps: 3,              // 保留最近 3 个 step 完整输出
  largeOutputThreshold: 8000,      // >8KB 立即压缩
  compactableTools: null,          // null = 使用默认列表
  protectedTools: new Set(),       // 不压缩的工具
  messageBudget: 100_000,          // 跨消息总预算（字符数）
}
```

**上下文窗口配置** (`contextWindow`):
```typescript
{
  triggerPercent: 0.85,            // 85% 触发紧急压缩
  targetPercent: 0.7,              // 压缩到 70%
  contextHintMessages: 3,          // [已废弃]
  incrementalSummary: false,       // [已废弃]
}
```

**Checkpoint 配置**:
```typescript
{
  CHECKPOINT_TRIGGER_PERCENT: 0.5,  // 50% 触发后台 checkpoint
  CHECKPOINT_KEEP_PERCENT: 0.3,     // checkpoint 后保留 30% 完整消息
  MIN_KEEP_MESSAGES: 2,             // 至少保留 2 条消息
}
```

---

## 可压缩工具列表

**默认包含**（`DEFAULT_COMPACTABLE`）:
- `Read`, `read_file` - 文件读取
- `Bash`, `bash` - 命令执行
- `Grep`, `grep` - 内容搜索
- `Glob`, `glob` - 文件匹配
- `Edit`, `edit_file` - 文件编辑
- `Write`, `write_file` - 文件写入
- `WebSearch` - 网页搜索
- `WebFetch`, `web_fetch` - 网页抓取
- `Skill`, `skill` - 技能执行
- `ReadWikiPage`, `read_wiki_page` - Wiki 页面读取

**不可压缩**（保护工具输出）:
- 错误结果（`isError: true`）- 失败信息密度高且体积小
- 当前步骤的输出 - 正在使用中

---

## 元信息提取器（Extractors）

针对每个工具的专用提取器，从结果中提取关键语义：

```typescript
// Read 工具
'Read packages/core/src/index.ts → 120 lines (30-150)'

// Bash 工具  
'Bash \'npm test\' → exit 0: All tests passed'

// Grep 工具
'Grep \'TODO\' → 12 matches in 3 files'

// WebFetch 工具
'WebFetch https://example.com → 15000 chars (truncated from 50000)'
```

**提取顺序**：
1. result 回显字段（如 `result.path`, `result.command`）
2. camelCase args
3. snake_case args

**JSON 兼容**：自动识别并解析 JSON 字符串格式的结果（grep/glob/web_fetch）

---

## 监控与调试

**前端水位显示**：
```typescript
context.writer.write({
  type: 'custom',
  kind: 'data.budget',
  providerMetadata: {
    budget: {
      usagePercentage: 65.2,      // 当前利用率
      totalTokens: 83200,          // 总 token 数
      modelLimit: 128000,          // 模型上限
    }
  }
})
```

**日志关键点**：
- `[Compaction] Layer 2 后仍超限 (87.5%)，启动紧急压缩`
- `[Compaction] Layer 2.5 成功: 释放 25000 tokens，降至 68.3%`
- `[Checkpoint] Background checkpoint saved: anchor=msg_abc123, summarized 45 messages`

---

## 测试覆盖

**单元测试**：
- `lifecycle.test.ts` - 生命周期管理
- `message-compressor.test.ts` - 确定性压缩
- `emergency-summary.test.ts` - LLM 摘要
- `checkpoint.test.ts` - Checkpoint 机制

**集成测试**：
- `guaranteed-compaction.test.ts` - 保证永不 413
- 极端场景：200 轮对话 + 极小 contextLimit (2000 tokens)

---

## 历史演进

**2026-07-21 事故前**：
- 八层机制（Layer 1-3 + 多个预算检查）
- 濒死时刻同步调用 LLM 摘要（66s 失败）
- 双轨格式导致静默失效
- message-budget.ts 与 lifecycle.ts 功能重复

**2026-07-21 事故**：
- 525k tokens 泄漏
- `msg.parts is not iterable` 崩溃

**重构后（当前）**：
- 删除 Layer 1（compact_tool_result）
- 删除 message-budget.ts（并入 Layer 2）
- 删除同步 LLM 路径（改为后台 Checkpoint）
- 统一消息格式（message-view.ts）
- 四层保证 + 后台摘要

---

## 不变式（Invariants）

> **INV-1**: 发给模型的请求 ≤ 窗口上限  
> **INV-2**: 被压缩的工具输出可从磁盘找回  
> **INV-3**: 消息格式知识只在 message-view.ts，其他模块通过视图访问

---

## 相关文件

**核心模块**：
- `packages/core/src/modules/compaction/index.ts` - 入口
- `packages/core/src/modules/compaction/lifecycle.ts` - Layer 2
- `packages/core/src/modules/compaction/message-compressor.ts` - Layer 2.5
- `packages/core/src/modules/compaction/emergency-summary.ts` - Layer 3
- `packages/core/src/modules/compaction/checkpoint.ts` - 后台 Checkpoint
- `packages/core/src/modules/compaction/message-view.ts` - 消息格式统一
- `packages/core/src/modules/compaction/token-counter.ts` - Token 估算

**配置**：
- `packages/core/src/modules/compaction/types.ts` - 类型定义与配置

**预算管理**：
- `packages/core/src/modules/budget/tool-output-manager.ts` - 工具输出预处理
- `packages/core/src/modules/budget/tool-result-storage.ts` - 落盘存储

**测试**：
- `packages/core/src/modules/compaction/__tests__/` - 完整测试套件
