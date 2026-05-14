# 任务1：Core Resolved Agent Config

## 任务说明
把 `CreateAgentOptions`、`BehaviorConfig`、`SessionStateOptions` 和 `ModelProviderConfig` 收敛成一份明确的 `ResolvedAgentConfig`，并让 `api/app/create.ts` 到 `runtime/agent/create.ts` 的链路不再手写白名单截断。

目标是让公开配置项确定性进入 runtime，重点覆盖 `enableThinking`、`maxDenialsPerTool`、`availableModels`、`autoDowngradeCostThreshold` 和 session 级参数透传。

## 范围
- `packages/core/src/api/app/resolve-agent-config.ts`
- `packages/core/src/api/app/create.ts`
- `packages/core/src/api/app/types.ts`
- `packages/core/src/runtime/agent/create.ts`
- `packages/core/src/runtime/agent/types.ts`
- 相关单测

## 核心产出物
- `ResolvedAgentConfig` 解析结果 ✅
- 统一的配置合并入口 (`resolveAgentConfig()`) ✅
- runtime 侧原样消费 resolved config 的调用链 ✅
- 对应行为测试 ✅

## 当前执行情况
- 当前状态：completed
- 已完成：
  - `ResolvedAgentConfig` 类型定义在 `runtime/agent/types.ts`，包含 `modelConfig`、`modules`、`sessionOptions`、`behavior`、`layout`、`toolOutputOverrides`
  - `resolveAgentConfig()` 统一入口在 `api/app/resolve-agent-config.ts`，一次性组装 `sessionOptions`（不再逐字段白名单重建）
  - `CreateAgentConfig` 改为传递 `resolvedConfig: ResolvedAgentConfig`，移除 `modelConfig`、`sessionOptions`、`enableMcp/Skills/Memory/Connector`、`behaviorDefaults`、`layout` 等分散字段
  - `createChatAgent()` 从 `resolvedConfig` 取值，不再逐字段从白名单重建
  - 17 项行为测试覆盖所有验收标准（含 `resolveAgentConfig` 统一入口测试）
- 验收状态：accepted

## 验收清单
- ✅ `enableThinking` 能进入最终模型配置，并可被测试直接断言
- ✅ `sessionOptions` 不再被中间层白名单重建丢字段
- ✅ `availableModels`、`autoDowngradeCostThreshold`、`maxDenialsPerTool` 能到达 runtime 消费点
- ✅ 公开配置新增字段时，不需要在多层对象里重复补拷贝逻辑

## 依赖关系
- 前置依赖：无前置依赖
- 后置关联：task2、task3、task4、task8、task9、task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。