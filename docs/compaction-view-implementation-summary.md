# CompactionView 实施总结

> 实施时间：2026-07-23
> 状态：Phase 1 核心架构已完成 60%，剩余 40% 需要手动应用补丁

## 📊 当前状态

### ✅ 已完成（自动）

1. **核心模块创建** ✅
   - `packages/core/src/modules/compaction/compaction-view.ts`
   - 实现了 `fingerprintMessage`、`applyCompactionView`、`updateViewAfterL3`
   - 已适配 AI SDK v7

2. **类型系统集成** ✅
   - `packages/core/src/modules/session/types.ts` - 添加 `CompactionView` 类型
   - `SessionState` 接口添加 `compactionView: CompactionView` 字段

3. **视图初始化** ✅
   - `packages/core/src/modules/session/state.ts` - `createSessionState` 中初始化 `compactionView`

### 🔄 待完成（手动应用补丁）

由于文件系统同步问题，以下改动需要手动应用。详细补丁见：
- [compaction-view-manual-patches.md](./compaction-view-manual-patches.md)
- [compaction-view-todo.md](./compaction-view-todo.md)

4. **Emergency Summary 返回类型** ⏳
   - 文件：`emergency-summary.ts`
   - 添加 `summaryMessage`、`anchorIndex`、`summaryText` 字段
   - 函数返回时填充这些字段

5. **Compaction 主流程集成** ⏳
   - 文件：`index.ts`
   - 添加 Layer 0（视图应用）
   - 修改参数接受 `compactionView`
   - Layer 3 后更新视图

6. **Checkpoint 加载** ⏳
   - 文件：`checkpoint.ts`
   - 返回类型添加视图初始化信息
   - 返回值填充这些信息

7. **Composition 层传递** ⏳
   - 文件：`composition/compaction.ts`
   - `compactBeforeStep` 调用时传递 `sessionState.compactionView`

8. **App Create 初始化** ⏳
   - 文件：`composition/app/create.ts`
   - Checkpoint 加载后初始化 `sessionState.compactionView.summary`

---

## 🎯 核心价值

### 问题
AI SDK v7 的 `prepareStep` 每步收到完整历史，导致：
- **重复压缩**：Layer 2/3 每步都重新执行
- **重复 LLM 调用**：Layer 3 每步生成新摘要
- **高成本**：每次 Layer 3 调用消耗 tokens 和时间
- **Cache Miss**：动态摘要 ID 导致 KV cache 失效

### 解决方案
**CompactionView 视图状态机**：
- 记录"已被 L3 摘要覆盖的前缀"
- 下一步 O(1) 指纹验证 → 直接替换前缀
- 零 LLM 调用，前缀逐字节稳定（KV cache 友好）

### 预期收益
- ✅ **性能提升 2-5x**（取决于对话长度）
- ✅ **Layer 3 成本降低 80%+**
- ✅ **KV Cache 命中率提升**（前缀稳定）

---

## 📋 手动应用补丁步骤

### 选项 A：逐个文件应用（推荐）

按以下顺序手动编辑文件（参考 [compaction-view-manual-patches.md](./compaction-view-manual-patches.md)）：

1. `emergency-summary.ts` - 修改返回类型
2. `checkpoint.ts` - 修改返回类型
3. `index.ts` - 添加 Layer 0 和视图更新
4. `composition/compaction.ts` - 传递视图
5. `composition/app/create.ts` - 初始化视图

### 选项 B：使用 Git Patch（如果文件稳定后）

```bash
# 创建补丁
git diff > compaction-view.patch

# 应用补丁
git apply compaction-view.patch
```

---

## 🧪 测试验证

### 测试 1：基础功能
```bash
cd packages/core
pnpm test compaction-view
```

### 测试 2：端到端集成
1. 启动长对话（超过 trigger threshold）
2. 观察日志：
   ```
   [Compaction] Layer 3: LLM summary generated
   [CompactionView] Updated view: anchorIndex=50
   ```
3. 下一步应该看到：
   ```
   [CompactionView] Applied view: 51 → 1 messages
   ```
4. **关键验证**：第二步不应该有 "Layer 3: LLM summary" 日志

### 测试 3：Checkpoint 跨轮复用
1. 触发 Layer 3（会话结束时 checkpoint）
2. 重新加载会话
3. 应该看到：
   ```
   [Checkpoint] Loaded summary for 50 messages
   [CompactionView] Updated view: anchorIndex=50
   ```
4. 第一步就应该看到：
   ```
   [CompactionView] Applied view: 51 → 1 messages
   ```

---

## 📖 相关文档

### 设计与分析
- [compaction-learnings-from-某项目.md](./compaction-learnings-from-某项目.md)
  - 从 某项目 借鉴的关键设计
  - 四个 Phase 的详细分析

- [compaction-comparison-with-某项目.md](./compaction-comparison-with-某项目.md)
  - 完整对比分析（569 行）
  - 架构差异和优化方向

### 实施指南
- [compaction-view-implementation-plan.md](./compaction-view-implementation-plan.md)
  - 详细的实施计划（包含所有 Phase）
  - 代码示例和具体位置

- [compaction-view-manual-patches.md](./compaction-view-manual-patches.md) ⭐
  - **手动应用补丁的详细步骤**
  - 每个改动的具体位置和代码

- [compaction-view-todo.md](./compaction-view-todo.md)
  - 待办清单
  - 测试计划

### 架构文档
- [context-compaction-architecture.md](./context-compaction-architecture.md)
  - 原有架构文档
  - Layer 2/2.5/3 设计

---

## ⚠️ 注意事项

### 1. 稳定 ID 要求
摘要消息必须使用稳定 ID，确保跨步骤引用同一对象：
```typescript
// ❌ 错误：每次生成新 ID
const id = `summary-${Date.now()}`;

// ✅ 正确：基于 conversationId 和锚点的稳定 ID
const id = `summary-${conversationId}-${anchorIndex}`;
```

### 2. 指纹稳定性
`fingerprintMessage` 必须对 Layer 2 工具输出压缩保持稳定：
- ✅ 使用 `toolCallId`（压缩不改变）
- ❌ 不用 `output` 内容（压缩会改变）

### 3. 早期返回
Layer 0 视图生效时，**必须立即返回**，不执行后续 Layer：
```typescript
if (viewResult.applied) {
  return current;  // 🔑 关键：早期返回
}
```

### 4. 视图失效处理
指纹不匹配时，`applyCompactionView` 会自动清空视图：
```typescript
if (currentFingerprint !== entry.anchorFingerprint) {
  view.summary = null;  // 自动失效
  return { messages, applied: false };
}
```

---

## 🚀 下一步

### Phase 1 完成后
1. ✅ 运行测试验证功能
2. ✅ 观察日志确认视图生效
3. ✅ 测量性能提升和成本降低

### Phase 2：增量 Token 估算
- 创建 `reestimatePartial` 函数
- 修改 `budget-check.ts` 使用增量估算
- 进一步优化性能

### Phase 3：遥测（可选）
- 创建 `compaction-telemetry.ts`
- 埋点关键事件
- 可观测性提升

### Phase 4：Usage 校准器（高级）
- 创建 `usage-calibrator.ts`
- 动态调整 tokenizer buffer
- 自适应不同模型

---

## 📞 支持

遇到问题？
1. 检查 [compaction-view-manual-patches.md](./compaction-view-manual-patches.md) 确保所有补丁已应用
2. 运行测试验证基础功能
3. 查看日志定位问题点

祝实施顺利！🎉
