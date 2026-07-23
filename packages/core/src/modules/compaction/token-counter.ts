import type { UIMessage, Tool } from "ai";

import { getModelCapabilities } from "../../services/model";

/**
 * 消息是否为 UIMessage(.parts 格式)。ModelMessage 用 .content,无 parts。
 * 通过后可安全按 UIMessage 访问 message.parts。
 */
function hasParts(message: import('ai').ModelMessage): boolean {
  const parts = (message as unknown as Record<string, unknown>).parts;
  return Array.isArray(parts);
}
import {
  countTokens,
  countTokensBatch,
  preloadTokenizer,
  setTokenizerDir,
  tryCountTokensSync,
} from "./tokenizer";
import { getToolOutputString } from './message-utils';

// ============================================================
// 常量
// ============================================================

/** 消息结构开销 tokens（role 标记、格式等） */
const MESSAGE_OVERHEAD_TOKENS = 10;

/** 工具 Schema 相关常量 */
const TOOL_NAME_TOKENS = 4;
const TOOL_SCHEMA_OVERHEAD = 50;
const TOOL_ARRAY_OVERHEAD = 20;

// ============================================================
// 同步估算（仅当 tokenizer 已加载时可用）
// ============================================================

/**
 * 同步估算文本 tokens
 * 仅当 tokenizer 已加载时可用，否则返回 null
 *
 * @param text 要估算的文本
 * @param modelName 可选的模型名称，用于选择对应 tokenizer
 */
export function estimateTextTokensSync(text: string, modelName?: string): number | null {
  return tryCountTokensSync(text, modelName);
}

// ============================================================
// 异步精确估算（主要使用的方法）
// ============================================================

/**
 * 估算文本的 token 数量（异步，精确）
 *
 * @param text 要估算的文本
 * @param modelName 可选的模型名称，用于选择对应 tokenizer
 */
export async function estimateTextTokens(text: string, modelName?: string): Promise<number> {
  return countTokens(text, modelName);
}

/**
 * 估算单条消息的 token 数量（异步）
 *
 * @param message 消息对象
 * @param modelName 可选的模型名称
 */
export async function estimateMessageTokens(message: import('ai').ModelMessage, modelName?: string): Promise<number> {
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  if (!hasParts(message)) {
    // ModelMessage 格式：content 字段可能是内容数组或字符串
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') {
      tokens += await estimateTextTokens(content, modelName);
    } else if (Array.isArray(content)) {
      // ModelMessage 的 content 数组:统计 text / tool-call input / tool-result 三类
      // 见 docs/context-compaction-analysis.md #2
      const textChunks: string[] = [];
      for (const item of content) {
        const c = item as Record<string, unknown>;
        if (c.type === 'text' && typeof c.text === 'string') {
          textChunks.push(c.text);
        } else if (c.type === 'tool-call') {
          const toolName = typeof c.toolName === 'string' ? c.toolName : '';
          if (toolName) textChunks.push(`[tool-call: ${toolName}]`);
          const args = c.args;
          if (args !== undefined && args !== null) {
            try { textChunks.push(JSON.stringify(args)); } catch { /* ignore */ }
          }
        } else if (c.type === 'tool-result' && c.output) {
          const str = getToolOutputString(c.output);
          if (str) textChunks.push(str);
        }
      }
      if (textChunks.length > 0) {
        const tokenCounts = await countTokensBatch(textChunks, modelName);
        tokens += tokenCounts.reduce((sum: number, t: number) => sum + t, 0);
      }
    }
    return tokens;
  }

  // 提取所有文本内容（UIMessage 格式）
  const textParts: string[] = [];
  for (const part of (message as unknown as { parts: any[] }).parts) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else if (part.type === "reasoning") {
      textParts.push(part.text);
    } else if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
      const toolPart = part as Record<string, unknown>;
      const output = toolPart.output as Record<string, unknown> | undefined;
      if (output) {
        textParts.push(JSON.stringify(output));
      }
      const input = toolPart.input as Record<string, unknown> | undefined;
      if (input) {
        textParts.push(JSON.stringify(input));
      }
    }
  }

  // 批量计算（效率更高）
  const tokenCounts = await countTokensBatch(textParts, modelName);
  tokens += tokenCounts.reduce((sum: number, t: number) => sum + t, 0);

  return tokens;
}

/**
 * 估算多条消息的 token 数量（异步）
 *
 * @param messages 消息数组
 * @param modelName 可选的模型名称
 */
export async function estimateMessagesTokens(messages: import('ai').ModelMessage[], modelName?: string): Promise<number> {
  const counts = await Promise.all(
    messages.map(msg => estimateMessageTokens(msg, modelName))
  );
  return counts.reduce((sum: number, t: number) => sum + t, 0);
}

// ============================================================
// 辅助函数
// ============================================================

export function extractMessageText(message: import('ai').ModelMessage): string {
  if (!hasParts(message)) {
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
    // ModelMessage 格式：提取文本和工具结果内容
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const item of content) {
        if (typeof item === 'string') {
          textParts.push(item);
        } else if (item?.type === 'text') {
          textParts.push(item.text ?? '');
        } else if (item?.type === 'tool-result') {
          const str = getToolOutputString(item.output);
          if (str) textParts.push(`[Tool Result: ${str.slice(0, 200)}]`);
        }
      }
      return textParts.join('\n');
    }
    return '';
  }
  return (message as unknown as { parts: any[] }).parts
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => (p.type === "text" || p.type === "reasoning" ? p.text : ""))
    .join("\n");
}

export function hasTextBlocks(message: import('ai').ModelMessage): boolean {
  if (!hasParts(message)) {
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') return content.trim().length > 0;
    if (Array.isArray(content)) {
      return content.some(
        (c: unknown) =>
          (typeof c === 'string' && c.trim().length > 0) ||
          ((c as Record<string, unknown>)?.type === 'text' &&
            typeof (c as Record<string, unknown>)?.text === 'string' &&
            ((c as Record<string, unknown>).text as string).trim().length > 0),
      );
    }
    return false;
  }
  return (message as unknown as { parts: any[] }).parts.some((p) => p.type === "text" && p.text.trim().length > 0);
}

export function stripImagesFromMessages(messages: import('ai').ModelMessage[]): import('ai').ModelMessage[] {
  return messages.map((msg) => {
    // ModelMessage 格式
    if (!hasParts(msg)) {
      const content = (msg as unknown as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        const newContent = content.map((part: unknown) => {
          const p = part as Record<string, unknown>;
          if (p.type === "file" || p.type === "image") {
            return { type: "text" as const, text: "[image]" };
          }
          return part;
        });
        return { ...msg, content: newContent } as import('ai').ModelMessage;
      }
      return msg;
    }
    return {
      ...msg,
      parts: (msg as unknown as { parts: any[] }).parts.map((part) => {
        if ((part as Record<string, unknown>).type === "file" || (part as Record<string, unknown>).type === "image") {
          return { type: "text" as const, text: "[image]" };
        }
        return part;
      }),
    };
  });
}

// ============================================================
// 工具 Token 估算
// ============================================================

/**
 * 估算单个工具定义的 Token 数量（异步）
 *
 * @param tool 工具定义
 * @param modelName 可选的模型名称
 */
export async function estimateToolTokens(tool: Tool, modelName?: string): Promise<number> {
  const nameTokens = TOOL_NAME_TOKENS;
  const descTokens = await estimateTextTokens(typeof tool.description === 'string' ? tool.description : '', modelName);

  let schemaTokens = TOOL_SCHEMA_OVERHEAD;
  try {
    const schema = tool.inputSchema;
    if (schema) {
      const schemaJson = JSON.stringify(schema);
      schemaTokens = await estimateTextTokens(schemaJson, modelName);
    }
  } catch {
    schemaTokens = 200;
  }

  return nameTokens + descTokens + schemaTokens;
}

/**
 * 估算所有工具定义的 Token 数量（异步）
 *
 * @param tools 工具字典
 * @param modelName 可选的模型名称
 */
export async function estimateToolsTokens(tools: Record<string, Tool>, modelName?: string): Promise<number> {
  if (!tools || Object.keys(tools).length === 0) {
    return 0;
  }

  const toolTokens = await Promise.all(
    Object.entries(tools).map(([_, tool]) => estimateToolTokens(tool, modelName))
  );

  let total = toolTokens.reduce((sum: number, t: number) => sum + t, 0);

  const toolNamesJson = JSON.stringify(Object.keys(tools));
  total += await estimateTextTokens(toolNamesJson, modelName);
  total += TOOL_ARRAY_OVERHEAD;

  return total;
}

/**
 * 估算系统提示词的 Token 数量（异步）
 *
 * @param instructions 系统提示词
 * @param modelName 可选的模型名称
 */
export async function estimateInstructionsTokens(instructions: string, modelName?: string): Promise<number> {
  if (!instructions) return 0;
  return estimateTextTokens(instructions, modelName);
}

// ============================================================
// 完整请求 Token 估算
// ============================================================

/**
 * 完整请求估算结果
 */
export interface FullRequestEstimation {
  totalTokens: number;
  messagesTokens: number;
  instructionsTokens: number;
  toolsTokens: number;
  outputReserve: number;
  availableBudget: number;
  modelLimit: number;
  exceedsLimit: boolean;
  utilizationPercent: number;
  tokenizerVersion: string; // 使用的 tokenizer 版本
}

/**
 * 估算完整请求的 Token 数量（异步，精确）
 * 这是预算检查的核心函数
 *
 * @param messages 消息数组
 * @param instructions 系统提示词
 * @param tools 工具字典
 * @param modelName 模型名称（用于选择正确的 tokenizer）
 */
export async function estimateFullRequest(
  messages: import('ai').ModelMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string,
  contextLimitOverride?: number,
): Promise<FullRequestEstimation> {
  const caps = getModelCapabilities(modelName, { contextLimitOverride });

  // 并行计算各部分（使用正确的 tokenizer）
  const [messagesTokens, instructionsTokens, toolsTokens] = await Promise.all([
    estimateMessagesTokens(messages, modelName),
    estimateInstructionsTokens(instructions, modelName),
    estimateToolsTokens(tools, modelName),
  ]);

  const outputReserve = caps.defaultOutputTokens;
  const totalTokens = messagesTokens + instructionsTokens + toolsTokens + outputReserve;
  const modelLimit = caps.contextLimit;
  const availableBudget = modelLimit - totalTokens;
  const exceedsLimit = totalTokens > modelLimit;
  const utilizationPercent = (totalTokens / modelLimit) * 100;

  // 推断使用的 tokenizer 版本
  const tokenizerVersion = inferTokenizerVersion(modelName);

  return {
    totalTokens,
    messagesTokens,
    instructionsTokens,
    toolsTokens,
    outputReserve,
    availableBudget,
    modelLimit,
    exceedsLimit,
    utilizationPercent,
    tokenizerVersion,
  };
}

/**
 * 从模型名称推断 tokenizer repo 信息（用于日志）
 */
function inferTokenizerVersion(_modelName: string): string {
  return 'char-estimation';
}

/**
 * 格式化估算结果为日志字符串
 */
export function formatEstimationResult(estimation: FullRequestEstimation): string {
  const status = estimation.exceedsLimit ? '❌ EXCEEDS' : '✅ OK';
  return `[Budget] ${status} | Total: ${estimation.totalTokens} | ` +
    `Messages: ${estimation.messagesTokens} | ` +
    `Instructions: ${estimation.instructionsTokens} | ` +
    `Tools: ${estimation.toolsTokens} | ` +
    `Output: ${estimation.outputReserve} | ` +
    `Limit: ${estimation.modelLimit} | ` +
    `Tokenizer: ${estimation.tokenizerVersion} | ` +
    `Utilization: ${estimation.utilizationPercent.toFixed(1)}%`;
}

/**
 * 预加载 tokenizer（应用启动时调用）
 * 可指定模型名称，或加载默认版本
 */
export { preloadTokenizer, setTokenizerDir };