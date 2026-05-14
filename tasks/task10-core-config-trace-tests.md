# 任务10：Core Config Trace and Tests

## 任务说明
补一层配置追踪能力，并把公开配置的关键字段补齐行为测试，作为防止再次出现参数断层的回归门禁。

目标是让每个公开配置字段都能被追踪来源、最终值和消费点，同时让测试覆盖能直接拦住漏传。

## 范围
- `packages/core/src/api/app/resolve-agent-config.ts`
- `packages/core/src/api/app/__tests__/*`
- `packages/core/src/runtime/*/__tests__/*`
- 相关测试补强

## 核心产出物
- `traceResolvedAgentConfig()` 或等价工具
- 配置来源与最终值的可视化输出
- 公开配置字段的行为测试矩阵

## 当前执行情况
- 当前状态：in-progress
- 已完成：`config-parameter-passing` 等行为测试已经覆盖了多个公开配置字段
- 待完成：`traceResolvedAgentConfig()` 仍未实现，配置来源输出还没有成为统一入口
- 验收状态：not-accepted

## 验收清单
- trace 能输出字段来源、最终值和消费模块
- `enableThinking`、`maxDenialsPerTool`、`availableModels`、`autoDowngradeCostThreshold` 都有行为测试
- `compaction`、`toolOutput`、`resources`、`contextFileNames`、`modelAliases`、`memory`、`dataDir` 覆盖到位
- 新增公开配置字段时，测试结构能拦住漏传回归

## 依赖关系
- 前置依赖：task1、task2、task3、task4、task5、task6、task7、task8、task9
- 后置关联：无后置关联

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。
