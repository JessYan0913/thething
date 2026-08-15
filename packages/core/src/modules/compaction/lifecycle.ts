// ============================================================
// Compaction - Layer 2: Tool Output Lifecycle Management
// ============================================================
// 核心创新：每步 API 调用前，自动将旧工具输出替换为结构化元信息。
// 同步执行，微秒级，不调用 LLM。
//
// 格式归一化：消息的双轨格式（UIMessage .parts / ModelMessage .content）
// 已收敛到 message-view.ts 的 extractToolResultView / applyCompactionPatches
// 两个函数中。本模块所有决策逻辑通过 ToolResultView 操作，完全格式无关。
// 见 docs/compaction-redesign.md
//
// 老化按 step 计数而非 user 轮数：agentic 场景下单个 user 轮内
// 可能有上百次工具调用,按轮数计算时它们永不老化。
// 见 docs/compaction-redesign.md
//
// 2026-07-25 读循环事故后收敛为唯一分配器 + 降级阶梯：
//   完整 → 可见截断(_truncated,保留头尾+找回提示) → meta(_compacted)
// 三条不变式：
//   1. 感知-行动环不可断：当前步(最新一次工具结果)永不 meta 化,超大改可见截断
//   2. 语义类工具(read_file 等"模型主动要看的内容")超大时截断而非 meta
//   3. 读循环熔断：同文件被读 ≥3 次 → 自动 pin,最新读取保留完整
// 见 docs/compaction-redesign.md


import {
  type LifecycleConfig,
  DEFAULT_LIFECYCLE_CONFIG,
  DEFAULT_COMPACTABLE,
} from './types';
import {
  extractToolResultView,
  applyCompactionPatches,
  type CompactionPatch,
  type ToolResultItemView,
  type ToolResultView,
} from './message-view';
import { persistToolResult, getToolResultPath } from '../budget/tool-result-storage';
import type { ContextLedger } from './context-ledger';
import type { CompactionTelemetry } from './compaction-telemetry';
import { logger } from '../../primitives/logger';
import type { Tool } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { compressMessagesDeterministic } from './deterministic-compressor';
import { forceTruncateMessages } from './force-truncate';
import { emergencySummarize } from './emergency-summary';
import { estimateFullRequest, type FullRequestEstimation } from './token-counter';
import { estimateRequestBudget, type RequestBudgetEstimation } from './request-budget';
import { targetTokensFor, messageTargetTokensFor, MIN_MESSAGE_BUDGET_TOKENS, DEFAULT_TARGET_PERCENT, EMERGENCY_TARGET_PERCENT } from './prompt-budget-policy';
import { updateViewAfterL3, type CompactionView } from './compaction-view';

// ============================================================
// Main Function
// ============================================================

export interface LifecycleStorage {
  sessionId: string;
  dataDir: string;
}

/** 反馈闭环依赖（可选）：pin 注册表/台账 + 遥测 */
export interface LifecycleOptions {
  ledger?: ContextLedger;
  telemetry?: CompactionTelemetry;
  /** 会话级压缩步数计数器（跨 API 调用持久），用于 TTL 老化 */
  compactionStep?: { current: number };
}

/** 低于此大小的输出不参与任何压缩 */
const MIN_COMPACT_SIZE = 200;
/** 读循环熔断阈值：同文件被读达到此次数 → 自动 pin */
const READ_LOOP_THRESHOLD = 3;
/** TTL 老化：meta 消息保持满格式的最大步数年龄 */
const TTL_FULL_AGE = 20;
/** TTL 老化：meta 消息降级为占位符的最大步数年龄（超出则移除） */
const TTL_STUB_AGE = 40;

/**
 * 工具输出生命周期管理（Layer 2）——唯一预算分配器
 *
 * 在每步 API 调用前同步执行，按优先级对每条工具结果决策：
 * - 错误结果 / 小输出 / 不可压缩工具 / pin 的最新读取 → 保留完整
 * - 同文件重复读的更早副本 → meta
 * - 当前步结果 → 永不 meta；超大时可见截断（保留头尾 + 找回提示）
 * - 超出最近 K step 且未被引用 → meta
 * - 边界内超大：语义类（read_file）→ 可见截断；瞬态类 → meta + 落盘
 *
 * 提供 storage 时,压缩的瞬态输出异步落盘,元信息带 saved to 路径,
 * 模型可用 read_file 找回。函数本身保持同步;
 * 落盘完成情况通过返回值的 persistence Promise 暴露。
 *
 * @returns 替换后的消息和释放的 token 数
 */
export function manageToolOutputLifecycle(
  messages: import('ai').ModelMessage[],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  storage?: LifecycleStorage,
  opts?: LifecycleOptions,
): { messages: import('ai').ModelMessage[]; tokensFreed: number; persistence?: Promise<void> } {
  // 预计算视图：价值感知信号需要全局扫描
  const views = messages.map(extractToolResultView);
  const currentStepIndex = findLastToolResultIndex(views);
  const { staleIndices, lastReadIndexByPath } = analyzeReads(views);
  const referencedIndices = findReferencedResults(views);
  const recentBoundary = findNthToolResultMessageFromEnd(views, config.keepRecentSteps);

  // 读循环熔断：同文件读取次数达到阈值 → 自动 pin + 上报
  detectReadLoops(views, opts);
  const pinnedPaths = opts?.ledger?.pinnedPaths ?? new Set<string>();

  let tokensFreed = 0;
  const persistTasks: Promise<void>[] = [];
  /** 会话级压缩步数计数器（跨 API 调用持久），用于 TTL 老化 */
  const step = opts?.compactionStep ?? { current: 0 };
  const nextStep = () => step.current++;

  const result = messages.map((msg, i) => {
    const v = views[i];

    // 无工具结果 → 原样
    if (v.toolResults.length === 0) return msg;

    // 已全部压缩 → TTL 老化检查
    if (v.toolResults.every((tr) => tr.isCompacted)) {
      const ages = v.toolResults.map((tr) => step.current - tr.compactedAt).filter((a) => a >= 0);
      if (ages.length === 0) return msg; // 无有效年龄，保持原样
      const minAge = Math.min(...ages);

      if (minAge > TTL_STUB_AGE) {
        // Level 3: 从上下文移除，写台账
        for (const tr of v.toolResults) {
          const readPath = resolveReadPath(tr);
          opts?.ledger?.recordEviction(tr.toolName, readPath ?? undefined);
        }
        tokensFreed += 50; // 估算占位符 token 释放
        return null; // 返回 null 表示从数组中移除
      }

      if (minAge > TTL_FULL_AGE) {
        // Level 2: 替换为一行占位符
        const toolNames = [...new Set(v.toolResults.map((tr) => tr.toolName))].join(', ');
        const stubSummary = `[TTL ${minAge} steps: compacted ${toolNames} output — archived, use context_pin to review]`;
        const patches: CompactionPatch[] = v.toolResults.map((tr) => ({
          refIndex: tr.refIndex,
          summary: stubSummary,
          mode: 'compacted' as const,
          compactedAt: step.current,
        }));
        const { patched, freed } = applyCompactionPatches(msg, patches);
        tokensFreed += freed;
        return patched;
      }

      // Level 1: age <= TTL_FULL_AGE，保持当前格式
      return msg;
    }

    const isCurrentStep = i === currentStepIndex;
    // 被后续引用的结果延迟老化，仅豁免"超出最近 K step"这一条
    const beyondBoundary = i < recentBoundary && !referencedIndices.has(i);
    const msgHasStaleRead = staleIndices.has(i);

    const patches: CompactionPatch[] = [];
    for (const tr of v.toolResults) {
      if (tr.isCompacted) continue;
      if (tr.isError) continue;          // 错误保护：失败的工具输出不压缩
      if (tr.outputSize < MIN_COMPACT_SIZE) continue;
      if (!isResultCompactable(tr.toolName, config)) continue;

      const readPath = resolveReadPath(tr);
      const isLatestReadOfPath = readPath !== null && lastReadIndexByPath.get(readPath) === i;

      // pin 保护：pin 路径的最新读取保留完整（模型主动 pin 或熔断自动 pin）
      if (readPath && pinnedPaths.has(readPath) && isLatestReadOfPath) continue;

      // 同文件重复读去重：更早的副本直接 meta（最新一份由后续规则保护）
      if (msgHasStaleRead && readPath !== null && !isLatestReadOfPath) {
        patches.push(buildMetaPatch(tr, storage, persistTasks, opts, nextStep()));
        continue;
      }

      const tooLarge = !tr.isTruncated && tr.outputSize > config.largeOutputThreshold;

      // 当前步豁免：最近一次行动的结果必须可感知——永不 meta，超大改可见截断
      if (isCurrentStep) {
        if (tooLarge) patches.push(buildTruncationPatch(tr, config, storage, persistTasks, opts, nextStep()));
        continue;
      }

      if (beyondBoundary) {
        patches.push(buildMetaPatch(tr, storage, persistTasks, opts, nextStep()));
        continue;
      }

      if (tooLarge) {
        // 语义类（模型主动要看的内容）：可见截断，永不直接 meta
        if (isSemanticTool(tr.toolName)) {
          patches.push(buildTruncationPatch(tr, config, storage, persistTasks, opts, nextStep()));
        } else {
          patches.push(buildMetaPatch(tr, storage, persistTasks, opts, nextStep()));
        }
      }
    }

    if (patches.length === 0) return msg;

    const { patched, freed } = applyCompactionPatches(msg, patches);
    tokensFreed += freed;
    return patched;
  });

  // 过滤 TTL 老化移除的消息
  const filteredResult = result.filter((m): m is import('ai').ModelMessage => m !== null);

  // ── 跨消息超大输出扫描（吸收原 enforceToolResultBudget）──
  // 当 messageBudget 配置时，对仍然未 meta 的大工具输出做全局排序降级。
  // storage 可选：无 storage 时瞬态输出降级为无找回路径的 meta（有损兜底）。
  if (config.messageBudget && config.messageBudget > 0) {
    const { messages: scanResult, freed: scanFreed } = applyCrossMessageBudget(
      filteredResult, config.messageBudget, storage, persistTasks,
      { currentStepIndex, pinnedPaths, lastReadIndexByPath },
      opts,
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
    messages: filteredResult,
    tokensFreed,
    persistence: persistTasks.length > 0
      ? Promise.all(persistTasks).then(() => undefined)
      : undefined,
  };
}

// ============================================================
// Patch Building（降级阶梯的两级：truncate / meta）
// ============================================================

/** 截断后的首行 = 原 meta 头（供 truncated → meta 降级复用） */
function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  return idx >= 0 ? text.slice(0, idx) : text;
}

/**
 * meta 化补丁：输出替换为结构化元信息。
 * 瞬态工具 + storage → 原文落盘,meta 带 saved-to 找回路径。
 * read_file 输出本身就是磁盘文件,落盘=同一份文件存两份;meta 已含原文件路径,模型可直接 re-read 找回。
 */
function buildMetaPatch(
  tr: ToolResultItemView,
  storage: LifecycleStorage | undefined,
  persistTasks: Promise<void>[],
  opts?: LifecycleOptions,
  compactedAt?: number,
): CompactionPatch {
  // truncated → meta 降级：首行就是当初生成的 meta 头，不重新解析（截断后原始结构已丢失）
  let summary = tr.isTruncated
    ? firstLine(tr.outputRaw)
    : extractToolMeta(tr.toolName, tr.input, tr.output);
  let recovery: string | undefined;

  if (isFileReadTool(tr.toolName)) {
    recovery = 're-read the original file';
  } else if (storage && tr.toolCallId && !tr.isTruncated) {
    const isJson =
      tr.outputRaw.trim().startsWith('{') || tr.outputRaw.trim().startsWith('[');
    const filepath = getToolResultPath(
      tr.toolCallId,
      storage.sessionId,
      storage.dataDir,
      isJson,
    );
    summary += `\n[Full output saved to: ${filepath}]\n[To recover: use read_file with this path]`;
    recovery = filepath;
    persistTasks.push(
      persistToolResult(tr.outputRaw, tr.toolCallId, storage.sessionId, storage.dataDir)
        .then(() => undefined)
        .catch((err) => {
          logger.warn('Lifecycle', `Failed to persist ${tr.toolCallId}:`, err);
        }),
    );
  }

  opts?.ledger?.recordCompaction({
    toolName: tr.toolName,
    path: resolveReadPath(tr) ?? undefined,
    toolCallId: tr.toolCallId,
    action: 'meta',
    originalSize: tr.outputSize,
    recovery,
  });

  return { refIndex: tr.refIndex, summary, compactedAt };
}

/**
 * 可见截断补丁：保留头尾 + 省略标记 + 找回提示。
 * 与 meta 的本质区别：模型保留部分感知（知道看到了什么、缺了什么、怎么补），
 * 不会陷入"读不到→再读"的循环。标记 _truncated（非 _compacted），
 * 老化超出边界后仍可降级为 meta。
 */
function buildTruncationPatch(
  tr: ToolResultItemView,
  config: LifecycleConfig,
  storage: LifecycleStorage | undefined,
  persistTasks: Promise<void>[],
  opts?: LifecycleOptions,
  compactedAt?: number,
): CompactionPatch {
  const keep = Math.max(1000, config.largeOutputThreshold);
  const headLen = Math.floor(keep * 0.6);
  const tailLen = Math.floor(keep * 0.25);
  const head = tr.outputRaw.slice(0, headLen);
  const tail = tr.outputRaw.slice(-tailLen);
  const omitted = tr.outputSize - headLen - tailLen;
  const meta = extractToolMeta(tr.toolName, tr.input, tr.output);

  let recoveryHint: string;
  let recovery: string | undefined;
  if (isFileReadTool(tr.toolName)) {
    recoveryHint = '[Omitted range is NOT lost: re-read with read_file(filePath, offset, limit) to view specific lines]';
    recovery = 're-read with offset/limit';
  } else if (storage && tr.toolCallId) {
    const isJson =
      tr.outputRaw.trim().startsWith('{') || tr.outputRaw.trim().startsWith('[');
    const filepath = getToolResultPath(tr.toolCallId, storage.sessionId, storage.dataDir, isJson);
    recoveryHint = `[Full output saved to: ${filepath} — use read_file to recover]`;
    recovery = filepath;
    persistTasks.push(
      persistToolResult(tr.outputRaw, tr.toolCallId, storage.sessionId, storage.dataDir)
        .then(() => undefined)
        .catch((err) => logger.warn('Lifecycle', `Truncation persist ${tr.toolCallId}:`, err)),
    );
  } else {
    recoveryHint = '[Middle portion omitted to fit context budget]';
  }

  const summary =
    `${meta}\n${head}\n\n[... ${omitted} chars omitted ...]\n${recoveryHint}\n\n${tail}`;

  opts?.ledger?.recordCompaction({
    toolName: tr.toolName,
    path: resolveReadPath(tr) ?? undefined,
    toolCallId: tr.toolCallId,
    action: 'truncated',
    originalSize: tr.outputSize,
    recovery,
  });

  return { refIndex: tr.refIndex, summary, mode: 'truncated', compactedAt };
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
  isTruncated: boolean;
  input?: unknown;
  output: unknown;
}

/**
 * 跨消息超大输出预算检查：收集所有未 meta 的工具结果，按大小排序，
 * 降级最大的直到总额低于 budget。当前步与 pin 的最新读取豁免。
 */
function applyCrossMessageBudget(
  messages: import('ai').ModelMessage[],
  budget: number,
  storage: LifecycleStorage | undefined,
  persistTasks: Promise<void>[],
  exempt: {
    currentStepIndex: number;
    pinnedPaths: Set<string>;
    lastReadIndexByPath: Map<string, number>;
  },
  opts?: LifecycleOptions,
): { messages: import('ai').ModelMessage[]; freed: number } {
  // 收集所有未 meta 的非错误工具结果（含 truncated——可进一步降级）
  const candidates: BudgetCandidate[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === exempt.currentStepIndex) continue; // 当前步豁免
    const view = extractToolResultView(messages[i]);
    for (const tr of view.toolResults) {
      if (tr.isCompacted || tr.isError) continue;
      if (!tr.toolCallId) continue;
      const readPath = resolveReadPath(tr);
      if (readPath && exempt.pinnedPaths.has(readPath) && exempt.lastReadIndexByPath.get(readPath) === i) {
        continue; // pin 的最新读取豁免
      }
      candidates.push({
        msgIndex: i,
        refIndex: tr.refIndex,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        outputRaw: tr.outputRaw,
        size: tr.outputSize,
        isTruncated: tr.isTruncated,
        input: tr.input,
        output: tr.output,
      });
    }
  }

  // 计算总额
  let totalSize = candidates.reduce((sum, c) => sum + c.size, 0);
  if (totalSize <= budget) return { messages, freed: 0 };

  // 按 size 降序排序
  candidates.sort((a, b) => b.size - a.size);

  // 降级最大的直到总额低于 budget
  const patchesByMsg = new Map<number, CompactionPatch[]>();
  let freed = 0;

  for (const c of candidates) {
    if (totalSize <= budget) break;

    const meta = c.isTruncated
      ? firstLine(c.outputRaw)
      : extractToolMeta(c.toolName, c.input, c.output);
    let summary: string;
    if (isFileReadTool(c.toolName)) {
      // read_file 输出已是磁盘文件,不落盘(meta 含路径,模型 re-read 原文件找回)
      summary = meta;
    } else if (storage && !c.isTruncated) {
      const isJson = c.outputRaw.trim().startsWith('{') || c.outputRaw.trim().startsWith('[');
      const filepath = getToolResultPath(c.toolCallId, storage.sessionId, storage.dataDir, isJson);
      summary = `${meta}\n[Full output saved to: ${filepath}]\n[To recover: use read_file with this path]`;
      persistTasks.push(
        persistToolResult(c.outputRaw, c.toolCallId, storage.sessionId, storage.dataDir)
          .then(() => undefined)
          .catch((err) => logger.warn('Lifecycle', `Cross-msg persist ${c.toolCallId}:`, err)),
      );
    } else {
      // 无 storage / 已截断过的瞬态输出：有损降级为纯 meta
      summary = meta;
    }

    freed += c.size - summary.length;
    totalSize -= c.size; // 总额中移除

    opts?.ledger?.recordCompaction({
      toolName: c.toolName,
      toolCallId: c.toolCallId,
      action: 'meta',
      originalSize: c.size,
    });

    const list = patchesByMsg.get(c.msgIndex) ?? [];
    const ca = opts?.compactionStep?.current ?? 0;
    if (opts?.compactionStep) opts.compactionStep.current++;
    list.push({ refIndex: c.refIndex, summary, compactedAt: ca });
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
// Read Analysis（去重 / pin / 熔断共享）
// ============================================================

/**
 * 解析一条工具结果对应的文件路径（read 类工具）。
 * 依次尝试：输出对象的 path 回显 → 输入参数 → meta/截断文本首行解析。
 * 后两者保证 meta 化/截断后的结果仍可参与去重和熔断计数。
 */
function resolveReadPath(item: ToolResultItemView): string | null {
  if (item.toolName !== 'read_file' && item.toolName !== 'Read') return null;
  const r = asRecord(item.output);
  if (typeof r?.path === 'string' && r.path.length > 0) return r.path;
  const inp = asRecord(item.input);
  const fromInput = firstString(inp?.filePath, inp?.file_path, inp?.path);
  if (fromInput) return fromInput;
  if (typeof item.output === 'string') {
    const m = item.output.match(/^Read (.+?) → /);
    if (m && m[1].length > 0) return m[1];
  }
  return null;
}

/**
 * 读取分析：同文件重复读的更早副本进 stale 集（只保留最后一次完整输出）,
 * 并返回每个路径最后一次读取所在的消息索引（供 pin / 去重判定）。
 */
function analyzeReads(views: ToolResultView[]): {
  staleIndices: Set<number>;
  lastReadIndexByPath: Map<string, number>;
} {
  const lastReadIndexByPath = new Map<string, number>();
  const perPathIndices = new Map<string, number[]>();

  views.forEach((v, i) => {
    if (v.toolResults.length === 0) return;
    if (v.toolResults.every((tr) => tr.isCompacted)) return;
    for (const item of v.toolResults) {
      if (item.isCompacted) continue;
      const path = resolveReadPath(item);
      if (!path) continue;
      lastReadIndexByPath.set(path, i);
      const list = perPathIndices.get(path) ?? [];
      list.push(i);
      perPathIndices.set(path, list);
    }
  });

  const staleIndices = new Set<number>();
  for (const [path, indices] of perPathIndices) {
    const keep = lastReadIndexByPath.get(path);
    for (const idx of indices) {
      if (idx !== keep) staleIndices.add(idx);
    }
  }
  return { staleIndices, lastReadIndexByPath };
}

/**
 * 读循环熔断：统计每个文件的读取总次数（含已 meta 化的历史副本——
 * 它们正是循环的证据），达到阈值 → 自动 pin + 遥测上报（每文件一次）。
 * 压缩系统对自身副作用的最小反馈闭环。
 */
function detectReadLoops(views: ToolResultView[], opts?: LifecycleOptions): void {
  const ledger = opts?.ledger;
  if (!ledger) return;

  const counts = new Map<string, number>();
  for (const v of views) {
    for (const item of v.toolResults) {
      const path = resolveReadPath(item);
      if (!path) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
      // 可观测闭环:re-read 一个曾被 meta 化的路径 = 压缩过头信号。
      // 区别于读循环(按次数),这是"压缩删了模型要的内容,模型回头重读"。
      if (ledger.wasCompacted(path) && ledger.recordReRead(path)) {
        logger.warn('Lifecycle', `Overcompaction detected: ${path} re-read after meta-ization - auto-pinning`);
        opts?.telemetry?.recordOvercompactionDetected({ path, autoPinned: true });
      }
    }
  }

  for (const [path, count] of counts) {
    if (count < READ_LOOP_THRESHOLD) continue;
    ledger.autoPin(path, count);
    if (ledger.shouldReportLoop(path)) {
      logger.warn(
        'Lifecycle',
        `Read loop detected: ${path} read ${count} times — auto-pinned (latest read kept in full)`,
      );
      opts?.telemetry?.recordReadLoopDetected({ path, readCount: count, autoPinned: true });
    }
  }
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

/** read_file 类工具:输出本身就是磁盘文件,落盘相当于同一份文件存两份。
 *  meta 已含原文件路径,模型可直接 re-read 原文件找回,不需要冗余副本。 */
function isFileReadTool(toolName: string): boolean {
  return toolName === 'read_file' || toolName === 'Read';
}

/** 语义类工具:输出是模型主动要看的内容(而非命令回显等瞬态输出),
 *  超大时可见截断而非 meta 化——meta 化等于把模型要的信息抹掉。 */
function isSemanticTool(toolName: string): boolean {
  return (
    isFileReadTool(toolName) ||
    toolName === 'read_wiki_page' ||
    toolName === 'ReadWikiPage' ||
    toolName === 'lint_wiki'
  );
}

/** 单条工具结果是否可压缩（按工具名判定） */
function isResultCompactable(toolName: string, config: LifecycleConfig): boolean {
  if (config.protectedTools.has(toolName)) return false;

  if (config.compactableTools !== null) {
    return config.compactableTools.has(toolName);
  }

  if (DEFAULT_COMPACTABLE.has(toolName)) return true;
  if (toolName.startsWith('mcp_') || toolName.startsWith('MCP_')) return true;
  if (toolName.startsWith('connector_') || toolName.startsWith('Connector_')) return true;

  return false;
}

// ============================================================
// Tool Meta Extractors
// ============================================================
// 设计要点(见 docs/compaction-redesign.md §2.2 不变式 1/2):
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

/**
 * 最后一条含未压缩 tool-result 的消息索引（= 当前步的结果）。
 * 感知-行动环保护的对象；无工具结果时返回 -1。
 */
function findLastToolResultIndex(views: ToolResultView[]): number {
  for (let i = views.length - 1; i >= 0; i--) {
    const v = views[i];
    if (v.toolResults.length > 0 && v.toolResults.some((tr) => !tr.isCompacted)) {
      return i;
    }
  }
  return -1;
}

// ============================================================
// 统一分配器入口（差距一：合并四层为一条降级阶梯）
// ============================================================
// manageCompaction 是压缩的唯一入口：Layer 2(value 降级) -> 估算 -> 按预算
// 选档(确定性摘要 / LLM 摘要 / 强制截断)。不变式在入口统一强制,不再由
// compactBeforeStep 编排多层独立 evictor。见 docs/compaction-redesign.md。

export interface CompactionContext {
  model?: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName: string;
  contextLimit?: number;
  instructions?: string;
  tools?: Record<string, Tool>;
  storage?: LifecycleStorage;
  ledger?: ContextLedger;
  telemetry?: CompactionTelemetry;
  compactionView?: CompactionView;
  /** 会话级压缩步数计数器（跨 API 调用持久），用于 TTL 老化 */
  compactionStep?: { current: number };
}

export interface ManageCompactionResult {
  messages: import('ai').ModelMessage[];
  tokensFreed: number;
  persistence?: Promise<void>;
  /** 全量估算结果（供调用方发送水位 / 更新缓存） */
  estimation?: FullRequestEstimation;
}

/**
 * 统一压缩分配器：按预算压力选档位，不变式贯穿所有档位。
 *
 * 降级阶梯（只作用于 value，key 永不降级）：
 * 1. Layer 2：tool-result value 降级（截断/meta），key 保留。同步。
 * 2. 估算超限 -> 确定性摘要（Layer 2.5 策略）：消息级降级，保留首尾含当前步。
 * 3. 还超限 -> LLM 摘要（Layer 3 策略）：前缀替换，附 action log provenance。
 * 4. 还超限 -> 强制截断：保底。
 *
 * 不变式（Layer 2 强制，2.5/3 策略遵守）：
 * key 永不降级 / 当前步永不 meta/不摘要 / 语义类截断不 meta / 读循环熔断 autoPin。
 */
export async function manageCompaction(
  messages: import('ai').ModelMessage[],
  config: LifecycleConfig,
  context: CompactionContext,
): Promise<ManageCompactionResult> {
  let current = messages;
  let tokensFreed = 0;
  let persistence: Promise<void> | undefined;
  const startTime = Date.now();

  // 档位 1：Layer 2 - tool-result value 降级（同步，微秒级）
  const lifecycleResult = manageToolOutputLifecycle(current, config, context.storage, {
    ledger: context.ledger,
    telemetry: context.telemetry,
    compactionStep: context.compactionStep,
  });
  current = lifecycleResult.messages;
  tokensFreed += lifecycleResult.tokensFreed;
  if (lifecycleResult.persistence) {
    await lifecycleResult.persistence;
    persistence = lifecycleResult.persistence;
  }

  // Layer 2 UI 通知
  context.telemetry?.notifyUI({
    layer: 'lifecycle',
    messagesAffected: tokensFreed > 0 ? 1 : 0, // Layer 2 是整体操作，有释放就算有影响
    tokensSaved: tokensFreed,
    strategy: 'meta',
    durationMs: Date.now() - startTime,
  });

  // 估算 + 按预算升档(用 estimateRequestBudget:含校准 buffer + 策略触发线)
  let estimation: RequestBudgetEstimation | undefined;
  if (context.tools && context.instructions) {
    estimation = await estimateRequestBudget(
      current, context.instructions, context.tools, context.modelName, context.contextLimit,
    );

    // 触发语义(见 compaction-redesign.md L1):总量+校准buffer 达到触发线即主动
    // 升档(不再等 100% 超限);达到硬限用更激进的目标水位。
    if (estimation.shouldTrigger && context.model) {
      const targetPercent = estimation.shouldForce ? EMERGENCY_TARGET_PERCENT : DEFAULT_TARGET_PERCENT;
      // 消息预算 = 目标请求 − 固定开销(instructions+tools+outputReserve),带下限保护
      // (见 compaction-redesign.md 5.4:小窗口下防止消息预算为 0 → 全历史摘要化)
      const targetRequestTokens = targetTokensFor(estimation.modelLimit, targetPercent);
      const fixedOverhead = estimation.instructionsTokens + estimation.toolsTokens + estimation.outputReserve;
      const messageTarget = messageTargetTokensFor(targetRequestTokens, fixedOverhead);
      if (targetRequestTokens - fixedOverhead < MIN_MESSAGE_BUDGET_TOKENS) {
        logger.warn(
          'Compaction',
          `消息预算触底: limit=${estimation.modelLimit}, 固定开销=${fixedOverhead} ` +
          `(inst=${estimation.instructionsTokens}+tools=${estimation.toolsTokens}+out=${estimation.outputReserve}), ` +
          `目标请求=${targetRequestTokens}, 消息目标强制 ${MIN_MESSAGE_BUDGET_TOKENS}`,
        );
      }
      logger.warn(
        'Compaction',
        `Layer 2 后达触发线 (${estimation.utilizationPercent.toFixed(1)}%${estimation.shouldForce ? ', HARD LIMIT' : ''})，升档至紧急压缩`,
      );
      current = await applyEmergencyCompression(current, {
        model: context.model,
        fallbackModels: context.fallbackModels,
        modelName: context.modelName,
        contextLimit: context.contextLimit,
        tools: context.tools,
        instructions: context.instructions,
        // 目标水位从统一策略推导(触发 0.7 / 硬限 0.6),再扣固定开销得消息预算
        targetTokens: messageTarget,
        compactionView: context.compactionView,
        telemetry: context.telemetry,
      });
    }
  }

  return { messages: current, tokensFreed, persistence, estimation };
}

/**
 * 紧急压缩：确定性摘要 -> LLM 摘要 -> 强制截断。
 * 导出供 budget-check.ts 初始预算检查复用。
 */
export async function applyEmergencyCompression(
  messages: import('ai').ModelMessage[],
  context: {
    model: LanguageModelV3;
    fallbackModels?: LanguageModelV3[];
    modelName: string;
    contextLimit?: number;
    tools: Record<string, Tool>;
    instructions: string;
    targetTokens: number;
    compactionView?: CompactionView;
    telemetry?: CompactionTelemetry;
  },
): Promise<import('ai').ModelMessage[]> {
  let current = messages;
  const startTime = Date.now();

  // 档位 2：确定性摘要（Layer 2.5 策略）
  logger.info('Compaction', '档位 2: 确定性文本压缩');
  const deterministicResult = await compressMessagesDeterministic(
    current, context.targetTokens, context.modelName,
  );
  current = deterministicResult.messages;

  const afterDeterministic = await estimateFullRequest(
    current, context.instructions, context.tools, context.modelName, context.contextLimit,
  );
  if (!afterDeterministic.exceedsLimit) {
    logger.info(
      'Compaction',
      `确定性摘要成功: 释放 ${deterministicResult.tokensFreed} tokens，降至 ${afterDeterministic.utilizationPercent.toFixed(1)}%`,
    );
    context.telemetry?.notifyUI({
      layer: 'emergency',
      messagesAffected: deterministicResult.messagesCompressed,
      tokensSaved: deterministicResult.tokensFreed,
      strategy: 'summarize',
      durationMs: Date.now() - startTime,
    });
    return current;
  }

  // 档位 3：LLM 摘要（Layer 3 策略）
  logger.warn(
    'Compaction',
    `确定性摘要后仍超限 (${afterDeterministic.utilizationPercent.toFixed(1)}%)，升档至 LLM 摘要`,
  );
  const summaryResult = await emergencySummarize(current, {
    model: context.model,
    fallbackModels: context.fallbackModels,
    // 紧急摘要目标从统一策略取（与 targetTokensFor 同源）
    targetPercent: EMERGENCY_TARGET_PERCENT,
  });

  if (summaryResult.success) {
    current = summaryResult.messages;

    if (context.compactionView && summaryResult.summaryMessage && summaryResult.anchorIndex != null) {
      updateViewAfterL3(
        context.compactionView,
        summaryResult.summaryMessage,
        summaryResult.anchorIndex,
        messages[summaryResult.anchorIndex],
        summaryResult.summaryText!,
      );
      logger.debug('Compaction', `View updated: anchorIndex=${summaryResult.anchorIndex}`);
    }

    const reason = !context.compactionView?.summary ? 'no_view' : 'budget_exceeded';
    context.telemetry?.recordLayer3Triggered({
      reason,
      messagesBeforeCompaction: messages.length,
      messagesAfterCompaction: current.length,
      durationMs: 0,
    });

    const afterSummary = await estimateFullRequest(
      current, context.instructions, context.tools, context.modelName, context.contextLimit,
    );
    if (!afterSummary.exceedsLimit) {
      logger.info('Compaction', `LLM 摘要成功: 降至 ${afterSummary.utilizationPercent.toFixed(1)}%`);
      context.telemetry?.notifyUI({
        layer: 'emergency',
        messagesAffected: messages.length - current.length,
        tokensSaved: afterSummary.availableBudget,
        strategy: 'summarize',
        durationMs: Date.now() - startTime,
      });
      return current;
    }
  }

  // 档位 4：强制截断（保底）
  logger.error('Compaction', '所有档位失败，执行强制截断（保底）');
  const truncated = await forceTruncateMessages(
    current, 0.15, context.modelName, context.targetTokens, messages,
  );
  context.telemetry?.notifyUI({
    layer: 'emergency',
    messagesAffected: current.length - truncated.length,
    tokensSaved: 0, // 截断场景下 token 估算不稳定，不报具体数字
    strategy: 'force-truncate',
    durationMs: Date.now() - startTime,
  });
  return truncated;
}
