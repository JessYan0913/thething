/**
 * Attachment 类型定义
 *
 * Attachment 用于通过消息附件注入元数据，不影响系统提示词缓存。
 */

import type { Skill } from '../skills/types';

/**
 * 附件基础接口
 */
export interface Attachment {
  type: string;
}

/**
 * 技能列表附件
 *
 * 用于首次或新增技能时注入技能摘要列表。
 * 预算控制在 context window 的 1%。
 */
export interface SkillListingAttachment extends Attachment {
  type: 'skill_listing';
  content: string;           // 格式化后的技能列表
  skillCount: number;        // 技能数量
  isInitial: boolean;        // 是否是首次发送
}

/**
 * 技能发现附件
 *
 * 用于 TF-IDF 搜索发现相关技能后注入。
 */
export interface SkillDiscoveryAttachment extends Attachment {
  type: 'skill_discovery';
  skills: SkillDiscoveryResult[];
  signal: DiscoverySignal;
  source: 'native' | 'remote' | 'both';
}

/**
 * 技能发现结果
 */
export interface SkillDiscoveryResult {
  name: string;
  description: string;
  score: number;
  autoLoaded: boolean;       // 是否自动加载完整内容
  content?: string;          // 自动加载的完整内容
  path?: string;             // SKILL.md 路径
}

/**
 * 发现信号
 *
 * 记录搜索触发信息，用于调试和分析。
 */
export interface DiscoverySignal {
  trigger: 'user_input' | 'assistant_turn' | 'subagent_spawn';
  queryText: string;
  startedAt: number;
  durationMs: number;
  indexSize: number;
  method: 'tfidf' | 'keyword';
}

/**
 * 技能索引条目
 *
 * 用于 TF-IDF 搜索索引。
 */
export interface SkillIndexEntry {
  name: string;
  normalizedName: string;
  description: string;
  whenToUse?: string;
  source: string;
  sourcePath: string;
  contentLength?: number;
  tokens: string[];
  tfVector: Map<string, number>;
}

/**
 * 技能可见性级别
 *
 * 控制技能在列表中的可见程度。
 */
export type SkillVisibility = 'always' | 'ondemand' | 'hidden';

/**
 * 技能可见性配置
 */
export interface SkillVisibilityConfig {
  bundled: SkillVisibility;    // 内置技能
  mcp: SkillVisibility;        // MCP 技能
  project: SkillVisibility;    // 项目技能
  user: SkillVisibility;       // 用户技能
}