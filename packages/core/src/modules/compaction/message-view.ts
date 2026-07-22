// ============================================================
// Compaction — Unified Message View
// ============================================================
// compaction 代码对消息的"读"很宽（要识别工具结果、文本、
// 错误标记、文件路径），但"写"极窄——唯一的变更是把某个工具
// 输出替换为摘要字符串并打上 _compacted 标记。
//
// 本模块把格式知识收敛到两个函数：
//   extractToolResultView(msg) → 统一的只读视图
//   applyCompactionPatches(msg, patches) → 写回压缩结果
//
// 其余 compaction 逻辑（老化、去重、价值感知、决策）全部
// 通过视图操作，完全不需要知道底层是 .content 还是 .parts。
//
// 设计决策：不做完整消息格式转换（normalize→denormalize往返），
// 因为 UIMessage 的 part 类型是开放集合，穷举所有类型进行无损
// 往返会产生"漏一种就静默丢数据"的同类错误模式。视图只需识别
// compaction 关心的字段；不认识的 part/content 在补丁写回时
// 原样保留——天然无损。见 docs/compaction-unification-design.md。
// ============================================================

import type { PipelineMessage } from '../../services/config/compaction-types';
import { getToolOutputString, unwrapOutput } from './message-utils';

// ============================================================
// View Types
// ============================================================

/** 单条工具结果在视图中的表示——与底层格式无关 */
export interface ToolResultItemView {
  /** 工具名（统一：从 .toolName 字段或 type 前缀截取） */
  toolName: string;
  /** 工具调用 ID（用于持久化关联） */
  toolCallId?: string;
  /** 工具原始输出值（已 unwrap，用于 extractToolMeta） */
  output: unknown;
  /** 输出序列化文本（用于持久化落盘） */
  outputRaw: string;
  /** 工具输入参数（UIMessage 有 .input，ModelMessage 无此字段） */
  input?: unknown;
  /** 输出序列化后的字符长度 */
  outputSize: number;
  /** 是否为错误结果（失败的工具输出体积小但信息密度高，不应压缩） */
  isError: boolean;
  /** 是否已压缩 */
  isCompacted: boolean;
  /** 在原始消息数组中的位置索引（供 patching 回写） */
  refIndex: number;
}

/** 一条消息的 compaction 视图 */
export interface ToolResultView {
  /** 消息角色 */
  role: string;
  /** 消息 ID */
  id?: string;
  /** 格式标记：ui = .parts, model = .content */
  format: 'ui' | 'model';
  /** 工具结果列表（已去除非工具条目） */
  toolResults: ToolResultItemView[];
  /** 所有文本内容的拼接（用于摘要器 / 引用检测） */
  textContent: string;
  /** 文本分片（用于 token 批量计数；textContent = textChunks.join('\n')） */
  textChunks: string[];
}

/** 一条压缩补丁：描述对原始消息中某个条目的替换 */
export interface CompactionPatch {
  /** 在 .content 或 .parts 数组中的位置 */
  refIndex: number;
  /** 替换后的摘要文本 */
  summary: string;
}

// ============================================================
// Read: extractToolResultView
// ============================================================

/**
 * 从 PipelineMessage（UIMessage 或 ModelMessage）提取统一的
 * 工具结果视图。这是 compaction 代码**唯一**需要判断消息格式
 * 的地方——所有下游函数只操作此视图。
 */
export function extractToolResultView(msg: PipelineMessage): ToolResultView {
  // ---- detect format ----
  const raw = msg as unknown as Record<string, unknown>;
  const parts = raw.parts;
  if (Array.isArray(parts)) {
    return buildViewFromUIMessage(msg, parts as Record<string, unknown>[]);
  }
  const content = raw.content;
  if (Array.isArray(content)) {
    return buildViewFromModelMessage(msg, content as Record<string, unknown>[]);
  }
  // 字符串 content / 无 content / 格式无法识别 → 视为无工具结果
  return emptyView(msg, 'model');
}

// ============================================================
// Write: applyCompactionPatches
// ============================================================

/**
 * 将压缩补丁写回消息——唯一的"写格式"判断点。
 *
 * UIMessage 分支：替换对应 part 的 output，保留 type/state/input 等字段
 * ModelMessage 分支：替换对应 content 项的 output
 * 不认识的条目 → 原样保留（天然无损）
 *
 * @returns 写回后的消息与释放的 token 估算
 */
export function applyCompactionPatches(
  msg: PipelineMessage,
  patches: CompactionPatch[],
): { patched: PipelineMessage; freed: number } {
  if (patches.length === 0) return { patched: msg, freed: 0 };

  const raw = msg as unknown as Record<string, unknown>;
  const parts = raw.parts;
  if (Array.isArray(parts)) {
    return applyToUIMessage(msg, parts as Record<string, unknown>[], patches);
  }
  const content = raw.content;
  if (Array.isArray(content)) {
    return applyToModelMessage(msg, content as Record<string, unknown>[], patches);
  }
  return { patched: msg, freed: 0 };
}

// ============================================================
// Internal: UIMessage view builder
// ============================================================

function buildViewFromUIMessage(
  msg: PipelineMessage,
  parts: Record<string, unknown>[],
): ToolResultView {
  const toolResults: ToolResultItemView[] = [];
  const textChunks: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const partType = (p.type as string) ?? '';

    // 文本类 part
    if (partType === 'text' || partType === 'reasoning') {
      const t = p.text as string | undefined;
      if (t) textChunks.push(t);
      continue;
    }

    // 工具结果 part
    if ((partType.startsWith('tool-') || partType === 'dynamic-tool') && p.state === 'output-available') {
      const outputStr = getToolOutputString(p.output);
      if (outputStr) textChunks.push(outputStr);
      // 工具输入也计入 token 估算
      if (p.input !== undefined && p.input !== null) {
        try { textChunks.push(JSON.stringify(p.input)); } catch { /* ignore */ }
      }

      toolResults.push({
        toolName: getItemToolName(p),
        toolCallId: p.toolCallId as string | undefined,
        output: unwrapOutput(p.output),
        outputRaw: outputStr,
        input: p.input,
        outputSize: outputStr.length,
        isError: detectError(unwrapOutput(p.output)),
        isCompacted: p._compacted === true,
        refIndex: i,
      });
    }
    // file / source-* / data-* / step-start 等 → 忽略（compaction 不关心）
  }

  return {
    role: msg.role,
    id: (msg as unknown as { id?: string }).id,
    format: 'ui',
    toolResults,
    textContent: textChunks.join('\n'),
    textChunks,
  };
}

// ============================================================
// Internal: ModelMessage view builder
// ============================================================

function buildViewFromModelMessage(
  msg: PipelineMessage,
  content: Record<string, unknown>[],
): ToolResultView {
  const toolResults: ToolResultItemView[] = [];
  const textChunks: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const itemType = (c.type as string) ?? '';

    // 文本
    if (itemType === 'text') {
      const t = c.text as string | undefined;
      if (t) textChunks.push(t);
      continue;
    }

    // 工具调用
    if (itemType === 'tool-call') {
      const toolName = typeof c.toolName === 'string' ? c.toolName : '';
      if (toolName) textChunks.push(`[tool-call: ${toolName}]`);
      if (c.args !== undefined && c.args !== null) {
        try { textChunks.push(JSON.stringify(c.args)); } catch { /* ignore */ }
      }
      continue;
    }

    // 工具结果
    if (itemType === 'tool-result') {
      const outputStr = getToolOutputString(c.output);
      if (outputStr) textChunks.push(outputStr);
      toolResults.push({
        toolName: (c.toolName as string) ?? '',
        toolCallId: c.toolCallId as string | undefined,
        output: unwrapOutput(c.output),
        outputRaw: outputStr,
        input: undefined,
        outputSize: outputStr.length,
        isError: detectError(unwrapOutput(c.output)),
        isCompacted: c._compacted === true,
        refIndex: i,
      });
    }
  }

  return {
    role: msg.role,
    id: (msg as unknown as { id?: string }).id,
    format: 'model',
    toolResults,
    textContent: textChunks.join('\n'),
    textChunks,
  };
}

// ============================================================
// Internal: Patch applicators
// ============================================================

function applyToUIMessage(
  msg: PipelineMessage,
  parts: Record<string, unknown>[],
  patches: CompactionPatch[],
): { patched: PipelineMessage; freed: number } {
  const patchMap = new Map(patches.map((p) => [p.refIndex, p.summary]));
  let freed = 0;

  const newParts = parts.map((part, i) => {
    const summary = patchMap.get(i);
    if (summary === undefined) return part;

    const partType = (part.type as string) ?? '';
    if (!partType.startsWith('tool-') && partType !== 'dynamic-tool') return part;
    if (part.state !== 'output-available') return part;

    const resultStr = getToolOutputString(part.output);
    freed += Math.max(0, resultStr.length - summary.length);

    return {
      ...part,
      output: { type: 'text', value: summary },
      _compacted: true,
      _originalSize: resultStr.length,
    };
  });

  return {
    patched: { ...msg, parts: newParts } as PipelineMessage,
    freed,
  };
}

function applyToModelMessage(
  msg: PipelineMessage,
  content: Record<string, unknown>[],
  patches: CompactionPatch[],
): { patched: PipelineMessage; freed: number } {
  const patchMap = new Map(patches.map((p) => [p.refIndex, p.summary]));
  let freed = 0;

  const newContent = content.map((item, i) => {
    const summary = patchMap.get(i);
    if (summary === undefined) return item;
    if (item.type !== 'tool-result') return item;
    if (item._compacted === true) return item;

    const resultStr = getToolOutputString(item.output);
    freed += Math.max(0, resultStr.length - summary.length);

    return {
      ...item,
      output: { type: 'text', value: summary },
      _compacted: true,
      _originalSize: resultStr.length,
    };
  });

  return {
    patched: { ...msg, content: newContent } as PipelineMessage,
    freed,
  };
}

// ============================================================
// Shared Helpers
// ============================================================

/** 从 UIMessage part 或 ModelMessage content 项提取工具名 */
function getItemToolName(item: Record<string, unknown>): string {
  if (typeof item.toolName === 'string' && item.toolName.length > 0) return item.toolName;
  // UIMessage typed part: type = "tool-read_file" → toolName = "read_file"
  const partType = (item.type as string) ?? '';
  if (partType.startsWith('tool-')) return partType.slice('tool-'.length);
  return '';
}

/** 检测工具输出是否为错误（不应压缩的错误保护） */
function detectError(output: unknown): boolean {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false;
  const r = output as Record<string, unknown>;
  if (r.error === true) return true;
  if (r.success === false) return true;
  if (typeof r.exitCode === 'number' && r.exitCode !== 0) return true;
  return false;
}

function emptyView(msg: PipelineMessage, format: 'ui' | 'model'): ToolResultView {
  return {
    role: msg.role,
    id: (msg as unknown as { id?: string }).id,
    format,
    toolResults: [],
    textContent: '',
    textChunks: [],
  };
}

// ============================================================
// Summary Message Builder（统一构造，消除双轨格式隐患）
// ============================================================
// 事故(2026-07-21):context-window.ts 用 .content 构造摘要，经
// budgetCheck.adjustedMessages 泄漏到 route 层 → msg.parts
// is not iterable 崩溃。收敛到一处，调用方显式声明目标格式。
// 见 docs/compaction-unification-design.md §2。
// ============================================================

const SUMMARY_ID_PREFIX = 'summary-';

const SUMMARY_PREAMBLE =
  'This session is being continued from a previous conversation that ran out of context. ' +
  'The summary below covers the earlier portion of the conversation.\n\n';

export function buildSummaryMessage(
  summary: string,
  format: 'ui' | 'model',
): PipelineMessage {
  const bodyText = SUMMARY_PREAMBLE + summary;
  const id = `${SUMMARY_ID_PREFIX}${Date.now()}`;

  if (format === 'ui') {
    return {
      id,
      role: 'user',
      parts: [{ type: 'text', text: bodyText }],
    } as PipelineMessage;
  }
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: bodyText }],
  } as PipelineMessage;
}

// ============================================================
// Re-exports (convenience)
// ============================================================

export { getItemToolName, detectError };
