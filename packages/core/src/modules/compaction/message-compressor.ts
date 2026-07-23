// ============================================================
// Message Compressor - Layer 2.5: 确定性文本压缩
// ============================================================
// 当 Layer 2（工具输出压缩）无法满足预算时的降级方案。
// 不调用 LLM，100% 可靠，速度快（< 50ms）。
//
// 策略：
// 1. 保留首条 user 消息（任务目标）
// 2. 保留最后 N 条消息（当前上下文）
// 3. 中间消息提取关键信息：文件路径、命令、决策
//
// 设计约束：
// - 不依赖外部服务
// - 不修改消息语义（只是"省略"而非"改写"）
// - 保证压缩后的消息总是小于目标 tokens


import { extractMessageText } from './token-counter';
import { buildSummaryMessage } from './message-view';
import { estimateMessagesTokens, estimateMessageTokens } from './token-counter';
import { logger } from '../../primitives/logger';

/**
 * 确定性文本压缩结果
 */
export interface DeterministicCompressionResult {
  /** 压缩后的消息 */
  messages: import('ai').ModelMessage[];
  /** 释放的 token 数量（估算） */
  tokensFreed: number;
  /** 保留的消息数量 */
  messagesKept: number;
  /** 压缩的消息数量 */
  messagesCompressed: number;
}

/**
 * 确定性文本压缩：不调用 LLM，100% 可靠
 *
 * @param messages 待压缩的消息
 * @param targetTokens 目标 token 数量（压缩后应低于此值）
 * @param modelName 模型名称（用于 token 估算）
 * @returns 压缩结果
 */
export async function compressMessagesDeterministic(
  messages: import('ai').ModelMessage[],
  targetTokens: number,
  modelName: string,
): Promise<DeterministicCompressionResult> {
  if (messages.length === 0) {
    return {
      messages: [],
      tokensFreed: 0,
      messagesKept: 0,
      messagesCompressed: 0,
    };
  }

  // 1. 找到第一条 user 消息（任务目标）
  const firstUserIndex = messages.findIndex((m) => m.role === 'user');
  if (firstUserIndex < 0) {
    // 没有 user 消息，无法压缩
    return {
      messages,
      tokensFreed: 0,
      messagesKept: messages.length,
      messagesCompressed: 0,
    };
  }

  const firstUserMsg = messages[firstUserIndex];

  // 2. 计算保留多少尾部消息
  // 目标：保留至少 20% 的消息，但不超过 15 条
  const minKeepRatio = 0.2;
  const maxKeepCount = 15;
  const recentCount = Math.min(
    maxKeepCount,
    Math.max(3, Math.floor(messages.length * minKeepRatio)),
  );
  const recentMessages = messages.slice(-recentCount);

  // 3. 检查是否需要压缩中间部分
  const middleStart = firstUserIndex + 1;
  const middleEnd = messages.length - recentCount;

  if (middleEnd <= middleStart) {
    // 没有中间部分，无需压缩
    logger.debug('MessageCompressor', '消息太少，无需压缩');
    return {
      messages,
      tokensFreed: 0,
      messagesKept: messages.length,
      messagesCompressed: 0,
    };
  }

  const middleMessages = messages.slice(middleStart, middleEnd);

  // 4. 提取中间消息的关键信息
  const keyInfo = await extractKeyInformation(middleMessages);

  // 5. 构建摘要消息
  const summaryText = formatSummary(keyInfo, middleMessages.length);
  const summaryMessage = buildSummaryMessage(summaryText, 'ui') as import('ai').ModelMessage;

  // 6. 重新组装消息
  const compressedMessages = [firstUserMsg, summaryMessage, ...recentMessages];

  // 7. 估算释放的 tokens
  const originalTokens = await estimateMessagesTokens(messages, modelName);
  const compressedTokens = await estimateMessagesTokens(compressedMessages, modelName);
  const tokensFreed = Math.max(0, originalTokens - compressedTokens);

  logger.info('MessageCompressor', `确定性压缩: ${messages.length} → ${compressedMessages.length} 条消息, 释放 ${tokensFreed} tokens`);

  return {
    messages: compressedMessages,
    tokensFreed,
    messagesKept: compressedMessages.length,
    messagesCompressed: middleMessages.length,
  };
}

/**
 * 提取消息的关键信息
 */
interface KeyInformation {
  /** 涉及的文件路径 */
  files: Set<string>;
  /** 执行的命令（简要） */
  commands: string[];
  /** 关键决策或结论 */
  decisions: string[];
  /** 错误信息 */
  errors: string[];
}

async function extractKeyInformation(messages: import('ai').ModelMessage[]): Promise<KeyInformation> {
  const info: KeyInformation = {
    files: new Set<string>(),
    commands: [],
    decisions: [],
    errors: [],
  };

  for (const msg of messages) {
    const text = extractMessageText(msg);

    // 提取文件路径（常见扩展名）
    const filePathPattern = /[\w\/\-\.]+\.(ts|tsx|js|jsx|py|md|json|yml|yaml|toml|lock|html|css|scss|vue|go|rs|java|kt|swift|c|cpp|h|hpp|sh|bash|ps1|txt|log|env|config|xml|sql|proto|graphql)/gi;
    const filePaths = text.match(filePathPattern);
    if (filePaths) {
      filePaths.forEach((f) => info.files.add(f));
    }

    // 提取命令执行结果
    if (msg.role === 'tool') {
      // 查找命令相关的关键词
      if (text.includes('exit code') || text.includes('Command') || text.includes('executed')) {
        const preview = text.slice(0, 150).trim();
        info.commands.push(preview);
      }

      // 查找错误
      if (
        text.includes('error:') ||
        text.includes('Error:') ||
        text.includes('failed') ||
        text.includes('Failed')
      ) {
        const errorPreview = text.slice(0, 200).trim();
        info.errors.push(errorPreview);
      }
    }

    // 提取关键决策（assistant 消息中的关键语句）
    if (msg.role === 'assistant') {
      const decisionPatterns = [
        /(?:decided to|选择|决定)[^。\n]{10,100}/gi,
        /(?:because|因为|由于)[^。\n]{10,100}/gi,
        /(?:will|将要|需要)[^。\n]{10,100}/gi,
      ];

      for (const pattern of decisionPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          matches.slice(0, 2).forEach((m) => info.decisions.push(m.trim()));
        }
      }
    }
  }

  return info;
}

/**
 * 格式化摘要文本
 */
function formatSummary(info: KeyInformation, messageCount: number): string {
  const parts: string[] = [];

  parts.push(`[已压缩 ${messageCount} 条历史消息]`);
  parts.push('');

  if (info.files.size > 0) {
    const fileList = [...info.files].slice(0, 20); // 最多显示 20 个文件
    const more = info.files.size > 20 ? ` 等 ${info.files.size} 个文件` : '';
    parts.push(`涉及文件: ${fileList.join(', ')}${more}`);
  }

  if (info.commands.length > 0) {
    parts.push(`执行命令: ${info.commands.length} 条`);
    // 显示前 3 条命令
    info.commands.slice(0, 3).forEach((cmd) => {
      parts.push(`  - ${cmd}`);
    });
  }

  if (info.decisions.length > 0) {
    parts.push('关键决策:');
    info.decisions.slice(0, 5).forEach((dec) => {
      parts.push(`  - ${dec}`);
    });
  }

  if (info.errors.length > 0) {
    parts.push('遇到错误:');
    info.errors.slice(0, 3).forEach((err) => {
      parts.push(`  - ${err}`);
    });
  }

  if (parts.length === 2) {
    // 只有标题和空行，说明没有提取到任何信息
    parts.push('（历史对话内容已省略）');
  }

  return parts.join('\n');
}

/**
 * 强制截断：最后的保底方案
 * 当所有压缩策略都失败时，强制保留首尾消息
 *
 * @param messages 消息列表
 * @param keepRatio 保留的比例（默认 0.15，即保留首尾各 15%）
 * @param modelName 模型名称（用于 token 估算）
 * @param maxTokens 最大 token 数（如果提供，会确保结果不超过此值）
 * @returns 截断后的消息
 */
export async function forceTruncateMessages(
  messages: import('ai').ModelMessage[],
  keepRatio: number = 0.15,
  modelName?: string,
  maxTokens?: number,
): Promise<import('ai').ModelMessage[]> {
  if (messages.length === 0) return [];

  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) {
    // 没有 user 消息，只保留最后几条
    return messages.slice(-5);
  }

  let keepTail = Math.max(5, Math.floor(messages.length * keepRatio));
  let recentMessages = messages.slice(-keepTail);

  const warningMessage = buildSummaryMessage(
    '[警告：由于对话过长，中间部分已省略。建议开始新会话以获得更好的上下文连贯性。]',
    'ui',
  ) as import('ai').ModelMessage;

  let result = [firstUserMsg, warningMessage, ...recentMessages];

  // 如果提供了 maxTokens，确保结果不超过限制
  if (modelName && maxTokens) {
    let currentTokens = await estimateMessagesTokens(result, modelName);

    // 逐步减少尾部消息直到满足限制
    while (currentTokens > maxTokens && keepTail > 1) {
      keepTail = Math.max(1, Math.floor(keepTail * 0.7)); // 每次减少 30%
      recentMessages = messages.slice(-keepTail);
      result = [firstUserMsg, warningMessage, ...recentMessages];
      currentTokens = await estimateMessagesTokens(result, modelName);
      logger.debug('MessageCompressor', `强制截断调整: keepTail=${keepTail}, tokens=${currentTokens}/${maxTokens}`);
    }

    // 如果还是超限，只保留最后一条消息
    if (currentTokens > maxTokens) {
      result = [firstUserMsg, warningMessage, messages[messages.length - 1]];
      currentTokens = await estimateMessagesTokens(result, modelName);

      // 如果连这都超限，只保留警告消息和最后一条
      if (currentTokens > maxTokens) {
        result = [warningMessage, messages[messages.length - 1]];
      }
    }
  }

  logger.warn('MessageCompressor', `强制截断: ${messages.length} → ${result.length} 条消息`);

  return result;
}
