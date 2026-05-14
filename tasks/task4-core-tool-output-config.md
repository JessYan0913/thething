# 任务4：Core Tool Output Config

## 任务说明
把 `BehaviorConfig.toolOutput` 接入 runtime 工具输出管理链路，去掉依赖全局单例的隐式覆盖方式，改成按 session 传递配置。

目标是让 `maxResultSizeChars`、`maxToolResultsPerMessageChars`、`previewSizeChars` 等限制真正由应用层配置控制。

## 范围
- `packages/core/src/api/app/create.ts`
- `packages/core/src/runtime/budget/tool-output-manager.ts`
- `packages/core/src/runtime/agent/create.ts`
- `packages/core/src/runtime/agent/tools.ts`
- 相关单测

## 核心产出物
- `BehaviorConfig.toolOutput` 到 `SessionState.toolOutputConfig` 的传递
- 工具输出处理函数按 session config 取值
- 全局覆盖模式的隔离或降级
- 对应行为测试

## 验收清单
- `maxResultSizeChars`、`maxToolResultsPerMessageChars`、`previewSizeChars` 都能影响实际输出处理
- 多个 session 之间不会互相污染工具输出限制
- `processToolOutput()` 的结果可被 session 配置稳定控制
- 单测能覆盖至少一个大小截断场景和一个消息预算场景

## 依赖关系
- 前置依赖：task1
- 后置关联：task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。

