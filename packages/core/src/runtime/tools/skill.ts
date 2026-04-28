// ============================================================
// Skill Tool - 技能调用工具
// ============================================================
//
// 参考 Claude Code 的 SkillTool 设计：
// - Agent 主动调用获取完整技能指令
// - 工具返回包含技能指令的文本，Agent 必须遵循执行
// - 支持 allowedTools 工具白名单和 model 覆盖

import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { loadSkillFile } from '../../api/loaders/skills';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';
import type { Skill } from '../../extensions/skills/types';

// ============================================================
// Input Schema
// ============================================================

const SkillToolInputSchema = z.object({
  skill: z
    .string()
    .min(1)
    .max(50)
    .describe('The skill name to invoke. E.g., "docx", "review-pr", "commit"'),
  args: z
    .string()
    .optional()
    .describe('Optional arguments for the skill. Will be substituted into $ARGUMENTS placeholders'),
  cwd: z
    .string()
    .optional()
    .describe('Optional working directory. If not provided, uses current project directory'),
});

// ============================================================
// 输出类型
// ============================================================

interface SkillToolResult {
  success: boolean;
  skillName: string;
  skillPath?: string;
  allowedTools: string[];
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  error?: string;
}

// ============================================================
// 技能加载辅助函数
// ============================================================

/**
 * 向上搜索技能目录
 *
 * 从 cwd 开始，向上搜索 ${DEFAULT_PROJECT_CONFIG_DIR_NAME}/skills 目录，
 * 直到找到或到达用户 home 目录。
 *
 * @param cwd - 当前工作目录
 * @returns 找到的技能目录列表
 */
async function findSkillDirs(cwd: string): Promise<string[]> {
  const skillDirs: string[] = [];
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const userSkillDir = path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'skills');

  // 1. 添加用户级技能目录（如果存在）
  try {
    const stat = await fs.stat(userSkillDir);
    if (stat.isDirectory()) {
      skillDirs.push(userSkillDir);
    }
  } catch {
    // 用户级目录不存在，继续
  }

  // 2. 向上搜索项目级技能目录
  let currentDir = cwd;
  while (currentDir) {
    const projectSkillDir = path.join(currentDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'skills');
    try {
      const stat = await fs.stat(projectSkillDir);
      if (stat.isDirectory()) {
        skillDirs.push(projectSkillDir);
        // 找到后停止向上搜索（假设最近的是正确的）
        break;
      }
    } catch {
      // 目录不存在，继续向上
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || parentDir === homeDir) {
      // 到达根目录或用户 home 目录，停止
      break;
    }
    currentDir = parentDir;
  }

  return skillDirs;
}

/**
 * 在技能目录中查找指定技能
 *
 * @param skillDirs - 技能目录列表
 * @param skillName - 技能名称
 * @returns 技能数据或 null
 */
async function searchSkillInDirs(skillDirs: string[], skillName: string): Promise<Skill | null> {
  for (const skillDir of skillDirs) {
    try {
      const skillSubDir = path.join(skillDir, skillName);
      const skillFile = path.join(skillSubDir, 'SKILL.md');

      const stat = await fs.stat(skillFile);
      if (!stat.isFile()) continue;

      // 确定来源
      const source = skillDir.includes(`${DEFAULT_PROJECT_CONFIG_DIR_NAME}/skills`) && !skillDir.includes(process.env.HOME || '')
        ? 'project'
        : 'user';

      const skill = await loadSkillFile(skillFile, source as 'user' | 'project');
      if (skill.name === skillName) {
        return skill;
      }
    } catch (error) {
      // 技能文件不存在或加载失败，继续搜索下一个目录
      console.debug(`[SkillTool] Skill ${skillName} not found in ${skillDir}`);
    }
  }

  return null;
}

/**
 * 加载指定技能
 *
 * @param skillName - 技能名称
 * @param cwd - 当前工作目录
 * @returns 技能数据或 null
 */
async function findSkill(skillName: string, cwd: string): Promise<Skill | null> {
  // 搜索所有可能的技能目录
  const skillDirs = await findSkillDirs(cwd);

  if (skillDirs.length === 0) {
    console.warn(`[SkillTool] No skill directories found for cwd: ${cwd}`);
    return null;
  }

  // 在各目录中查找技能
  const skill = await searchSkillInDirs(skillDirs, skillName);

  if (skill) {
    console.log(`[SkillTool] Found skill ${skillName} in ${skill.sourcePath}`);
  } else {
    console.warn(`[SkillTool] Skill ${skillName} not found in any skill directory`);
  }

  return skill;
}

/**
 * 格式化技能指令为工具输出
 *
 * @param skill - 技能数据
 * @param args - 可选参数
 * @returns 格式化后的文本
 */
function formatSkillOutput(skill: Skill, args?: string): string {
  // 替换 $ARGUMENTS 占位符
  let body = skill.body || '';
  if (args && body.includes('$ARGUMENTS')) {
    body = body.replace(/\$ARGUMENTS/g, args);
  }

  // 构建完整输出
  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🎯 Skill: ${skill.name}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    body,
    '',
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // 如果有 paths 配置，添加输出目录提示（重要：告诉 Agent 输出位置）
  if (skill.paths && skill.paths.length > 0) {
    lines.push(`📁 Output directories: ${skill.paths.join(', ')}`);
    lines.push(`   → Save generated files to one of these directories, NOT in root or random locations.`);
  }

  // 如果有 allowedTools，添加提示
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    lines.push(`📋 Available tools for this skill: ${skill.allowedTools.join(', ')}`);
  }

  // 如果有 model 覆盖，添加提示
  if (skill.model) {
    lines.push(`🤖 Model override: ${skill.model}`);
  }

  // 如果有 effort，添加提示
  if (skill.effort) {
    lines.push(`⚡ Effort level: ${skill.effort}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push('');
  lines.push('⚠️ IMPORTANT: You MUST follow the skill instructions above. Do NOT ignore or skip any steps.');

  return lines.join('\n');
}

// ============================================================
// Skill Tool 定义
// ============================================================

export const skillTool = tool({
  description: `Execute a skill within the main conversation.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- { skill: "docx" } - invoke the docx skill
- { skill: "commit", args: "-m 'Fix bug'" } - invoke with arguments
- { skill: "review-pr", args: "123" } - invoke with arguments

IMPORTANT:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <skill> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again`,

  inputSchema: SkillToolInputSchema,

  execute: async ({ skill, args, cwd: inputCwd }, options) => {
    // 使用传入的 cwd，或使用当前工作目录
    const cwd = inputCwd ?? process.cwd();

    const trimmedSkill = skill.trim().replace(/^\/+/, '');  // 移除开头的斜杠

    console.log(`[SkillTool] Invoking skill: ${trimmedSkill}${args ? ` with args: ${args}` : ''}`);

    // 加载技能
    const skillData = await findSkill(trimmedSkill, cwd);

    if (!skillData) {
      return {
        success: false,
        skillName: trimmedSkill,
        allowedTools: [],
        error: `Unknown skill: ${trimmedSkill}. Check available skills in system-reminder messages.`,
      } as SkillToolResult;
    }

    // 格式化技能指令
    const output = formatSkillOutput(skillData, args);

    console.log(`[SkillTool] Skill loaded: ${skillData.name} (${skillData.body?.length || 0} chars)`);
    console.log(`[SkillTool] Allowed tools: ${skillData.allowedTools?.join(', ') || 'none'}`);

    return {
      success: true,
      skillName: skillData.name,
      skillPath: skillData.sourcePath,
      allowedTools: skillData.allowedTools || [],
      model: skillData.model,
      effort: skillData.effort,
      _skillOutput: output,  // 内部字段，供 toModelOutput 使用
    } as SkillToolResult & { _skillOutput: string };
  },

  toModelOutput: ({ output }) => {
    // 如果加载成功，返回完整技能指令
    if (output && typeof output === 'object') {
      const result = output as SkillToolResult & { _skillOutput?: string };
      if (result.success && result._skillOutput) {
        return { type: 'text' as const, value: result._skillOutput };
      }
      if (!result.success && result.error) {
        return { type: 'text' as const, value: `❌ ${result.error}` };
      }
    }
    return { type: 'text' as const, value: 'Skill invocation completed.' };
  },
});