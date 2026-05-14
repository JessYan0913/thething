# 任务5：Core Layout Resource Loaders

## 任务说明
让 `LayoutConfig.resources` 真正分发到各类 loader，避免 loader 继续回退到项目默认目录重新扫描。

目标是让 skills、agents、mcps、connectors、permissions、memory 的加载路径都以解析后的 layout 为准。

## 范围
- `packages/core/src/api/loaders/index.ts`
- `packages/core/src/api/loaders/skills.ts`
- `packages/core/src/api/loaders/agents.ts`
- `packages/core/src/api/loaders/mcps.ts`
- `packages/core/src/api/loaders/connectors.ts`
- `packages/core/src/api/loaders/permissions.ts`
- `packages/core/src/api/loaders/memory.ts`
- 相关单测

## 核心产出物
- `resourceDirs` 到各 loader 的显式透传
- loader 的 `dirs` 入参支持
- 自定义资源目录生效的行为测试

## 验收清单
- `layout.resources.skills`、`agents`、`mcps`、`connectors`、`permissions`、`memory` 都能影响对应加载路径
- `loadAll()` 不再依赖隐式默认扫描来补齐已声明目录
- `loadedFrom` 或等价来源信息能反映真实加载路径
- 默认行为在未传自定义目录时保持兼容

## 依赖关系
- 前置依赖：无前置依赖
- 后置关联：task6、task7

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。

