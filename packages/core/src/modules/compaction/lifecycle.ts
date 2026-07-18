// ============================================================
// Compaction - Layer 2: Tool Output Lifecycle Management
// ============================================================
// 核心创新：每步 API 调用前，自动将旧工具输出替换为结构化元信息。
// 同步执行，微秒级，不调用 LLM。
//
// 流水线传递的是 ModelMessage 格式（AI SDK 内部格式），
// 工具结果位于 .content 数组中，类型为 tool-result。

import type { UIMessage } from 'ai';
import {
  type LifecycleConfig,
  type CompactedToolResult,
  DEFAULT_LIFECYCLE_CONFIG,
  DEFAULT_COMPACTABLE,
} from './types';
import { getToolOutputString, unwrapOutput } from './message-utils';

// ============================================================
// Main Function
// ============================================================

/**
 * 工具输出生命周期管理（Layer 2）
 *
 * 在每步 API 调用前同步执行：
 * - 保留最近 N 轮的工具输出
 * - 超出 N 轮的旧工具输出 → 替换为结构化元信息
 * - 超大工具输出（即使在最近 N 轮内）→ 也压缩
 *
 * @returns 替换后的消息和释放的 token 数
 */
export function manageToolOutputLifecycle(
  messages: UIMessage[],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): { messages: UIMessage[]; tokensFreed: number } {
  const recentBoundary = findNthUserMessageFromEnd(messages, config.keepRecentTurns);
  let tokensFreed = 0;

  const result = messages.map((msg, i) => {
    // 不是 tool-result 消息 → 原样保留
    if (!hasToolResults(msg)) return msg;
    // 已经全部压缩过 → 跳过
    if (isAllCompacted(msg)) return msg;

    // 判断是否应该压缩这条消息的工具输出
    const shouldCompact =
      i < recentBoundary || // 超出最近 N 轮
      totalToolResultSize(msg) > config.largeOutputThreshold; // 或者输出太大

    if (!shouldCompact) return msg;
    if (!isToolCompactable(msg, config)) return msg;

    const { compacted, freed } = compactToolResults(msg);
    tokensFreed += freed;
    return compacted;
  });

  return { messages: result, tokensFreed };
}

// ============================================================
// 工具结果检测（直接操作 .content 数组）
// ============================================================

/** 消息中是否有 tool-result 项 */
function hasToolResults(msg: UIMessage): boolean {
  const content = (msg as unknown as Record<string, unknown>).content;
  return Array.isArray(content) && content.some((c: unknown) => {
    const item = c as Record<string, unknown>;
    return item.type === 'tool-result';
  });
}

/** 获取 tool-result 项的数组 */
function getToolResultItems(msg: UIMessage): Record<string, unknown>[] {
  const content = (msg as unknown as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter((c: unknown) => {
    const item = c as Record<string, unknown>;
    return item.type === 'tool-result';
  }) as Record<string, unknown>[];
}

/** 是否所有 tool-result 都已压缩 */
function isAllCompacted(msg: UIMessage): boolean {
  const items = getToolResultItems(msg);
  if (items.length === 0) return true;
  return items.every((item) => item._compacted === true);
}

/** 未压缩的 tool-result 输出总字符数 */
function totalToolResultSize(msg: UIMessage): number {
  return getToolResultItems(msg)
    .filter((item) => item._compacted !== true)
    .reduce((sum, item) => sum + getToolOutputString(item.output).length, 0);
}

/** 提取工具名称列表 */
function extractToolNames(msg: UIMessage): string[] {
  return getToolResultItems(msg).map((item) => (item.toolName as string) ?? '');
}

// ============================================================
// Compactability Check
// ============================================================

function isToolCompactable(msg: UIMessage, config: LifecycleConfig): boolean {
  const toolNames = extractToolNames(msg);

  // 受保护的工具不压缩
  for (const name of toolNames) {
    if (config.protectedTools.has(name)) return false;
  }

  // 显式配置的可压缩工具
  if (config.compactableTools !== null) {
    for (const name of toolNames) {
      if (config.compactableTools.has(name)) return true;
    }
    return false;
  }

  // 默认规则：内置工具 + MCP + Connector
  for (const name of toolNames) {
    if (DEFAULT_COMPACTABLE.has(name)) return true;
    if (name.startsWith('mcp_') || name.startsWith('MCP_')) return true;
    if (name.startsWith('connector_') || name.startsWith('Connector_')) return true;
  }

  return false;
}

// ============================================================
// Tool Output Compression
// ============================================================

function compactToolResults(msg: UIMessage): {
  compacted: UIMessage;
  freed: number;
} {
  const content = (msg as unknown as Record<string, unknown>).content;
  if (!Array.isArray(content)) return { compacted: msg, freed: 0 };

  let freed = 0;
  const newContent = content.map((item: unknown) => {
    const contentItem = item as Record<string, unknown>;
    if (contentItem.type !== 'tool-result') return item;
    if (contentItem._compacted === true) return item;

    const resultStr = getToolOutputString(contentItem.output);
    const originalSize = resultStr.length;

    // 小输出不值得压缩
    if (originalSize < 200) return item;

    // 解包 ToolResultOutput 格式，确保 extractors 拿到实际值
    const unwrappedResult = unwrapOutput(contentItem.output);
    const summary = extractToolMeta(
      (contentItem.toolName as string) ?? 'unknown',
      null,
      unwrappedResult,
    );
    freed += Math.max(0, Math.floor(originalSize / 3.5) - Math.floor(summary.length / 3.5));

    // 保持 ToolResultOutput 结构 { type, value }，附加 _compacted 标记
    return {
      ...contentItem,
      output: { type: 'text', value: summary },
      _compacted: true,
      _originalSize: originalSize,
    };
  });

  return {
    compacted: { ...msg, content: newContent } as unknown as UIMessage,
    freed,
  };
}

// ============================================================
// Tool Meta Extractors
// ============================================================
// 设计要点(见 docs/built-in-tools-compaction-analysis.md #1/#2):
// 1. 键名使用工具的实际注册名(snake_case,见 agent/tools.ts),
//    同时保留首字母大写别名(兼容 mcp_/connector_ 去前缀后的名字)。
// 2. grep/glob/web_fetch 返回 JSON.stringify 后的字符串,先解析回对象。
// 3. 字段提取顺序:result 回显字段 → camelCase args → snake_case args。
//    内置工具的结果都回显了关键输入,args 缺失(恒为 null)时依然能提取。

type MetaExtractor = (args: unknown, result: unknown) => string;

/** grep/glob/web_fetch 返回 JSON.stringify 后的字符串,先解析回对象 */
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 依次取第一个非空字符串 */
function firstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

const extractRead: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const filePath = firstString(result?.path, argsRecord?.filePath, argsRecord?.file_path, argsRecord?.path);
  if (result?.error) {
    return `Read ${filePath} → error: ${firstString(result.message).slice(0, 100)}`;
  }
  const content = firstString(result?.content, typeof rawResult === 'string' ? rawResult : '');
  const lines = typeof result?.totalLines === 'number' ? result.totalLines : content.split('\n').length;
  return `Read ${filePath} → ${lines} lines`;
};

const extractBash: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const cmd = firstString(result?.command, argsRecord?.command).slice(0, 80);
  if (result?.error) {
    return `Bash '${cmd}' → error: ${firstString(result.message).slice(0, 100)}`;
  }
  const stdout = firstString(result?.stdout, typeof rawResult === 'string' ? rawResult : '');
  const exitCode = result?.exitCode ?? (stdout ? 0 : '?');
  const lastLine = stdout.trim().split('\n').pop()?.slice(0, 100) ?? '';
  return `Bash '${cmd}' → exit ${exitCode}${lastLine ? `: ${lastLine}` : ''}`;
};

const extractGrep: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const pattern = firstString(result?.pattern, argsRecord?.pattern);
  const matches = Array.isArray(result?.matches) ? (result.matches as Record<string, unknown>[]) : [];
  const total = typeof result?.totalMatches === 'number' ? result.totalMatches : matches.length;
  const files = new Set(matches.map((m) => (m.file ?? m.path) as string)).size;
  return `Grep '${pattern}' → ${total} matches${files > 0 ? ` in ${files} files` : ''}`;
};

const extractGlob: MetaExtractor = (args, rawResult) => {
  const parsed = parseIfJsonString(rawResult);
  const result = asRecord(parsed);
  const argsRecord = asRecord(args);
  const pattern = firstString(result?.pattern, argsRecord?.pattern);
  const files = Array.isArray(result?.files) ? result.files : Array.isArray(parsed) ? parsed : [];
  const total = typeof result?.totalCount === 'number' ? result.totalCount : files.length;
  return `Glob '${pattern}' → ${total} files`;
};

const extractEdit: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const filePath = firstString(result?.path, argsRecord?.filePath, argsRecord?.file_path, argsRecord?.path);
  if (result?.error) {
    return `Edit ${filePath} → error: ${firstString(result.message).slice(0, 100)}`;
  }
  const summary = firstString(result?.summary);
  return `Edit ${filePath} → ${summary || 'applied'}`;
};

const extractWrite: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const filePath = firstString(result?.path, argsRecord?.filePath, argsRecord?.file_path, argsRecord?.path);
  if (result?.error) {
    return `Write ${filePath} → error: ${firstString(result.message).slice(0, 100)}`;
  }
  const size = typeof result?.size === 'number' ? ` (${result.size} bytes)` : '';
  return `Write ${filePath} → written${size}`;
};

const extractWebFetch: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const url = firstString(result?.url, argsRecord?.url).slice(0, 80);
  if (result?.success === false) {
    return `WebFetch ${url} → error: ${firstString(result.error).slice(0, 80)}`;
  }
  const title = firstString(result?.title).slice(0, 60);
  const len = typeof result?.content === 'string'
    ? result.content.length
    : typeof rawResult === 'string' ? rawResult.length : JSON.stringify(rawResult).length;
  return `WebFetch ${url} → ${len} chars${title ? ` ('${title}')` : ''}`;
};

const extractWebSearch: MetaExtractor = (args, rawResult) => {
  const result = parseIfJsonString(rawResult);
  const raw = Array.isArray(result) ? result : asRecord(result)?.results;
  const count = Array.isArray(raw) ? raw.length : 0;
  const argsRecord = asRecord(args);
  const query = firstString(asRecord(result)?.query, argsRecord?.query).slice(0, 60);
  return `WebSearch '${query}' → ${count} results`;
};

const EXTRACTORS: Record<string, MetaExtractor> = {
  // 实际注册名(snake_case,见 agent/tools.ts)
  read_file: extractRead,
  bash: extractBash,
  grep: extractGrep,
  glob: extractGlob,
  edit_file: extractEdit,
  write_file: extractWrite,
  web_fetch: extractWebFetch,
  // 首字母大写别名(兼容 mcp_/connector_ 去前缀后的名字与旧格式)
  Read: extractRead,
  Bash: extractBash,
  Grep: extractGrep,
  Glob: extractGlob,
  Edit: extractEdit,
  Write: extractWrite,
  WebFetch: extractWebFetch,
  WebSearch: extractWebSearch,
};

/** 通用提取器：保留结果的结构轮廓 */
function defaultExtractor(_args: unknown, result: unknown): string {
  if (typeof result === 'string') {
    if (result.length <= 200) return result;
    return `${result.slice(0, 80)} ... ${result.slice(-80)} [${result.length} chars total]`;
  }
  if (Array.isArray(result)) {
    return `Array[${result.length}]${result.length > 0 ? `: first=${JSON.stringify(result[0]).slice(0, 80)}` : ''}`;
  }
  if (typeof result === 'object' && result !== null) {
    const keys = Object.keys(result).slice(0, 8);
    return `{${keys.join(', ')}} [${JSON.stringify(result).length} chars]`;
  }
  return `[${typeof result}, ${String(result).length} chars]`;
}

export function extractToolMeta(toolName: string, args: unknown, result: unknown): string {
  // 1. 精确匹配
  if (EXTRACTORS[toolName]) return EXTRACTORS[toolName](args, result);
  // 2. 去掉 mcp_ / connector_ 前缀后匹配
  const baseName = toolName.replace(/^(mcp_|connector_|MCP_|Connector_)/i, '');
  if (EXTRACTORS[baseName]) return EXTRACTORS[baseName](args, result);
  // 3. 通用提取
  return `${toolName}: ${defaultExtractor(args, result)}`;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 从消息末尾找到第 N 个用户消息的位置
 * 返回该位置作为"最近 N 轮"的边界
 */
function findNthUserMessageFromEnd(messages: UIMessage[], n: number): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      count++;
      if (count >= n) return i;
    }
  }
  return 0; // 不到 N 轮 → 全部消息都在"最近"范围内
}
