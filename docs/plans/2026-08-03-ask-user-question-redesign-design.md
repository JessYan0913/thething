# ask_user_question 重构:从"借道审批"到 AI SDK 客户端工具

**日期**: 2026-08-03
**状态**: 已实施
**前置**: docs/chat-message-rendering-regression.md(回声问题)、2026-08-02 repairToolCall 修复(输入健壮性)

## 背景:旧机制的问题

旧实现把"向用户提问"塞进了工具审批通道:

```
模型调 ask_user_question → needsApproval=true → 前端弹面板
→ 用户作答 → addToolApprovalResponse({approved: true, reason: JSON.stringify({answers})})
→ 服务端续跑 → execute() 从 messages.at(-1) 的 tool-approval-response.reason 里抠答案
```

问题清单:

- **A. 传输脆弱**: `extractAnswers` 只看最后一条消息、不按 approvalId 匹配、
  依赖 SDK 内部消息形状;答案作为 JSON 字符串藏在本应是"批准理由"的字段里
- **B. auto-review + goal 静默空答案**: 该模式下审批被自动放行,execute 找不到
  reason,返回 `{answers: {}}` 的"成功"结果,模型只能瞎猜
- **C. header 作 answers 主键**: header 限 12 字符、可重复,两问同 header 互相覆盖
- **D. 对话流无回声**: 答完面板消失,对话里只剩一行原始 JSON
- **E. 跨重启答不了**: suspended-approval 接口只传 `approved: boolean`,无答案通道

## 新机制:AI SDK 客户端工具(无 execute)

AI SDK v7 对"无 execute 的工具"的原生语义就是 human-in-the-loop:
服务端 agent 循环遇到该工具调用时**不执行、不继续**,流以 `input-available`
状态结束;客户端补上 output 后重新发起请求,SDK 把 output 转成 `tool-result`
喂回模型。已验证的关键行为:

- 循环继续条件 `clientToolCalls.length === clientToolOutputs.length + denied`
  (ai/dist/index.js streamText 步进逻辑)——无 output 的客户端工具调用会终止循环
- `useChat().addToolOutput({tool, toolCallId, output})` 更新 part 状态并触发
  `sendAutomaticallyWhen`;**不需要活跃流**(对比 addToolApprovalResponse),
  刷新/重启后照样能用 → 问题 E 顺带消解
- resume 时 `convertToModelMessages` 对 `output-available` part 生成
  `tool-call` + `tool-result` 对,`MissingToolResultsError` 校验通过

```
模型调 ask_user_question(无 execute,无 needsApproval)
→ 流以 input-available 结束,onEnd 持久化该 assistant 消息
→ 前端(streaming 中或刷新加载后)检测 input-available part → 弹面板
→ 用户作答 → addToolOutput({toolCallId, output: {answers: [...]}})
→ sendAutomaticallyWhen → POST assistant continuation
→ route 检测 continuation → commitAssistantContinuation(不可变版本推进)
→ createAgentUIStream resume → 模型看到结构化 tool-result
```

## 数据结构

### 工具定义(packages/core/src/modules/tools/ask-user-question.ts)

```ts
inputSchema: { questions: Array<{question, header, options[2-4], multiSelect?}> }  // 1-4 个,不变
outputSchema: { answers: Array<{question: string, answer: string | string[]}> }    // 新
```

- 去掉 `execute`、`needsApproval`、`extractAnswers`
- answers 是**与 questions 对齐的数组**,以完整 question 文本回带,
  不再用 header 当 key → 问题 C 消解;模型直接读 Q/A 对
- 自定义输入(原 `__custom__` 前缀)由面板剥前缀后作为普通 answer 传出
- 保留 `repairAskUserQuestionRawInput`(repairToolCall 输入修复,与传输机制正交)

### 取消语义

用户点取消 → `addToolOutput({state: 'output-error', errorText: '用户取消了提问,…'})`
→ resume 时模型看到明确的错误文本,知道用户拒答而非系统故障。

## 各层改动

### core

1. **ask-user-question.ts**: 如上重写
2. **tool-approval.ts**: 删除 `ask_user_question` 特判分支(含 auto-review+goal
   自动放行 → 问题 B 消解:提问永远等真人,goal 模式靠 goal-prompts 指示模型
   别提问,而不是放行后伪造空答案)
3. **message-store.ts** `hasMatchingToolCall`: 状态转移表新增
   `input-available → output-available | output-error`(客户端工具作答);
   保留原有 approval 两条转移(其他工具的审批续跑仍走旧路)

### app 服务端(route.ts)

`isAssistantContinuation` 检测扩展:`approval-responded` 之外,
`tool-ask_user_question` part 处于 `output-available | output-error` 也算
continuation。宽检测 + `commitAssistantContinuation` 内 `hasMatchingToolCall`
严校验(必须匹配当前 head 上同 toolCallId 的合法状态转移),防任意 assistant 写入。

### app 客户端(Chat.tsx + UserQuestionPanel)

1. **检测**: `sendAutomaticallyWhen` 与 `collectPendingApprovals` 中,问题面板
   触发条件从 `approval-requested + approval.id` 改为
   `tool-ask_user_question + state === 'input-available'`;questionPanel 状态
   去掉 approvalId,只留 toolCallId
2. **回写**: `handleQuestionsComplete/Cancel` 从 `addToolApprovalResponse`
   改为 `addToolOutput`
3. **回声(问题 D)**: 工具行下方内联渲染已答 Q/A 对(完成态),
   `formatToolOutput` 预览面板同步输出可读文本而非 JSON
4. **Panel**: `onComplete` 回调签名改为数组结构,内部逻辑(单选/多选/自定义)不变

## 兼容性

- **历史消息**: 旧对话里 approval 形态的 ask_user_question part 已是终态
  (output-available/denied),渲染层按通用工具行展示,不受影响;
  唯一跨机制场景是"旧版本挂起的 approval-requested 问题 + 新代码作答",
  存量数据极少,不做迁移——重新提问即可
- **其他工具审批**: bash/write_file 等的 approval 流一概不动
- **后台/goal 运行**: 模型若仍提问,流会挂起等待用户——这是提问的正确语义;
  goal-prompts 已指示模型 goal 模式下不提问

## 测试

- core: `hasMatchingToolCall` 新转移的 message-store 单测;
  repair 函数原有 6 测保留
- 手工端到端: 提问→作答→模型收到结构化答案;提问→刷新→面板重建→作答→续跑;
  提问→取消→模型收到取消错误
