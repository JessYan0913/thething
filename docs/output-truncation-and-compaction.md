# 输出截断与上下文压缩问题记录（续做长任务中途静默截断）

> 日期：2026-08-15
> 状态：**问题记录 + 后续会话调查指引**（非解决方案，不在本会话解决）
> 关联：
> - `docs/compaction-redesign.md`（压缩架构主文档——**管"输入塞不进"，本篇是"输出写不完"**）
> - `docs/todos-utilization-redesign.md`（todos 主线，本问题由续做测试暴露）
> - 会话实例：`chat.db` 中 conversation_id=`sKYk66c0Q3N5rc4EL-WIc`

---

## 1. 现象（真实复现，有数据）

**场景**：本地 Web 跑 2000 字深度长文任务（六步：大纲→三部分→润色→总览），中途停止，再发"继续"续做。

**发生了什么**：
1. 首轮（`02:33:49→02:34:49`）正常：建 6 项清单，完成大纲/第一部分，第二部分进行中时**被用户停止**。停止处理器把 in_progress 的"第二部分"重置为 pending 并记 `stopReason:"Agent stopped by user"`（这是另一个待修点：续做不恢复 in_progress，见 §5 顺带记录）。
2. 续做（`02:35:06→02:35:58`，约 52s）：
   - 正确续完第二部分（todo_write 把它置 completed、第三部分置 in_progress）✓
   - **写第三部分时，输出从"在个人效"处被硬截断**（断在词中间，明显非正常收尾）
   - **ToolLoopAgent 把这段不完整文字当成了"最终答案"，run 正常 `committed`、无任何 error**
   - 结果：第三部分 `in_progress` 卡住、润色/总览未做、无最终答案——**任务静默地没完成**

**关键证据**：
- `conversation_runs`：两次 run 均 `status='committed'`、`error=None`——系统认为自己正常完成了。
- 续跑 assistant 消息的最后一个 text part 以"在个人效"结尾（词被切断）。
- 全链路 grep 不到 `maxTokens`/`max_tokens`：`models.json` 里模型条目只有 `{id}`。

## 2. 直接诊断（表层）

- 应用**未给模型设 max_tokens** → 用 provider 默认输出上限。
- deepseek-v4-pro 开 thinking 后，推理 token 大量占用输出预算，正文剩余空间不足 → 被截断。
- 循环层**无"输出被截断"检测**：只要最后一步只有文本、无工具调用，就视为完成。

## 3. 深层框架（用户指出：这本质是上下文压缩问题）

> 直接诊断（加 max_tokens）是治标。真正的病灶在**上下文预算管理**。

压缩系统目前的全部注意力在**输入侧**："这一次请求能不能塞进窗口"（`request-budget.ts`、`capabilities.ts` 的 `outputReserve`、`compaction-redesign.md` 的"下一次完整请求能否塞进窗口"）。它防的是**"塞不进"**。

但长任务真正的瓶颈往往是**输出侧**：**"写不完"**。

- 长任务多轮累积：续做时历史已含首轮 ~9k 字符输出，可用窗口和输出空间被挤压。
- `capabilities.ts:100` 的 `outputReserve = min(defaultOutputTokens, 20000)` 是**静态输出预留**，不随上下文膨胀动态调整——上下文越大，留给"写完"的空间越紧。
- 当模型生成中途耗尽输出预算 → 静默截断 → 循环误判完成。**系统既没预留够，也没检测截断，更没在截断后触发压缩/续写。**

**一句话**：压缩管了"塞不进"，没管"写不完"。截断是"写不完"的极端形态，而它发生在**多轮累积 + 续做**场景下，正是压缩系统最该介入却没介入的地方。

## 4. 相关代码路径（后续会话定位用）

| 位置 | 角色 |
|---|---|
| `packages/core/src/modules/compaction/request-budget.ts` | 请求估算；`outputReserve` 参与 `totalTokensWithBuffer` |
| `packages/core/src/services/model/capabilities.ts:100` | `outputReserve = Math.min(getDefaultOutputTokens(), 20000)`——静态输出预留 |
| 模型创建/调用层（`createLanguageModel` 等） | 未透传 `maxTokens` → provider 默认截断 |
| `ai` 的 `ToolLoopAgent`（node_modules/ai） | 把"最后一步纯文本"当最终答案；无截断检测 |
| `packages/app/app/api/chat/route.ts:180-203` | 续做注入"未完成任务"note；未恢复 in_progress（§5） |

## 5. 顺带记录（续做测试暴露的另一个问题）

**续做不恢复 in_progress**：`packages/app/app/api/todos/route.ts:100-107` 的 `reset-conversation` 在停止时把 in_progress 重置为 pending。续做时面板/模型看不到"上次正在执行"的状态信号。候选修法：`chat/route.ts` 注入未完成任务前，把带 `stopReason`、最近更新的那条恢复为 in_progress。**独立小问题，可随时修，不依赖本篇主问题。**

## 6. 待调查问题（后续会话的作业清单）

1. **截断检测**：如何可靠判断"响应被 provider 截断"？（`finishReason` 是否含 `length`/`max_tokens`？AI SDK 是否暴露截断信号？文本是否完整收尾？）
2. **截断后行为**：检测到截断后应该怎样——自动续写？先压缩上下文再续？还是应预先把 max_tokens 设够？
3. **输出预算自适应**：`outputReserve` 是否应随上下文占用动态调整（上下文越大，输出预留越紧张）？
4. **续做/多轮累积下的压缩触发**：长任务多轮后，压缩是否该更早介入，给输出留空间？
5. **与 compaction-redesign.md 的关系**：它管输入侧（估算/时机/代价），本篇是输出侧（写不完）。两者如何统一到同一个预算模型？

## 7. 修复候选方向（初步，未实施）

- **治标**：模型调用显式设 `maxOutputTokens`（如 8192+），长输出不再静默截断。
- **治本（属压缩域）**：截断检测 + 自动压缩后续写；输出预算随上下文自适应。
- 方向 2/3 应并入 `compaction-redesign.md` 的后续 Step，作为"输出侧"的一等公民，而非补丁。

---

**给后续会话的一句话**：这不是"调大 max_tokens"的配置活，是压缩系统把**输出侧"写不完"**纳入预算模型的架构活。主文档 `compaction-redesign.md` 讲的是"塞不进"，本篇补的是"写不完"。
