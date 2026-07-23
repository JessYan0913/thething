# Budget Check Fix Validation

## 问题

在长对话中继续对话时抛出错误：
```
上下文超限(419692 tokens > 128000 窗口上限)
已尝试 Layer 2: freed 396712 tokens; Emergency compression applied (Layer 2.5→3→truncation)
```

## 根本原因

1. **缺失 Layer 1**：历史上 Layer 1 (compact_tool_result) 被删除了
2. **`forceTruncateMessages` 不是 token-aware**：只按消息数量的 15% 截断，不考虑实际 token 数
3. **Emergency compression 应用后仍可能失败**：如果最后 15% 的消息包含大量工具输出
4. **工具列表占用大量 tokens**：即使消息很少，工具定义本身也可能占用大量预算

## 修复方案

### 1. 使 `forceTruncateMessages` token-aware

**文件**：`message-compressor.ts:252-304`

**改动**：
- 添加 `modelName` 和 `maxTokens` 参数
- 如果提供 `maxTokens`，迭代减少消息直到满足预算
- 从 keepRatio 开始，每次减少 30%，直到满足限制
- 最差情况只保留 warning + 最后一条消息

**验证**：
```typescript
// Before: 只按数量截断
export function forceTruncateMessages(messages, keepRatio = 0.15)

// After: 基于 token 预算
export async function forceTruncateMessages(
  messages,
  keepRatio = 0.15,
  modelName?,
  maxTokens?
)
```

### 2. 更新 `applyEmergencyCompression` 调用

**文件**：`index.ts:194-200`

**改动**：传入 `modelName` 和 `targetTokens` 到 `forceTruncateMessages`

### 3. 添加 Strategy 3: Extreme Mode

**文件**：`budget-check.ts:113-144`

**新增策略**：
1. 只保留 3 个核心工具：read_file, write_file, bash
2. 强制截断消息到 5%
3. 确保 messages 不超过 30% 的 token 预算
4. 给 instructions + tools 留 70% 空间

**完整防御链**：
```
Initial check (exceeds)
  ↓
Strategy 1: Layer 2 aggressive (tool output compression)
  ↓ (still exceeds)
Strategy 1.5: Emergency compression
  ├─ Layer 2.5: Deterministic compression
  ├─ Layer 3: LLM summary
  └─ Truncation: Token-aware forced truncation
  ↓ (still exceeds)
Strategy 2: Tool filtering (remove optional tools)
  ↓ (still exceeds)
Strategy 3: Extreme mode
  ├─ Only 3 core tools
  ├─ 5% messages with 30% token budget
  └─ Guaranteed to work unless instructions > 70%
```

## 预期效果

### Before
- Emergency compression 应用但仍失败
- 抛出 CONTEXT_BUDGET_EXCEEDED 错误
- 用户无法继续对话

### After
- Strategy 3 确保几乎一定成功
- 只有在 instructions 本身超过 70% 窗口时才会失败（极端罕见）
- 用户可以继续对话，虽然上下文被严重截断

## 潜在问题

### 1. 上下文丢失过多
**问题**：Extreme mode 只保留 5% 消息 + 3 个工具
**缓解**：
- 这是最后手段，只在常规策略都失败时启用
- 保留第一条 user 消息（任务目标）+ 最后几条（当前状态）
- 显示警告消息提示用户开始新会话

### 2. 工具能力受限
**问题**：只保留 read_file, write_file, bash
**缓解**：
- 这 3 个工具覆盖了最基本的文件操作
- Agent 仍可完成基本任务
- 用户可以开始新会话恢复全部工具

### 3. Instructions 本身过大
**问题**：如果 system prompt > 70% 的窗口
**状态**：仍会失败
**建议**：需要添加 instructions 压缩机制（未在本次修复中实现）

## 测试场景

### Scenario 1: 长对话 + 大量工具输出
- **Input**: 200 条消息，每条包含大量工具输出
- **Expected**: Strategy 1.5 (Emergency compression) 成功
- **Token-aware truncation** 将消息压缩到满足预算

### Scenario 2: 长对话 + 大量工具
- **Input**: 100 条消息 + 50 个 MCP 工具
- **Expected**: Strategy 2 (Tool filtering) 成功
- 移除可选工具，保留核心工具

### Scenario 3: 极端长对话 + 大量工具
- **Input**: 500 条消息 + 100 个工具
- **Expected**: Strategy 3 (Extreme mode) 成功
- 只保留 3 个核心工具 + 5% 消息（~25 条）

### Scenario 4: Instructions 过大（edge case）
- **Input**: System prompt 占 100k tokens
- **Expected**: 仍会失败
- **建议**: 需要 instructions 压缩机制

## 相关文件

- `packages/core/src/modules/compaction/message-compressor.ts` - Token-aware truncation
- `packages/core/src/modules/compaction/index.ts` - applyEmergencyCompression
- `packages/core/src/modules/compaction/budget-check.ts` - Multi-layer defense
- `docs/context-compaction-architecture.md` - Architecture doc

## Next Steps

1. ✅ 实现 token-aware truncation
2. ✅ 添加 Extreme mode
3. ⏳ 更新测试（需要将 forceTruncateMessages 调用改为 await）
4. ⏳ 验证在真实长对话中的效果
5. 🔮 考虑添加 instructions 压缩机制（如果 70% 阈值不够）
