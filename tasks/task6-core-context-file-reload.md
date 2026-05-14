# 任务6：Core Context File Reload

## 任务说明
让项目上下文文件名和 `reload()` 行为都保留 `LayoutConfig` / `createContext()` 的解析结果，不再硬编码或回退到旧路径。

目标是让 `layout.contextFileNames` 生效，并保证 `createContext({ dataDir })` 之后的 reload 不丢失数据目录覆盖。

## 范围
- `packages/core/src/api/app/context.ts`
- `packages/core/src/extensions/system-prompt/sections/project-context.ts`
- `packages/core/src/runtime/agent/context.ts`
- 相关单测

## 核心产出物
- `contextFileNames` 的显式透传
- `loadProjectContext()` 的参数化
- `reload()` 保留 `dataDir` override
- 对应行为测试

## 验收清单
- 自定义上下文文件名能被正常识别并进入加载结果
- `reload()` 前后 `dataDir` 保持一致，不会静默回退
- 默认上下文文件名在未覆盖时保持兼容
- 测试能证明文件名配置和 reload 覆盖都已生效

## 依赖关系
- 前置依赖：task5
- 后置关联：task7、task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。

