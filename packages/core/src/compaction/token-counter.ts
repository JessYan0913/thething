import type { UIMessage, Tool } from "ai";
import { getModelCapabilities } from "../model-capabilities";

const CHARS_PER_TOKEN_AVG = 3.5;
const MESSAGE_OVERHEAD_TOKENS = 4;

// 工具 Schema 相关常量
const TOOL_NAME_TOKENS = 4;  // 工具名通常很短
const TOOL_SCHEMA_OVERHEAD = 50;  // 每个 tool_use 的结构开销
const TOOL_ARRAY_OVERHEAD = 20;  // tool_choice + tools 数组结构

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_AVG);
}

export function estimateMessageTokens(message: UIMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  if (!message.parts || !Array.isArray(message.parts)) {
    const content = (message as unknown as Record<string, unknown>).content;
    if (typeof content === 'string') {
      tokens += estimateTextTokens(content);
    }
    return tokens;
  }

  for (const part of message.parts) {
    if (part.type === "text") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type === "reasoning") {
      tokens += estimateTextTokens(part.text);
    } else if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
      const toolPart = part as Record<string, unknown>;
      const output = toolPart.output as Record<string, unknown> | undefined;
      if (output) {
        const outputJson = JSON.stringify(output);
        tokens += estimateTextTokens(outputJson);
      }
      const input = toolPart.input as Record<string, unknown> | undefined;
      if (input) {
        const inputJson = JSON.stringify(input);
        tokens += estimateTextTokens(inputJson);
      }
    }
  }

  return tokens;
}

export function estimateMessagesTokens(messages: UIMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

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
// 参考 ClaudeCode: tool_use 序列化 name + JSON.stringify(input) 后 / 4
// ============================================================

/**
 * 估算单个工具定义的 Token 数量
 */
export function estimateToolTokens(tool: Tool): number {
  // 1. 工具名称
  const nameTokens = TOOL_NAME_TOKENS;

  // 2. 工具描述（description 字段）
  const descTokens = estimateTextTokens(tool.description || '');

  // 3. Input Schema (JSON Schema → JSON string → tokens)
  let schemaTokens = TOOL_SCHEMA_OVERHEAD;
  try {
    const schema = tool.inputSchema;
    if (schema) {
      // Zod schema 或 JSON Schema，序列化后估算
      const schemaJson = JSON.stringify(schema);
      // JSON 密集格式（大量 {, :, , 符号），每 token 仅 1-2 字符
      schemaTokens = Math.ceil(schemaJson.length / 2);
    }
  } catch {
    // 序列化失败时使用保守估计
    schemaTokens = 200;
  }

  return nameTokens + descTokens + schemaTokens;
}

/**
 * 估算所有工具定义的 Token 数量
 * 包括工具数组结构和 tool_choice 的开销
 */
export function estimateToolsTokens(tools: Record<string, Tool>): number {
  if (!tools || Object.keys(tools).length === 0) {
    return 0;
  }

  let total = 0;

  // 估算每个工具
  for (const [toolName, tool] of Object.entries(tools)) {
    total += estimateToolTokens(tool);
  }

  // 加上工具名数组（发送给 API 的工具列表）
  const toolNamesJson = JSON.stringify(Object.keys(tools));
  const arrayOverhead = Math.ceil(toolNamesJson.length / 4);

  // 加上 tool_choice 和 tools 数组的 JSON 结构开销
  return total + arrayOverhead + TOOL_ARRAY_OVERHEAD;
}

/**
 * 估算系统提示词的 Token 数量
 */
export function estimateInstructionsTokens(instructions: string): number {
  if (!instructions) return 0;
  return estimateTextTokens(instructions);
}

// ============================================================
// 完整请求 Token 估算
// ============================================================

/**
 * 完整请求估算结果
 */
export interface FullRequestEstimation {
  /** 总 Token 数 */
  totalTokens: number;
  /** 消息 Token 数 */
  messagesTokens: number;
  /** 系统提示词 Token 数 */
  instructionsTokens: number;
  /** 工具定义 Token 数 */
  toolsTokens: number;
  /** 输出预留 Token 数 */
  outputReserve: number;
  /** 可用预算（剩余空间） */
  availableBudget: number;
  /** 模型上下文限制 */
  modelLimit: number;
  /** 是否超出限制 */
  exceedsLimit: boolean;
  /** 使用率百分比 */
  utilizationPercent: number;
}

/**
 * 估算完整请求的 Token 数量
 * 这是预算检查的核心函数
 */
export function estimateFullRequest(
  messages: UIMessage[],
  instructions: string,
  tools: Record<string, Tool>,
  modelName: string
): FullRequestEstimation {
  const caps = getModelCapabilities(modelName);

  // 计算各部分 token
  const messagesTokens = estimateMessagesTokens(messages);
  const instructionsTokens = estimateInstructionsTokens(instructions);
  const toolsTokens = estimateToolsTokens(tools);
  const outputReserve = caps.defaultOutputTokens;

  // 总计
  const totalTokens = messagesTokens + instructionsTokens + toolsTokens + outputReserve;
  const modelLimit = caps.contextLimit;
  const availableBudget = modelLimit - totalTokens;
  const exceedsLimit = totalTokens > modelLimit;
  const utilizationPercent = (totalTokens / modelLimit) * 100;

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
  };
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
    `Utilization: ${estimation.utilizationPercent.toFixed(1)}%`;
}
