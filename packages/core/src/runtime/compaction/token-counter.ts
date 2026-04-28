import type { UIMessage, Tool } from "ai";
import { getModelCapabilities } from "../../foundation/model";
import {
  countTokens,
  countTokensBatch,
  preloadTokenizer,
  setTokenizerDir,
  tryCountTokensSync,
} from "./tokenizer";

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
export async function estimateMessageTokens(message: UIMessage, modelName?: string): Promise<number> {
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') {
      tokens += await estimateTextTokens(content, modelName);
    }
    return tokens;
  }

  // 提取所有文本内容
  const textParts: string[] = [];
  for (const part of message.parts) {
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
export async function estimateMessagesTokens(messages: UIMessage[], modelName?: string): Promise<number> {
  const counts = await Promise.all(
    messages.map(msg => estimateMessageTokens(msg, modelName))
  );
  return counts.reduce((sum: number, t: number) => sum + t, 0);
}

// ============================================================
// 辅助函数
// ============================================================

export function extractMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    return typeof content === 'string' ? content : '';
  }
  return message.parts
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => (p.type === "text" || p.type === "reasoning" ? p.text : ""))
    .join("\n");
}

export function hasTextBlocks(message: UIMessage): boolean {
  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    return typeof content === 'string' && content.trim().length > 0;
  }
  return message.parts.some((p) => p.type === "text" && p.text.trim().length > 0);
}

export function stripImagesFromMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: (msg.parts || []).map((part) => {
      if ((part as Record<string, unknown>).type === "file" || (part as Record<string, unknown>).type === "image") {
        return { type: "text" as const, text: "[image]" };
      }
      return part;
    }),
  }));
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
  const descTokens = await estimateTextTokens(tool.description || '', modelName);

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
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string
): Promise<FullRequestEstimation> {
  const caps = getModelCapabilities(modelName);

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
 * 从模型名称推断 tokenizer 版本
 */
function inferTokenizerVersion(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized.startsWith("qwen3.5") || normalized.includes("qwen-max") || normalized.includes("qwen3")) {
    return "qwen3.5";
  }
  return "qwen2.5";
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