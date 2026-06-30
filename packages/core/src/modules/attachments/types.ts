/**
 * Attachment 类型定义
 *
 * 技能列表信息改为通过 Skill 工具主动拉取，不再使用消息附件注入。
 * 本文件保留基础 Attachment 接口以备未来扩展。
 */

/**
 * 附件基础接口
 */
export interface Attachment {
  type: string;
}
