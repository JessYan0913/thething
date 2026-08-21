# TheThing — Runtime 机制设计(2026-08-21 重写)

> 本文档是 Agent Harness 运行机制的**唯一设计权威**。它取代此前以"症状缝补"方式累积的
> 全部运行时设计文档(压缩、子任务、todo 语义、收尾等),用一套一致的机制取代多层次叠加。

## 问题陈述

此前 harness 围绕 Agent 执行堆叠了大量"给 LLM 做思想工作"的机制,结果反而不稳定:

- **每步 15 件事**:规划引导、todo 同步提醒、上下文水位、goal 续跑、推理空转催促、
  Completion Audit、任务快照、归档重试、子任务整段重建…… 每个 step 都向上下文塞入多条
  user 消息,上下文不断被注射指令污染,模型持续被"管教"。
- **子任务边界整段消息替换**:todo 完成时,把自上个边界起的全部消息丢弃,只留「索引池 +
  当前任务」两行。模型在 run 中途失去思维链,"任务混乱"的首要来源。
- **收尾反复审问 LLM**:每次 run 结束要问模型 2~4 遍(Completion Audit → settle → 归档
  提炼 → 后台标题),每一遍都是不可靠的 LLM 调用,且任意一遍失败都静默。
- **跨请求状态泄漏**:收尾守卫是模块级 `Set`,生产从未清除,同一会话第二次 run 起终止被跳过。
- **双引擎**:Web(`route.ts`)与 Connector(`agent-handler.ts`)各维护一套 run 循环。
- **todo 真替换语义**:一次传错清单即取消未列出的全部任务,任务图一击尽毁。

## 新机制三支柱

1. **One Loop** — 一个 run 循环,`prepareStep` 每步只做三件事:+状态画布组装 / L3 压缩 / 预算闸门。
2. **One Canvas** — 一块任务画布,唯一的模型可见任务状态;每步至多注入一次,取代全部比例式劝告。
3. **One Close** — 一个确定性收尾,只落 `agent_runs` 终态,不再问 LLM;未结账的 in_progress 由系统确定性回卷为 pending。

## 文档导航

- [`runtime.md`](./runtime.md) — One Loop / One Canvas / One Close 完整机制
- [`state-model.md`](./state-model.md) — 状态模型:task 状态、run 终态、todo patch 语义
- [`implementation-phases.md`](./implementation-phases.md) — 分阶段实施清单与验收标准