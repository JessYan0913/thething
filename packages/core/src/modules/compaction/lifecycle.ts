// ============================================================
// Compaction - Layer 2: Tool Output Lifecycle Management
// ============================================================
// 核心创新：每步 API 调用前，自动将旧工具输出替换为结构化元信息。
// 同步执行，微秒级，不调用 LLM。
//
// 格式归一化：消息的双轨格式（UIMessage .parts / ModelMessage .content）
// 已收敛到 message-view.ts 的 extractToolResultView / applyCompactionPatches
// 两个函数中。本模块所有决策逻辑通过 ToolResultView 操作，完全格式无关。
// 见 docs/compaction-unification-design.md。
//
// 老化按 step 计数而非 user 轮数：agentic 场景下单个 user 轮内
// 可能有上百次工具调用,按轮数计算时它们永不老化。
// 见 docs/context-compaction-analysis.md A。

import type { PipelineMessage } from '../../services/config/compaction-types';
import {
  type LifecycleConfig,
  type CompactedToolResult,
  DEFAULT_LIFECYCLE_CONFIG,
  DEFAULT_COMPACTABLE,
} from './types';
import {
  extractToolResultView,
  applyCompactionPatches,
  type ToolResultItemView,
  type ToolResultView,
} from './message-view';
import { persistToolResult, getToolResultPath } from '../budget/tool-result-storage';
import { logger } from '../../primitives/logger';

// ============================================================
// Main Function
// ============================================================

export interface LifecycleStorage {
  sessionId: string;
  dataDir: string;
}

/**
 * 工具输出生命周期管理（Layer 2）
 *
 * 在每步 API 调用前同步执行：
 * - 保留最近 K 个 step 的工具输出
 * - 更早的旧工具输出 → 替换为结构化元信息
 * - 超大工具输出（即使在最近 K 个 step 内）→ 也压缩
 *
 * 提供 storage 时,压缩的原始输出异步落盘,元信息带 saved to 路径,
 * 模型可用 read_file 找回(见主文档 B)。函数本身保持同步;
 * 落盘完成情况通过返回值的 persistence Promise 暴露。
 *
 * @returns 替换后的消息和释放的 token 数
 */
export function manageToolOutputLifecycle(
  messages: PipelineMessage[],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  storage?: LifecycleStorage,
): { messages: PipelineMessage[]; tokensFreed: number; persistence?: Promise<void> } {
  // 预计算视图：价值感知信号需要全局扫描
  const views = messages.map(extractToolResultView);
  const staleReadIndices = findStaleDuplicateReads(views);
  const referencedIndices = findReferencedResults(views);
  const recentBoundary = findNthToolResultMessageFromEnd(views, config.keepRecentSteps);

  let tokensFreed = 0;
  const persistTasks: Promise<void>[] = [];

  const result = messages.map((msg, i) => {
    const v = views[i];

    // 无工具结果 → 原样
    if (v.toolResults.length === 0) return msg;

    // 已全部压缩 → 跳过
    if (v.toolResults.every((tr) => tr.isCompacted)) return msg;

    // 老化判定
    const totalSize = v.toolResults
      .filter((tr) => !tr.isCompacted)
      .reduce((sum, tr) => sum + tr.outputSize, 0);
    const tooLarge = totalSize > config.largeOutputThreshold;
    const isStaleDuplicate = staleReadIndices.has(i);
    // 被后续引用的结果延迟老化，仅豁免"超出最近 K step"这一条
    const beyondBoundary = i < recentBoundary && !referencedIndices.has(i);
    const shouldCompact = isStaleDuplicate || tooLarge || beyondBoundary;

    if (!shouldCompact) return msg;
    if (!isToolCompactable(v, config)) return msg;

    // 构建补丁
    const patches = buildCompactionPatches(v, storage, persistTasks);
    if (patches.length === 0) return msg;

    const { patched, freed } = applyCompactionPatches(msg, patches);
    tokensFreed += freed;
    return patched;
  });

  // ── 跨消息超大输出扫描（吸收原 enforceToolResultBudget）──
  // 当 messageBudget 配置时，对仍然未压缩的大工具输出做全局排序持久化。
  if (config.messageBudget && config.messageBudget > 0 && storage) {
    const { messages: scanResult, freed: scanFreed } = applyCrossMessageBudget(
      result, config.messageBudget, storage, persistTasks,
    );
    return {
      messages: scanResult,
      tokensFreed: tokensFreed + scanFreed,
      persistence: persistTasks.length > 0
        ? Promise.all(persistTasks).then(() => undefined)
        : undefined,
    };
  }

  return {
    messages: result,
    tokensFreed,
    persistence: persistTasks.length > 0
      ? Promise.all(persistTasks).then(() => undefined)
      : undefined,
  };
}

// ============================================================
// Patch Building (replaces old compactToolResults)
// ============================================================

/**
 * 为一条消息中所有应压缩的工具结果构建补丁列表。
 * 格式无关——只操作视图和输出值。
 */
function buildCompactionPatches(
  view: ToolResultView,
  storage?: LifecycleStorage,
  persistTasks?: Promise<void>[],
): { refIndex: number; summary: string }[] {
  const patches: { refIndex: number; summary: string }[] = [];

  for (const tr of view.toolResults) {
    if (tr.isCompacted) continue;
    if (tr.isError) continue;          // 错误保护：失败的工具输出不压缩
    if (tr.outputSize < 200) continue;

    let summary = extractToolMeta(tr.toolName, tr.input, tr.output);

    if (storage && tr.toolCallId) {
      const isJson =
        tr.outputRaw.trim().startsWith('{') || tr.outputRaw.trim().startsWith('[');
      const filepath = getToolResultPath(
        tr.toolCallId,
        storage.sessionId,
        storage.dataDir,
        isJson,
      );
      summary += `\n[Full output saved to: ${filepath}]\n[To recover: use read_file with this path]`;
      persistTasks?.push(
        persistToolResult(tr.outputRaw, tr.toolCallId, storage.sessionId, storage.dataDir)
          .then(() => undefined)
          .catch((err) => {
            logger.warn('Lifecycle', `Failed to persist ${tr.toolCallId}:`, err);
          }),
      );
    }

    patches.push({ refIndex: tr.refIndex, summary });
  }

  return patches;
}

// ============================================================
// Cross-Message Budget (吸收原 enforceToolResultBudget)
// ============================================================

interface BudgetCandidate {
  msgIndex: number;
  refIndex: number;
  toolCallId: string;
  toolName: string;
  outputRaw: string;
  size: number;
}

/**
 * 跨消息超大输出预算检查：收集所有未压缩工具结果，按大小排序，
 * 持久化最大的直到总额低于 budget。粒度与 message-budget.ts 一致。
 */
function applyCrossMessageBudget(
  messages: PipelineMessage[],
  budget: number,
  storage: LifecycleStorage,
  persistTasks: Promise<void>[],
): { messages: PipelineMessage[]; freed: number } {
  // 收集所有未压缩的非错误工具结果
  const candidates: BudgetCandidate[] = [];
  for (let i = 0; i < messages.length; i++) {
    const view = extractToolResultView(messages[i]);
    for (const tr of view.toolResults) {
      if (tr.isCompacted || tr.isError) continue;
      if (!tr.toolCallId) continue;
      candidates.push({
        msgIndex: i,
        refIndex: tr.refIndex,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        outputRaw: tr.outputRaw,
        size: tr.outputSize,
      });
    }
  }

  // 计算总额
  let totalSize = candidates.reduce((sum, c) => sum + c.size, 0);
  if (totalSize <= budget) return { messages, freed: 0 };

  // 按 size 降序排序
  candidates.sort((a, b) => b.size - a.size);

  // 持久化最大的直到总额低于 budget
  const patchesByMsg = new Map<number, { refIndex: number; summary: string }[]>();
  let freed = 0;

  for (const c of candidates) {
    if (totalSize <= budget) break;

    const isJson = c.outputRaw.trim().startsWith('{') || c.outputRaw.trim().startsWith('[');
    const filepath = getToolResultPath(c.toolCallId, storage.sessionId, storage.dataDir, isJson);
    const meta = extractToolMeta(c.toolName, undefined, c.outputRaw);
    const summary = `${meta}\n[Full output saved to: ${filepath}]\n[To recover: use read_file with this path]`;

    persistTasks.push(
      persistToolResult(c.outputRaw, c.toolCallId, storage.sessionId, storage.dataDir)
        .then(() => undefined)
        .catch((err) => logger.warn('Lifecycle', `Cross-msg persist ${c.toolCallId}:`, err)),
    );

    freed += c.size - summary.length;
    totalSize -= c.size; // 总额中移除

    const list = patchesByMsg.get(c.msgIndex) ?? [];
    list.push({ refIndex: c.refIndex, summary });
    patchesByMsg.set(c.msgIndex, list);
  }

  // 应用补丁
  const result = messages.map((msg, i) => {
    const patches = patchesByMsg.get(i);
    if (!patches || patches.length === 0) return msg;
    return applyCompactionPatches(msg, patches).patched;
  });

  return { messages: result, freed: Math.max(0, freed) };
}

// ============================================================

/** 取一条 read_file 结果回显的文件路径(用于去重),非 read 或无路径返回 null */
function readResultPath(item: ToolResultItemView): string | null {
  const toolName = item.toolName;
  if (toolName !== 'read_file' && toolName !== 'Read') return null;
  const r = asRecord(item.output);
  const path = r?.path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

/**
 * 同文件重复读取去重:同一文件被 read_file 多次,只保留最后一次完整输出,
 * 更早的直接进压缩集。返回应压缩的消息索引集合。
 */
function findStaleDuplicateReads(views: ToolResultView[]): Set<number> {
  const lastReadIndex = new Map<string, number>();
  const perPathIndices = new Map<string, number[]>();

  views.forEach((v, i) => {
    if (v.toolResults.length === 0) return;
    if (v.toolResults.every((tr) => tr.isCompacted)) return;
    for (const item of v.toolResults) {
      const path = readResultPath(item);
      if (!path) continue;
      lastReadIndex.set(path, i);
      const list = perPathIndices.get(path) ?? [];
      list.push(i);
      perPathIndices.set(path, list);
    }
  });

  const stale = new Set<number>();
  for (const [path, indices] of perPathIndices) {
    const keep = lastReadIndex.get(path);
    for (const idx of indices) {
      if (idx !== keep) stale.add(idx);
    }
  }
  return stale;
}

/**
 * 引用感知:后续 assistant 文本里出现了某工具结果回显的文件路径,
 * 说明它属于当前工作集,降低压缩优先级(延迟老化)。
 * 返回被引用、应延迟老化的 tool-result 消息索引集合。
 */
function findReferencedResults(views: ToolResultView[]): Set<number> {
  // 收集每条 tool-result 消息回显的路径
  const msgPaths: { index: number; paths: string[] }[] = [];
  views.forEach((v, i) => {
    if (v.toolResults.length === 0 || v.toolResults.every((tr) => tr.isCompacted)) return;
    const paths: string[] = [];
    for (const item of v.toolResults) {
      const r = asRecord(item.output);
      const p = r?.path;
      if (typeof p === 'string' && p.length > 0) paths.push(p);
    }
    if (paths.length > 0) msgPaths.push({ index: i, paths });
  });

  if (msgPaths.length === 0) return new Set();

  const referenced = new Set<number>();
  for (const { index, paths } of msgPaths) {
    for (let j = index + 1; j < views.length; j++) {
      if (views[j].role !== 'assistant') continue;
      const text = views[j].textContent;
      if (!text) continue;
      if (paths.some((p) => text.includes(p))) {
        referenced.add(index);
        break;
      }
    }
  }
  return referenced;
}

// ============================================================
// Compactability Check
// ============================================================

function isToolCompactable(view: ToolResultView, config: LifecycleConfig): boolean {
  const toolNames = new Set(view.toolResults.map((tr) => tr.toolName));

  for (const name of toolNames) {
    if (config.protectedTools.has(name)) return false;
  }

  if (config.compactableTools !== null) {
    for (const name of toolNames) {
      if (config.compactableTools.has(name)) return true;
    }
    return false;
  }

  for (const name of toolNames) {
    if (DEFAULT_COMPACTABLE.has(name)) return true;
    if (name.startsWith('mcp_') || name.startsWith('MCP_')) return true;
    if (name.startsWith('connector_') || name.startsWith('Connector_')) return true;
  }

  return false;
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
  return `Grep '${pattern}' → ${total} matches`;
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

const extractSkill: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const skillName = firstString(result?.skillName, argsRecord?.skill);
  if (result?.success === false) {
    return `Skill '${skillName}' → error: ${firstString(result.error).slice(0, 80)}`;
  }
  const outputLen = typeof result?._skillOutput === 'string'
    ? result._skillOutput.length
    : typeof rawResult === 'string' ? rawResult.length : JSON.stringify(rawResult).length;
  return `Skill '${skillName}' → loaded (${outputLen} chars)`;
};

const extractReadWikiPage: MetaExtractor = (args, rawResult) => {
  const result = asRecord(parseIfJsonString(rawResult));
  const argsRecord = asRecord(args);
  const pageName = firstString(result?.name, argsRecord?.pageName, argsRecord?.page_name);
  if (result?.found === false) {
    return `ReadWiki '${pageName}' → not found`;
  }
  const contentLen = typeof result?.content === 'string' ? result.content.length : 0;
  return `ReadWiki '${pageName}' → ${contentLen} chars`;
};

const EXTRACTORS: Record<string, MetaExtractor> = {
  read_file: extractRead,
  bash: extractBash,
  grep: extractGrep,
  glob: extractGlob,
  edit_file: extractEdit,
  write_file: extractWrite,
  web_fetch: extractWebFetch,
  skill: extractSkill,
  read_wiki_page: extractReadWikiPage,
  Read: extractRead,
  Bash: extractBash,
  Grep: extractGrep,
  Glob: extractGlob,
  Edit: extractEdit,
  Write: extractWrite,
  WebFetch: extractWebFetch,
  WebSearch: extractWebSearch,
  Skill: extractSkill,
  ReadWikiPage: extractReadWikiPage,
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
  if (EXTRACTORS[toolName]) return EXTRACTORS[toolName](args, result);
  const baseName = toolName.replace(/^(mcp_|connector_|MCP_|Connector_)/i, '');
  if (EXTRACTORS[baseName]) return EXTRACTORS[baseName](args, result);
  return `${toolName}: ${defaultExtractor(args, result)}`;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 从消息末尾找到第 K 条含 tool-result 的消息的位置。
 * 返回该位置作为"最近 K 个 step"的边界。
 */
function findNthToolResultMessageFromEnd(views: ToolResultView[], k: number): number {
  if (k <= 0) return views.length;
  let count = 0;
  for (let i = views.length - 1; i >= 0; i--) {
    if (views[i].toolResults.length > 0) {
      count++;
      if (count >= k) return i;
    }
  }
  return 0;
}
