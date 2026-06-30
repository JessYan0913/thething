/**
 * Attachments 模块索引
 *
 * 技能列表信息改为通过 Skill 工具的 `list` 模式主动拉取。
 * 本目录保留 types.ts 中的遗留类型定义以保持向后兼容。
 */

export type {
  Attachment,
} from './types';

export const ATTACHMENTS_MODULE_VERSION = '3.0.0';
