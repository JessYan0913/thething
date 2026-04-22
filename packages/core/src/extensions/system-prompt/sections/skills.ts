import type { SystemPromptSection } from "../types";
import type { Skill } from "../../skills/types";

/**
 * 用于显示的 Skill 信息（精简版）
 */
interface SkillDisplayInfo {
  name: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  model?: string;
  sourcePath: string;
}

/**
 * 格式化 Skills 为提示词内容
 */
function formatSkillsContent(skills: SkillDisplayInfo[]): string {
  if (skills.length === 0) return '';

  const sections = skills
    .map((s) => {
      const whenToUse = s.whenToUse ? `\n触发条件: ${s.whenToUse}` : '';
      const tools = s.allowedTools.length > 0 ? `\n可用工具: ${s.allowedTools.join(', ')}` : '';
      const model = s.model ? `\n推荐模型: ${s.model}` : '';
      // 包含源文件路径，方便 Agent 直接读取详细内容
      const sourcePath = `\n源文件: ${s.sourcePath}`;
      return `### ${s.name}\n${s.description}${whenToUse}${tools}${model}${sourcePath}`;
    })
    .join('\n\n');

  return `## 可用技能\n\n以下技能可根据需求自动激活。如需查看完整指令，请读取对应的源文件：\n\n${sections}`;
}

/**
 * 创建 Skills 提示词部分
 *
 * 改造说明：接收已加载的 skills 数据，不再自己调用 loader
 *
 * @param skills 已加载的 Skill 列表
 * @returns SystemPromptSection
 */
export function createSkillsSection(skills: Skill[]): SystemPromptSection {
  if (skills.length === 0) {
    return {
      name: "skills",
      content: null,
      cacheStrategy: "session",
      priority: 5,
    };
  }

  // 使用显示所需的字段，包括 sourcePath
  const displayInfo: SkillDisplayInfo[] = skills.map(s => ({
    name: s.name,
    description: s.description,
    whenToUse: s.whenToUse,
    allowedTools: s.allowedTools,
    model: s.model,
    sourcePath: s.sourcePath,
  }));

  const content = formatSkillsContent(displayInfo);

  return {
    name: "skills",
    content,
    cacheStrategy: "session",
    priority: 5,
  };
}

