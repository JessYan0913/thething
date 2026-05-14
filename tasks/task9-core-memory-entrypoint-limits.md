# 任务9：Core Memory Entrypoint Limits

## 任务说明
把 `BehaviorConfig.memory.entrypointMaxLines` 和 `entrypointMaxBytes` 贯通到 memory entrypoint 的读取、追加和重建逻辑里。

目标是让 memory 入口文件的长度限制不再依赖默认常量，而是由应用层配置明确控制。

## 范围
- `packages/core/src/extensions/memory/index.ts`
- `packages/core/src/extensions/memory/memdir.ts`
- `packages/core/src/extensions/memory/paths.ts`
- `packages/core/src/extensions/memory/extractor.ts`
- 相关单测

## 核心产出物
- memory entrypoint 的显式 limits 参数
- 读取 / 追加 / 重建流程的统一约束
- 超限处理行为的测试

## 当前执行情况
- 当前状态：in-progress
- 已完成：`loadEntrypoint`、`appendToEntrypoint`、`rebuildEntrypoint`、`deleteMemoryFile` 都支持 limits
- 待完成：应用层行为配置到 memory 限制参数的全链路传递仍需核实
- 验收状态：not-accepted

## 验收清单
- `entrypointMaxLines` 能限制 entrypoint 的行数
- `entrypointMaxBytes` 能限制 entrypoint 的字节数
- 追加和重建行为不会绕过限制
- 默认值与覆盖值都能被单测验证

## 依赖关系
- 前置依赖：task1
- 后置关联：task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。
