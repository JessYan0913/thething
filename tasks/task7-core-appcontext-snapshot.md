# 任务7：Core AppContext Snapshot

## 任务说明
让 runtime 工具加载优先使用 `AppContext` 里已经加载好的快照数据，避免再次扫描项目目录去重建一套不一致的结果。

目标是恢复 `AppContext` 的快照语义，让 agents、mcps、connectors 的 runtime 使用源自同一份上下文的数据。

## 范围
- `packages/core/src/api/app/context.ts`
- `packages/core/src/runtime/agent/tools.ts`
- `packages/core/src/extensions/connector/loader.ts`
- `packages/core/src/extensions/subagents/*`
- 相关单测

## 核心产出物
- 以 `preloadedData` 为主的工具加载路径
- 默认不再二次扫描的 runtime 行为
- 必要时的显式 `dynamicReload` 入口
- snapshot 一致性测试

## 验收清单
- 默认工具加载路径使用预加载的 agents / mcps / connectors 数据
- 不会因为 runtime 重新扫描而绕过 layout 资源配置
- 动态刷新如果保留，必须由显式选项触发
- 测试能证明同一会话内的快照来源一致

## 依赖关系
- 前置依赖：task5、task6
- 后置关联：task8、task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。

