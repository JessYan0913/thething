// ============================================================
// Skill Tool - 技能调用工具
// ============================================================
//
// Agent 通过此工具主动获取完整技能指令。
// 支持两种模式：
//   skill: "list"       → 返回所有可用技能的名称+描述（列举模式）
//   skill: "<name>"     → 返回指定技能的完整 body + 目录树（调用模式）
//
// 设计原则：技能信息由 Agent 主动拉取，而非系统推送。
// 子 Agent 通过继承 parentTools 自动获得本工具，无需额外注入。

import { tool } from 'ai';
import { z } from 'zod';
import * as path from 'path';
import type { Skill } from '../../modules/skills/types';
import { formatSkillsWithinBudget } from '../../modules/skills/budget-formatter';
import { logger } from '../../primitives/logger';

// ============================================================
// Input Schema
// ============================================================

const SkillToolInputSchema = z.object({
  skill: z
    .string()
    .min(1)
    .max(50)
    .describe('The skill name to invoke, or "list" to see all available skills'),
  args: z
    .string()
    .optional()
    .describe('Optional arguments for the skill. Will be substituted into $ARGUMENTS placeholders'),
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

function findSkill(skillName: string, skills: readonly Skill[]): Skill | null {
  return skills.find(skill => skill.name === skillName) ?? null;
}

/**
 * 格式化技能指令为工具输出
 *
 * @param skill - 技能数据
 * @param args - 可选参数
 * @returns 格式化后的文本
 */
/**
 * 格式化技能列表输出
 */
function formatSkillListing(skills: readonly Skill[]): string {
  return formatSkillsWithinBudget([...skills], undefined, { alwaysFull: [] });
}

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

  // 添加技能目录树结构
  if (skill.dirTree) {
    // 从 sourcePath 推导技能目录的绝对路径
    const skillDir = skill.sourcePath ? path.dirname(skill.sourcePath) : null;

    lines.push('');
    lines.push('📂 Skill Directory:');
    lines.push('─────────────────────────────────────────────────────────────');
    if (skillDir) {
      lines.push(`📍 Absolute path: ${skillDir}`);
      lines.push('');
    }
    lines.push(skill.dirTree);
    lines.push('─────────────────────────────────────────────────────────────');
    lines.push('');
    lines.push('💡 You can read any file in the directory using the read_file tool.');
  }

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

export function createSkillTool(options: { skills: readonly Skill[] }) {
  return tool({
    description: `Execute or list skills within the main conversation.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- { skill: "list" } - list all available skills with descriptions
- { skill: "docx" } - invoke the docx skill
- { skill: "commit", args: "-m 'Fix bug'" } - invoke with arguments

IMPORTANT:
- Use the FULL skill name exactly as returned from skill: "list" (including any namespace prefix before the colon)
- To see available skills, call skill: "list" first
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <skill> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again

Matching Guide:
- First call skill: "list" to see what's available, then read each skill's description carefully
- Match based on semantic similarity: user intent should align with what the skill describes
- Skills provide pre-built workflows that are more efficient than ad-hoc approaches
- When uncertain, invoke the skill tool to check - it will return the full skill instructions`,

    inputSchema: SkillToolInputSchema,

    execute: async ({ skill, args }) => {
      const trimmedSkill = skill.trim().replace(/^\/+/, '');

      // list 模式：返回所有可用技能的列表
      if (trimmedSkill === 'list') {
        const output = formatSkillListing(options.skills);
        return {
          success: true,
          skillName: 'list',
          _skillOutput: output,
        } as SkillToolResult & { _skillOutput: string };
      }

      logger.debug('SkillTool', `Invoking skill: ${trimmedSkill}${args ? ` with args: ${args}` : ''}`);

      const skillData = findSkill(trimmedSkill, options.skills);

      if (!skillData) {
        return {
          success: false,
          skillName: trimmedSkill,
          allowedTools: [],
          error: `Unknown skill: "${trimmedSkill}". Use skill: "list" to see all available skills.`,
        } as SkillToolResult;
      }

      const output = formatSkillOutput(skillData, args);

      logger.debug('SkillTool', `Skill loaded: ${skillData.name} (${skillData.body?.length || 0} chars)`);
      logger.debug('SkillTool', `Allowed tools: ${skillData.allowedTools?.join(', ') || 'none'}`);

      return {
        success: true,
        skillName: skillData.name,
        skillPath: skillData.sourcePath,
        allowedTools: skillData.allowedTools || [],
        model: skillData.model,
        effort: skillData.effort,
        _skillOutput: output,
      } as SkillToolResult & { _skillOutput: string };
    },

    toModelOutput: ({ output }) => {
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
}
