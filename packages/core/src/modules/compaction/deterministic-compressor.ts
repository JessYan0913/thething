// ============================================================
// Deterministic Compressor - 确定性文本压缩（Layer 2.5 策略）
// ============================================================
// 当 Layer 2（工具输出压缩）无法满足预算时的降级方案。
// 不调用 LLM，100% 可靠，速度快（< 50ms）。
//
// 策略：
// 1. 保留首条 user 消息（任务目标）
// 2. 保留最后 N 条消息（当前上下文）
// 3. 中间消息组织信息：文件路径、命令、错误 + 真实文本按序摘录。
//    C9：不替 LLM 判断"哪些语句是决策"，只组织客观信息结构。
//
// 仅被 lifecycle.ts 的 applyEmergencyCompression 内部使用，不对外导出。
//
// 设计约束：
// - 不依赖外部服务
// - 不修改消息语义（只是"省略"而非"改写"）
// - 保证压缩后的消息总是小于目标 tokens

import { buildSummaryMessage } from './message-view';
import { estimateMessagesTokens } from './token-counter';
import { extractActionLog } from './action-log';
import { logger } from '../../primitives/logger';

/**
 * 确定性文本压缩结果
 */
export interface DeterministicCompressionResult {
  messages: import('ai').ModelMessage[];
  tokensFreed: number;
  messagesKept: number;
  messagesCompressed: number;
}

/**
 * 确定性文本压缩：不调用 LLM，100% 可靠
 */
export async function compressMessagesDeterministic(
  messages: import('ai').ModelMessage[],
  targetTokens: number,
  modelName: string,
): Promise<DeterministicCompressionResult> {
  if (messages.length === 0) {
    return { messages: [], tokensFreed: 0, messagesKept: 0, messagesCompressed: 0 };
  }

  const firstUserIndex = messages.findIndex((m) => m.role === 'user');
  if (firstUserIndex < 0) {
    return { messages, tokensFreed: 0, messagesKept: messages.length, messagesCompressed: 0 };
  }

  const firstUserMsg = messages[firstUserIndex];

  const minKeepRatio = 0.2;
  const maxKeepCount = 15;
  const recentCount = Math.min(maxKeepCount, Math.max(3, Math.floor(messages.length * minKeepRatio)));
  const recentMessages = messages.slice(-recentCount);

  const middleStart = firstUserIndex + 1;
  const middleEnd = messages.length - recentCount;

  if (middleEnd <= middleStart) {
    logger.debug('DeterministicCompressor', '消息太少，无需压缩');
    return { messages, tokensFreed: 0, messagesKept: messages.length, messagesCompressed: 0 };
  }

  const middleMessages = messages.slice(middleStart, middleEnd);
  const keyInfo = await extractKeyInformation(middleMessages);

  const summaryText = formatSummary(keyInfo, middleMessages.length);
  const summaryMessage = buildSummaryMessage(summaryText, 'ui') as import('ai').ModelMessage;

  const compressedMessages = [firstUserMsg, summaryMessage, ...recentMessages];

  const originalTokens = await estimateMessagesTokens(messages, modelName);
  const compressedTokens = await estimateMessagesTokens(compressedMessages, modelName);
  const tokensFreed = Math.max(0, originalTokens - compressedTokens);

  logger.info('DeterministicCompressor', `确定性压缩: ${messages.length} → ${compressedMessages.length} 条消息, 释放 ${tokensFreed} tokens`);

  return { messages: compressedMessages, tokensFreed, messagesKept: compressedMessages.length, messagesCompressed: middleMessages.length };
}

// ============================================================
// Internal helpers
// ============================================================

interface KeyInformation {
  files: Set<string>;
  commands: string[];
  errors: string[];
  /** 中间消息的非 tool 文本摘录（按时间顺序），系统只组织不判断"哪些是决策" */
  excerpts: string[];
}

async function extractKeyInformation(messages: import('ai').ModelMessage[]): Promise<KeyInformation> {
  const info: KeyInformation = { files: new Set<string>(), commands: [], errors: [], excerpts: [] };

  const entries = extractActionLog(messages);
  const filePathPattern = /[\w\/\-\.]+\.(ts|tsx|js|jsx|py|md|json|yml|yaml|toml|lock|html|css|scss|vue|go|rs|java|kt|swift|c|cpp|h|hpp|sh|bash|ps1|txt|log|env|config|xml|sql|proto|graphql)/gi;
  const urlPattern = /https?:\/\/[^\s"'`)]+/gi;

  for (const e of entries) {
    if (e.kind === 'tool') {
      const inputStr = e.input !== undefined && e.input !== null ? safeStringify(e.input) : '';
      let m: RegExpMatchArray | null;
      while ((m = filePathPattern.exec(inputStr)) !== null) info.files.add(m[0]);
      while ((m = urlPattern.exec(inputStr)) !== null) info.files.add(m[0]);
      if (e.toolName === 'bash' || e.toolName === 'Bash') {
        const cmd = (e.input as Record<string, unknown> | null)?.command;
        if (typeof cmd === 'string') info.commands.push(cmd.slice(0, 150));
      }
      if (e.isError) {
        info.errors.push((e.outputRaw ?? '').slice(0, 200).trim());
      }
      if (e.outputRaw) {
        while ((m = filePathPattern.exec(e.outputRaw)) !== null) info.files.add(m[0]);
      }
      continue;
    }

    const text = (e.text ?? '').trim();
    if (text) {
      // C9：不再用正则抽取"决策"关键词（那是系统替 LLM 判断哪些语句重要）。
      // 改为组织结构化摘录，保留真实文本由 LLM 自行判断。
      let fm: RegExpMatchArray | null;
      while ((fm = filePathPattern.exec(text)) !== null) info.files.add(fm[0]);
      info.excerpts.push(text.slice(0, 200));
    }
  }
  // 截断摘录条数，保持 O(1) 摘要规模（护栏，非筛选）
  info.excerpts = info.excerpts.slice(0, 8);

  return info;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function formatSummary(info: KeyInformation, messageCount: number): string {
  const parts: string[] = [];

  parts.push(`[已压缩 ${messageCount} 条历史消息]`);
  parts.push('');

  if (info.files.size > 0) {
    const fileList = [...info.files].slice(0, 20);
    const more = info.files.size > 20 ? ` 等 ${info.files.size} 个文件` : '';
    parts.push(`涉及文件: ${fileList.join(', ')}${more}`);
  }

  if (info.commands.length > 0) {
    parts.push(`执行命令: ${info.commands.length} 条`);
    info.commands.slice(0, 3).forEach((cmd) => { parts.push(`  - ${cmd}`); });
  }

  if (info.excerpts.length > 0) {
    parts.push('对话摘录:');
    info.excerpts.slice(0, 5).forEach((ex) => { parts.push(`  - ${ex}`); });
  }

  if (info.errors.length > 0) {
    parts.push('遇到错误:');
    info.errors.slice(0, 3).forEach((err) => { parts.push(`  - ${err}`); });
  }

  if (parts.length === 2) {
    parts.push('（历史对话内容已省略）');
  }

  return parts.join('\n');
}
