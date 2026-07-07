/**
 * 命令解析器
 * 区分前端命令和 AI 命令
 */

export type CommandResult = 
  | { type: 'frontend'; command: string; args: string }
  | { type: 'ai'; command: string; args: string }
  | { type: 'none'; text: string };

// 前端命令列表（不发送给 AI，由前端直接处理）
const FRONTEND_COMMANDS = ['agent', 'model', 'mode'];

// AI 命令列表（发送给 AI 处理）
const AI_COMMANDS = ['skill'];

/**
 * 解析用户输入的命令
 */
export function parseCommand(input: string): CommandResult {
  // 空输入或不以 / 开头，不是命令
  if (!input || !input.startsWith('/')) {
    return { type: 'none', text: input };
  }

  // 解析命令和参数
  const withoutSlash = input.slice(1);
  const spaceIndex = withoutSlash.indexOf(' ');
  
  let command: string;
  let args: string;
  
  if (spaceIndex === -1) {
    // 没有参数，如 /agent
    command = withoutSlash;
    args = '';
  } else {
    command = withoutSlash.slice(0, spaceIndex);
    args = withoutSlash.slice(spaceIndex + 1).trim();
  }

  // 检查是否是前端命令
  if (FRONTEND_COMMANDS.includes(command)) {
    return { type: 'frontend', command, args };
  }

  // 检查是否是 AI 命令
  if (AI_COMMANDS.includes(command)) {
    return { type: 'ai', command, args };
  }

  // 未知命令，当作普通消息
  return { type: 'none', text: input };
}

/**
 * 获取命令的显示名称
 */
export function getCommandDisplayName(command: string): string {
  switch (command) {
    case 'agent':
      return 'Agent';
    case 'model':
      return 'Model';
    case 'mode':
      return 'Mode';
    case 'skill':
      return 'Skill';
    default:
      return command;
  }
}

/**
 * 获取前端命令的参数提示
 */
export function getCommandArgsHint(command: string): string {
  switch (command) {
    case 'agent':
      return 'Agent type (e.g., auto, explore, research)';
    case 'model':
      return 'Model type (e.g., default, fast, smart)';
    case 'mode':
      return 'Approval mode (e.g., smart, auto-review, full-trust)';
    case 'skill':
      return 'Skill name and prompt';
    default:
      return '';
  }
}
