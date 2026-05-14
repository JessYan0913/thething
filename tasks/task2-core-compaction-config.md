# 任务2：Core Compaction Config

## 任务说明
把 `BehaviorConfig.compaction` 与 `CreateAgentOptions.compaction` 合并成稳定的有效配置，并完整传入 `SessionState` 和 compaction runtime。

目标是消除压缩配置在应用层到 runtime 之间的断层，让 session memory、micro compact、post compact 的行为都由解析后的配置驱动。

## 范围
- `packages/core/src/api/app/create.ts`
- `packages/core/src/api/app/resolve-agent-config.ts`
- `packages/core/src/runtime/agent/create.ts`
- `packages/core/src/runtime/compaction/*`
- 相关单测

## 核心产出物
- `resolveAgentCompactionConfig()` 的稳定输出
- `compactionConfig` 贯通到 `SessionState`
- compaction 默认值与 override 的合并规则
- 压缩行为覆盖测试

## 当前执行情况
- 当前状态：in-progress
- 已完成：`resolveAgentCompactionConfig`、`compactionConfig` 传入 `SessionState`、`compactionEnabled` 开关已接入
- 待完成：micro compact、post compact 和自动压缩触发逻辑还未完全统一到同一配置源
- 验收状态：not-accepted

## 验收清单
- `behavior.compaction` 与 `options.compaction` 的合并结果可预测
- `sessionOptions.compactionConfig` 能被 runtime 原样消费
- session memory、micro compact、post compact 的关键参数不再回退到未声明默认值
- 压缩相关测试能覆盖至少一个明确的行为结果

## 依赖关系
- 前置依赖：task1
- 后置关联：task3、task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。
