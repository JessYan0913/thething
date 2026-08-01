// ============================================================
// Skill Preferences - pinned / disabled 用户偏好读取
// ============================================================
//
// ~/.thething/preferences.json 由 app 层（selectedModel 等键）与 core 层
// （skills 键）共享，各自只读写自己的键，互不感知。
// core 侧只读：pinned/disabled 的修改暂由用户手改 JSON。

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../primitives/logger';

export interface SkillPreferences {
  /** 常驻集置顶技能名（优先级仅次于 builtin），条目不截断 */
  pinned: string[];
  /** 完全禁用的技能名：不进常驻/目录、find_skills 不返回、skill 工具拒绝加载 */
  disabled: string[];
}

export const EMPTY_SKILL_PREFERENCES: SkillPreferences = { pinned: [], disabled: [] };

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * 从 <configDir>/preferences.json 读取 skills 键。
 * 文件不存在、JSON 损坏或键缺失时返回空默认（容错，不抛出）。
 */
export async function loadSkillPreferences(configDir: string): Promise<SkillPreferences> {
  const file = path.join(configDir, 'preferences.json');
  try {
    const content = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(content) as { skills?: { pinned?: unknown; disabled?: unknown } };
    return {
      pinned: toStringArray(parsed.skills?.pinned),
      disabled: toStringArray(parsed.skills?.disabled),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug('SkillPreferences', `Failed to read ${file}: ${err}`);
    }
    return EMPTY_SKILL_PREFERENCES;
  }
}
