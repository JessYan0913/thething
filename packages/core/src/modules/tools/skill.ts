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
import type { Skill, SkillEffort } from '../../modules/skills/types';
import type { SessionState } from '../../modules/session/types';
import type { ModelAliases } from '../../services/model';
import type { AgentExecutionResult, AgentToolConfig } from '../../modules/agent/types';
import { resolveModelAlias, isInheritAlias } from '../../services/model/alias';
import { executeAgentTask } from '../../modules/agent/agent-tool';
import { generateSkillDirTree, readSkillBody } from '../../modules/skills/loader';
import { recordSkillUsage } from '../../modules/skills/usage';
import { logger } from '../../primitives/logger';

// ============================================================
// Input Schema
// ============================================================

const SkillToolInputSchema = z.object({
  skill: z
    .string()
    .min(1)
    .max(64)
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
  effort?: SkillEffort;
  forked?: boolean;
  background?: boolean;
  summary?: string;
  error?: string;
}

function findSkill(skillName: string, skills: readonly Skill[]): Skill | null {
  return skills.find(skill => skill.name === skillName) ?? null;
}

function resolveSkillModelOverride(
  model: string | undefined,
  aliases: ModelAliases | undefined,
  availableModels: readonly string[],
): string | undefined {
  // inherit/smart/default 均跟随会话主模型,不产生覆盖(见 alias.ts 语义收敛)
  if (isInheritAlias(model)) return undefined;

  const resolved = resolveModelAlias(model!, aliases);
  if (availableModels.length > 0 && !availableModels.includes(resolved)) {
    logger.debug('SkillTool', `Ignoring unavailable model override: ${resolved}`);
    return undefined;
  }

  return resolved;
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

  // 如果有 paths 配置，展示输出目录（可选落点，由 LLM 判断是否采用）
  if (skill.paths && skill.paths.length > 0) {
    lines.push(`📁 Output directories available for this skill: ${skill.paths.join(', ')}`);
    lines.push(`   → These are suggested output locations. You may consider saving generated files to one of them; whether to do so, and where to place output, is your judgment call.`);
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
  lines.push('⚠️ IMPORTANT: The instructions above tell you WHAT to do.');
  lines.push('→ Use bash, write_file, read_file and other tools to EXECUTE each step.');
  lines.push('→ Do NOT call the skill tool again for the same skill — that only re-loads the same instructions.');

  return lines.join('\n');
}

// ============================================================
// Skill Tool 定义
// ============================================================

export function createSkillTool(options: {
  skills: readonly Skill[];
  /** 未命中时从磁盘重扫（让会话中途新建的技能立即可用）。不传则不重扫。 */
  reloadSkills?: () => Promise<readonly Skill[]>;
  /** 请求内会话状态，用于记录仅在当前用户 turn 生效的 Skill 覆盖。 */
  sessionState?: Pick<SessionState, 'skillTurnOverride'>;
  modelAliases?: ModelAliases;
  /** 解析后的模型 ID 白名单。空数组表示没有显式限制。 */
  availableModels?: readonly string[];
  /** fork Skill 复用现有子代理执行器。 */
  agentConfig?: AgentToolConfig;
  /** 测试或替代运行时可注入相同契约的 fork 执行器。 */
  executeFork?: typeof executeAgentTask;
  /** 禁用技能名列表：快照命中与 reload 命中都拒绝加载。 */
  disabledSkills?: readonly string[];
  /** 使用统计目录（<dataDir>）。提供时成功加载后记一笔（内部容错）。 */
  usageDataDir?: string;
}) {
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

    execute: async ({ skill, args }, executionOptions) => {
      const trimmedSkill = skill.trim().replace(/^\/+/, '');

      logger.debug('SkillTool', `Invoking skill: ${trimmedSkill}${args ? ` with args: ${args}` : ''}`);

      // disabled 检查先于查找，同时覆盖快照命中与 reload 命中两条路径
      if (options.disabledSkills?.includes(trimmedSkill)) {
        return {
          success: false,
          skillName: trimmedSkill,
          allowedTools: [],
          error: `Skill "${trimmedSkill}" is disabled in user preferences. To re-enable it, remove it from the skills.disabled list in ~/.thething/preferences.json.`,
        } as SkillToolResult;
      }

      let skillData = findSkill(trimmedSkill, options.skills);

      // 未命中且提供了 reload -> 从磁盘重扫，让会话中途新建的技能立即可用
      if (!skillData && options.reloadSkills) {
        try {
          const fresh = await options.reloadSkills();
          skillData = findSkill(trimmedSkill, fresh);
          if (skillData) {
            logger.debug('SkillTool', `Reloaded skills from disk, found "${trimmedSkill}"`);
          }
        } catch (err) {
          logger.warn('SkillTool', `Skill reload failed: ${err}`);
        }
      }

      if (!skillData) {
        return {
          success: false,
          skillName: trimmedSkill,
          allowedTools: [],
          error: `Unknown skill: "${trimmedSkill}". Check the Available Skills section in the system prompt for valid skill names.\n\nIf you intended to CREATE a new skill, invoke the "create-skill" skill instead — it guides you to write a SKILL.md under ~/.thething/skills/<name>/. Note: writing a script file (e.g. .py) or saving a page to the Wiki does NOT register a slash-command skill; only a SKILL.md in the skills config directory is recognized.`,
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

      // 使用统计：成功加载即记一笔（内部容错，失败仅 debug 日志）
      if (options.usageDataDir) {
        await recordSkillUsage(options.usageDataDir, skillData.name);
      }

      if (skillData.context === 'fork') {
        if (skillData.background !== false) {
          return {
            success: false,
            skillName: skillData.name,
            skillPath: skillData.sourcePath,
            allowedTools: skillData.allowedTools || [],
            forked: true,
            background: true,
            error: 'Background fork execution is not available yet because no persistent run handle exists. Set background: false to run this forked skill synchronously.',
          } as SkillToolResult;
        }
        if (!options.agentConfig) {
          return {
            success: false,
            skillName: skillData.name,
            skillPath: skillData.sourcePath,
            allowedTools: skillData.allowedTools || [],
            forked: true,
            background: false,
            error: 'Fork execution is unavailable in this runtime.',
          } as SkillToolResult;
        }

        const result: AgentExecutionResult = await (options.executeFork ?? executeAgentTask)({
          agentType: skillData.agent,
          task: output,
          config: options.agentConfig,
          toolCallId: executionOptions.toolCallId ?? `skill-${Date.now()}`,
          abortSignal: executionOptions.abortSignal,
          includeParentMessages: false,
          modelOverride: resolveSkillModelOverride(
            skillData.model,
            options.modelAliases,
            options.availableModels ?? [],
          ),
        });
        return {
          success: result.success,
          skillName: skillData.name,
          skillPath: skillData.sourcePath,
          allowedTools: skillData.allowedTools || [],
          model: skillData.model,
          effort: skillData.effort,
          forked: true,
          background: false,
          summary: result.summary,
          error: result.error,
        } as SkillToolResult;
      }

      if (options.sessionState) {
        const model = resolveSkillModelOverride(
          skillData.model,
          options.modelAliases,
          options.availableModels ?? [],
        );
        if (model || skillData.effort) {
          options.sessionState.skillTurnOverride = {
            skillName: skillData.name,
            model,
            effort: skillData.effort,
          };
        }
      }

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
        if (result.success && result.forked && result.summary) {
          return { type: 'text' as const, value: result.summary };
        }
        if (!result.success && result.error) {
          return { type: 'text' as const, value: `❌ ${result.error}` };
        }
      }
      return { type: 'text' as const, value: 'Skill invocation completed.' };
    },
  });
}
