import type { SystemPromptSection } from '../types';

// ============================================================================
// Actions Section - 操作安全指导
// ============================================================================

/**
 * Creates the actions section for the system prompt.
 * 定义哪些操作需要确认，哪些可以自主执行。
 * 借鉴 Claude Code 的操作安全思想，但通用化。
 */
export function createActionsSection(): SystemPromptSection {
  const content = `【操作安全】

## 需要确认的操作
- 删除或覆盖用户数据
- 发送消息或发布内容到外部平台
- 修改系统设置或配置
- 执行批量操作或影响范围较大的操作

## 可以自主执行
- 读取文件和信息
- 搜索和分析
- 本地可逆的操作
- 用户明确指示的操作

## 原则
- 本地可逆操作可自由执行
- 风险操作先确认再执行
- 用户批准一次不代表所有场景都批准`;

  return {
    name: 'actions',
    content,
    cacheStrategy: 'static',
    priority: 4,
  };
}
