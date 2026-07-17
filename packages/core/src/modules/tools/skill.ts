// ============================================================
// Skill Tool - 技能调用工具
// ============================================================
//
// Agent 通过此工具获取指定技能的完整 body + 目录树。
// 技能名称和描述通过 System Prompt 的 "Available Skills" section 展示，
// 模型侧看到匹配的 skill name 后，通过本工具按需加载完整指令。
//
// 设计原则：渐进式披露（Progressive Disclosure）
//   Layer 1: 系统提示中展示技能名称+截断描述（预算控制）
//   Layer 2: 调用本工具加载完整 body（按需获取）
//   Layer 3: 执行时按需读取附属文件
//
// 子 Agent 通过继承 parentTools 自动获得本工具，无需额外注入。

import { tool } from 'ai';
import { z } from 'zod';
import * as path from 'path';
import type { Skill } from '../../modules/skills/types';
import { generateSkillDirTree, readSkillBody } from '../../modules/skills/loader';
import { logger } from '../../primitives/logger';

// ============================================================
// Input Schema
// ============================================================

const SkillToolInputSchema = z.object({
  skill: z
    .string()
    .min(1)
    .max(50)
    .describe('The exact skill name to invoke'),
  args: z
    .string()
    .optional()
    .describe('Optional arguments. Substituted into $ARGUMENTS placeholders in the skill body'),
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
 */
function formatSkillOutput(skill: Skill, dirTree: string | undefined, args?: string): string {
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
  if (dirTree) {
    // 从 sourcePath 推导技能目录的绝对路径
    const skillDir = skill.sourcePath ? path.dirname(skill.sourcePath) : null;

    lines.push('');
    lines.push('📂 Skill Directory:');
    lines.push('─────────────────────────────────────────────────────────────');
    if (skillDir) {
      lines.push(`📍 Absolute path: ${skillDir}`);
      lines.push('');
    }
    lines.push(dirTree);
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
    description: `Invoke a skill by its exact name. Use when the Available Skills section in the system prompt lists a skill matching the user's request.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- { skill: "docx" } - invoke the docx skill
- { skill: "commit", args: "-m 'Fix bug'" } - invoke with arguments

IMPORTANT:
- When a skill matches the user's request, invoke it BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <skill> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again

Matching Guide:
- Match based on semantic similarity: user intent should align with what a skill describes
- Skills provide pre-built workflows that are more efficient than ad-hoc approaches
- When the system prompt shows an "Available Skills" section, any skill listed there can be invoked by name`,

    inputSchema: SkillToolInputSchema,

    execute: async ({ skill, args }) => {
      const trimmedSkill = skill.trim().replace(/^\/+/, '');

      logger.debug('SkillTool', `Invoking skill: ${trimmedSkill}${args ? ` with args: ${args}` : ''}`);

      const skillData = findSkill(trimmedSkill, options.skills);

      if (!skillData) {
        return {
          success: false,
          skillName: trimmedSkill,
          allowedTools: [],
          error: `Unknown skill: "${trimmedSkill}". Check the Available Skills section in the system prompt for valid skill names.`,
        } as SkillToolResult;
      }

      // 两阶段加载：当 body 不存在时从文件读取
      if (!skillData.body && skillData.sourcePath) {
        skillData.body = await readSkillBody(skillData.sourcePath);
      }

      // 按需生成技能目录树（仅当被调用时）
      let dirTree: string | undefined;
      if (skillData.sourcePath) {
        dirTree = await generateSkillDirTree(path.dirname(skillData.sourcePath));
      }

      const output = formatSkillOutput(skillData, dirTree, args);

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
