/**
 * Attachments 模块入口
 *
 * 提供消息附件注入功能，用于动态注入技能元数据而不影响系统提示词缓存。
 */

export type {
  Attachment,
  SkillListingAttachment,
} from './types';

export {
  getSentSkills,
  markSkillSent,
  markSkillsSent,
  clearSentSkills,
  isNewSkill,
  getNewSkills,
  getSentSkillCount,
  hasSentSkills,
  clearAllSentSkills,
  getActiveSessionKeys,
} from './sent-tracker';

export {
  SKILL_LISTING_CONFIG,
  filterVisibleSkills,
  getSkillListingAttachment,
  formatSkillListingMessage,
  shouldSendSkillListing,
} from './skill-listing';

// 注入器
export {
  injectMessageAttachments,
  clearMessageAttachmentState,
  extractUserInput,
} from './injector';

export type {
  MessageAttachmentConfig,
  MessageAttachmentResult,
} from './injector';

export const ATTACHMENTS_MODULE_VERSION = '2.0.0';