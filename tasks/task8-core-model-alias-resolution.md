# 任务8：Core Model Alias Resolution

## 任务说明
把 `BehaviorConfig.modelAliases` 接到统一的模型解析入口，并在 agent、sub-agent、技能元数据和模型切换链路里使用同一套别名规则。

目标是让 `fast`、`smart`、`default` 这类别名真正影响 runtime，而不是只停留在配置结构里。

## 范围
- `packages/core/src/extensions/subagents/model-resolver.ts`
- `packages/core/src/extensions/subagents/tool-resolver.ts`
- `packages/core/src/runtime/agent-control/model-switching.ts`
- `packages/core/src/runtime/agent/tools.ts`
- 相关单测

## 核心产出物
- `resolveModelAlias()` 或等价统一函数
- 所有模型选择点的统一解析
- 别名回退和未知值处理规则
- 对应行为测试

## 当前执行情况
- 当前状态：in-progress
- 已完成：`resolveModelAlias()` 已实现并覆盖 sub-agent 路径，相关测试已写入
- 待完成：模型切换和其他模型选择入口是否全部统一仍待确认
- 验收状态：not-accepted

## 验收清单
- `fast`、`smart`、`default` 等别名能被稳定解析成真实模型
- agent / sub-agent / 模型切换链路使用同一套解析逻辑
- 未知别名不会产生静默错误映射
- 单测能覆盖至少一个别名命中和一个回退场景

## 依赖关系
- 前置依赖：task1
- 后置关联：task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。
