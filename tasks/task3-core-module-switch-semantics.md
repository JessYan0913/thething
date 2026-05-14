# 任务3：Core Module Switch Semantics

## 任务说明
明确 `modules.permissions` 和 `modules.compaction` 的 runtime 语义，并把它们落到可验证的开关行为上。

目标是避免“类型里有开关、runtime 没语义”的情况，尤其要区分权限提示注入和底层安全拦截、普通自动压缩和紧急恢复路径。

## 范围
- `packages/core/src/api/app/create.ts`
- `packages/core/src/config/behavior.ts`
- `packages/core/src/runtime/agent/create.ts`
- `packages/core/src/extensions/permissions/*`
- `packages/core/src/runtime/compaction/*`
- 相关单测

## 核心产出物
- `modules.permissions` 的明确注入行为
- `modules.compaction` 的明确启停行为
- 对应的运行时条件分支
- 公开说明和测试覆盖

## 当前执行情况
- 当前状态：implemented-pending-verification
- 已完成：`modules.permissions=false` 可跳过权限提示注入，`modules.compaction=false` 可关闭普通自动压缩
- 待完成：权限注入与底层安全拦截的边界说明还需要更明确的回归验证
- 验收状态：not-accepted

## 验收清单
- `modules.permissions = false` 时，不再把权限规则注入 system prompt
- `modules.compaction = false` 时，普通自动压缩被禁用
- 紧急 PTL / retry 路径的保留或禁止有明确规则，不再依赖隐式默认值
- 对应行为测试能直接验证开关结果

## 依赖关系
- 前置依赖：task1、task2
- 后置关联：task10

本任务完成后，及时更新任务进度总跟踪文档对应任务的进度和验收状态，确保信息一致。
