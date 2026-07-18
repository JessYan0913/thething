# 入站连接器设计分析

> 分析日期: 2026-07-18
> 分析范围: `packages/core/src/modules/connector/inbound/`、`packages/core/src/composition/inbound/`、`packages/app/app/api/connector/webhooks/`
>
> 基于 [connector-mechanism-analysis.md](../connector-mechanism-analysis.md) 的入站部分深入展开。

---

## 总体判断

**"入站消息 → Agent 处理 → 出站 tool call 回复"的大逻辑是合理且优雅的，不需要改变。**

回复复用出站 connector 框架的凭据管理、模板渲染、超时控制，Agent 自主决策回复内容，审批也能统一覆盖回复路径。但当前实现有几处关键设计决策需要重做。

---

## 一、当前设计中做得好的部分（应该保留）

### 1. 分层架构清晰

```
Gateway → Adapter → Inbox → Processor → Handler → Responder
```

每层职责明确：
- **Gateway**: 统一的 HTTP 请求入口，分发给对应 adapter
- **Adapter**: 平台协议适配（飞书/微信/REST API），负责验证/解密/解析
- **Inbox**: 消息队列，提供幂等、重试、死信机制
- **Processor**: 从 inbox 取消息，调 Handler 处理，写回复
- **Handler**: Agent 交互，包括审批挂起/恢复
- **Responder**: 通过 connector 的 outbound 工具发回复

### 2. Inbox 抽象接口统一

Memory 和 SQLite 双实现共享同一接口。Memory inbox 适合开发调试，SQLite inbox 具备幂等（INSERT OR IGNORE）、指数退避重试、死信、可见性超时——设计思路上是正确的。

### 3. 审批挂起/恢复模式正确

保存 Agent 执行现场 → SQLite 持久化（跨重启） → 用户回复关键词恢复 → 在现场追加 approval-response 续跑。这个 checkpoint/resume 的模式是对的，只是交互层面用朴素子串匹配猜意图太粗糙。

---

## 二、需要重做的设计

### 2.1 异步边界：webhook 响应和消息处理必须彻底分离

**现状**: Adapter 的 `parse()` 在 HTTP 请求返回前同步执行——下载附件、解码图片、解析富文本全在这个阶段。飞书 webhook 要求 3 秒内响应，大附件直接超时。

**设计缺陷**: 快路径（验证 + 入队）和慢路径（解析正文 + 下载附件）混在一起。

**改进方案**:

```
Webhook 请求进来（快路径，目标 <500ms 总耗时）
  → 签名验证（<100ms）
  → 提取事件元信息：eventId、消息类型、发送者（只解析 envelope，不解析 body）
  → 入队持久化
  → 返回 200

Worker 异步取出（慢路径，允许失败重试）
  → 下载附件、解码图片
  → 组装完整消息体
  → 交给 Agent 处理
```

**关键设计决策**: 把 `Adapter.parse()` 拆成两个方法：

| 方法 | 执行阶段 | 超时要求 | 失败处理 |
|------|---------|---------|---------|
| `parseEnvelope()` | webhook handler 同步 | <100ms | 返回 400 / 拒绝入队 |
| `parseBody()` | worker 异步 | 无硬限制 | 重试 / 死信 |

---

### 2.2 锁模型：对齐 Agent 的分钟级运行时长

**现状**: 可见性超时 60 秒。Agent 运行是分钟级的（一个复杂任务可能跑几分钟甚至更长）。心跳续锁的配置项（`heartbeatIntervalMs`）存在但实现从未写入。结果：Agent 还在跑，锁必然过期，消息被重复派发。

**设计缺陷**: Inbox 按"秒级任务"建模，Agent 是分钟级工作负载，两个时间尺度从未对齐。

**两种正确方案**:

| | 方案 A：长超时 | 方案 B：短超时 + 心跳 |
|---|---|---|
| 做法 | 可见性超时 = 30 分钟（覆盖最大 Agent 运行时长） | 可见性超时 = 60 秒，Worker 每 20 秒调 `UPDATE SET heartbeat = now()` 续一次 |
| 优点 | 简单，零额外代码 | Worker 崩溃后消息快速恢复（60 秒后被重新派发） |
| 缺点 | Worker 崩溃后消息要等 30 分钟才能恢复 | 需要实现心跳续锁逻辑 |
| 适合场景 | 单 worker、个人助手 | 多 worker、生产化部署 |

**建议**: 当前阶段先走方案 A。不论哪种，当前"60 秒不加心跳"的设计两头不靠——既没有长超时的简单，又没有心跳的快恢复。

---

### 2.3 去重语义：以业务 ID 为准，不以传输通道为准

**现状**: Memory inbox 用 `connectorId:protocol:externalEventId`，SQLite inbox 用含 transport 的 `event.id`。同一条飞书消息从 HTTP webhook 和 WebSocket 长连接同时进来，Memory inbox 能正确去重，SQLite inbox 当成两条处理。

**设计缺陷**: transport（传输方式）是实现细节，不是消息身份的一部分。

**改进**: 去重 key 统一为 `{connectorId}:{externalEventId}`。不论从哪个通道进来，只要 externalEventId 相同就是同一条消息。

---

### 2.4 审批交互：状态机 + 结构化响应，不是子串匹配

**现状**: 任何消息里包含"好"/"行"/"ok"/"no" 就被当成审批回复。"好的，不要删了"先命中 deny 分支。

**设计缺陷**: 在自然语言消息中猜意图本质上是不可靠的。

**改进方案**:

```
状态机:

  IDLE ──Agent 触发审批──▶ AWAITING_APPROVAL ──用户明确批准──▶ APPROVED（恢复 Agent）
                              │
                              ├──用户明确拒绝──▶ DENIED（通知用户，清理现场）
                              │
                              └──超时──▶ EXPIRED（通知用户超时，清理现场）

触发审批时:
  → 发送结构化审批卡片（飞书用交互卡片按钮，微信用"回复 Y/N"模板消息）
  → 进入 AWAITING_APPROVAL 状态
  → 持久化 Agent 执行现场

收到回复时:
  → 先检查是否处于 AWAITING_APPROVAL 状态
  → 不在 → 当普通消息，触发新 Agent run
  → 在 → 解析结构化响应（按钮回调 / 特定格式指令）
  → APPROVED → 恢复 Agent 续跑
  → DENIED → 通知用户，清理现场
  → 无法解析 → 提示用户重新选择，不进入任何分支

超时:
  → 向用户发送超时通知
  → 清理现场，退出 AWAITING_APPROVAL 状态
  → 后续回复不再被当成审批响应
```

**核心原则**: 审批响应必须是明确的、结构化的、在特定状态上下文中才生效的。不能用自然语言子串匹配猜用户意图。

---

### 2.5 响应投递：独立的重试通道

**现状**: 回复失败只记日志，Agent 已生成的回复直接丢弃。

**设计缺陷**: 回复投递和消息处理共享同一条成功/失败路径。

**改进**:

```
Agent 产出回复
  → 回复内容持久化（先落盘，不丢）
  → 通过 connector inbound.reply 工具投递
  → 成功 → 标记消息 completed
  → 失败 → 指数退避重试（最多 N 次）
  → 全部失败 → 标记 dead，通知用户"回复发送失败，请手动查看"
```

回复投递应该是独立步骤，有自己的重试和降级策略，不和 Agent 处理绑定在同一事务中。

---

### 2.6 吞吐模型：批量拉取 + 连续派发

**现状**: `dispatchPending` 每次只取 `LIMIT 1`，处理完不续取，只靠 1 秒轮询驱动。硬上限 ~1 条/秒。

**设计缺陷**: "一次只做一件事 + 固定等待间隔"是对批处理场景的反模式。

**改进**:

```
Worker 循环:
  → SELECT * FROM pending WHERE ... ORDER BY created_at LIMIT N (N=10)
  → 并发/顺序处理这批消息
  → 处理完立刻检查下一批（有工作就继续，不 sleep）
  → 只在空批次时 sleep 1 秒
```

这不需要换技术栈，SQLite 完全够用——只是把拉取策略从"一次一条 + 固定间隔"改成"批量 + 连续"。

---

## 三、不需要改的部分

- **技术选型**: SQLite 做 inbox 对单机个人助手场景完全够用，不需要引入 Redis / RabbitMQ
- **分层架构**: Gateway → Adapter → Inbox → Processor → Handler 的分层是清晰的
- **approval checkpoint/resume 模式**: 保存现场 + 持久化 + 恢复续跑的设计思路是对的
- **指数退避 + 死信**: 重试策略的设计思路是对的，只是被 processor 吞异常的 bug 架空了
- **回复复用出站 connector**: "入站 → Agent → 出站 tool call 回复"的核心设计正确且优雅

---

## 四、总结

入站设计的根因是两个**时间尺度的错配**:

| 错配 | Webhook 3 秒超时 vs 附件下载几十秒 | Inbox 60 秒超时 vs Agent 分钟级运行 |
|------|--------------------------------------|--------------------------------------|
| 表现形式 | 大附件下载导致 webhook 超时，触发重推 | Agent 还在跑，锁已过期，消息重复执行 |
| 根因 | 快慢路径混在一起 | 锁模型未按 Agent 工作负载设计 |
| 修复方向 | 拆分为 parseEnvelope + parseBody | 长超时方案或心跳续锁方案 |

此外还有去重 key 不一致、审批子串匹配、LIMIT 1 吞吐上限三个独立的设计粗糙点。实现层面还有 6 个 bug（processor 吞异常、stream 笔误、agentType 被丢弃、飞书验证缺口、bot 消息不过滤、测试全失败），但这些是代码问题，不在此展开。
