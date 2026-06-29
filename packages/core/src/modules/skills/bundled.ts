// ============================================================
// Bundled Skills - 随产品分发的内置 Skills
// ============================================================
//
// 已移除 RESEARCH_SKILL（builtin）—— 功能被 research sub-agent 完全覆盖。
// research sub-agent 提供更独立的深度研究能力，且不会与 main agent
// 的工具集产生混淆。如需添加新的内置 skill，在此数组中追加。
//
// Skill 加载器（loader.ts）中的合并逻辑：
//   先加载 BUNDLED_SKILLS（最低优先级），
//   再加载文件系统中的 skill 文件（覆盖同名 builtin）。
// ============================================================

import type { Skill } from './types';

/**
 * 所有内置 Skills（当前为空）
 */
export const BUNDLED_SKILLS: Skill[] = [];
