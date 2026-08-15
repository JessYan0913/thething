# 上下文用量展示重设计（2026-08-16）

## 背景

上一轮已修复展示准确性问题（title 同源、颜色对齐触发点、输出预留单独标出、历史快照提示）与压缩阈值语义（窗口坐标、buffer 反应空间、红黄不倒置）。本轮把面板**内部**从"单色进度条 + 数字行"重排为"分段进度条"，聚焦"离压缩还有多远"的可读性，并透明化构成。

## 设计决策（已与用户确认）

- **入口不变**：保留 18px 圆环按钮 + hover title + 点击弹面板。
- **视觉形态**：分段进度条（非圆环/迷你条）。主驱动是"信息内容"而非视觉大改。
- **主百分比口径**：`totalTokensWithBuffer / modelLimit`（总占用，含输出预留+校准），与引擎触发判断同一坐标系。构成条把同一长度切成四段，正好透明化 outputReserve 底噪。
- **不展示"上次压缩时间"**：core `state-tracker.ts` 零改动，只显示次数 + 释放量。

## 布局（面板内，自上而下）

1. **分段进度条**：按构成分段着色（纯输入=主色 / 工具=次级 / 输出预留=浅 / 校准=更浅），黄线(trigger)/红线(hardLimit)刻度贯穿；条右侧显示当前 %。
2. **图例**：四段颜色标签。
3. **距触发线**：`距触发线还剩 X% · 约 YK tokens`（= trigger − totalTokensWithBuffer）；已过线显示"已触发"，再超红线显示"已超硬限"。
4. **详情行**（精简）：
   - 已压缩：`N 次 · 释放 XK`
   - 缓存命中率：`X% · YK tokens`
   - 本会话成本：`$Y`
   - 删除：窗口 total/limit 行、触发阈值/硬限数字行、输出预留行（被进度条分段/刻度/右侧% 取代）。

## 数据链路

`ContextBudgetSnapshotSchema` 新增可选字段（引擎 `estimateRequestBudget` 均已有，仅透传）：
- `messagesTokens` / `instructionsTokens` / `toolsTokens` / `tokenizerBuffer`

`context-payload.ts` 的 `lastEstimation` 接口 + payload 带上四字段（`route.ts` 透传整个 `lastEstimation` 自动生效）；`Chat.tsx` SSE 透传加四字段；`ChatPage.tsx` DB-loaded 会话不设置 → 回落单段填充，保留"历史快照"提示。

## 组件改动

- `format.ts`：新增纯函数 `buildSegments(snapshot)`（四构成 → `{key,label,tokens,pct,className}`，无构成字段时退化为单段）、`distanceToTrigger(snapshot)`（返回 `{tokens, pct, triggered}`，无 trigger 时 null）；精简 `buildDetailRows`。
- `ContextDetail.tsx`：按上述布局重排；刻度线逻辑保留（外层 relative 容器放刻度，避免 overflow-hidden 裁切）。
- `ContextRing.tsx` / `Chat.tsx` hover title：不改。

## fallback 与边界

- DB-loaded 旧会话：无构成字段 → 单段填充；无 trigger/hard → 无刻度；保留"历史快照"提示。
- 超限（total > limit）：百分比 clamp 100%，填充满，颜色 critical。
- 空会话：进度条近空，构成条仅输出预留一段，距触发线 = trigger 位置。

## 测试

- core：schema 新增可选字段不破坏现有 parse（现有 303 测试兜底）；无 state-tracker 改动。
- app：无测试设施，`format.ts` 纯函数靠 `tsc --noEmit` + review 保证，不引入测试基建。
- 验证：core + app 双 typecheck、core 全量测试跑绿。

## 附带操作

清空 `~/.thething/data/chat.db` 中**对话相关表**（conversations/messages/branches/summaries/agent_runs/stream/costs 等），保留 projects/todos/memories/cron_jobs，不备份（用户确认）。
