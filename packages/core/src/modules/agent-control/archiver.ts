// ============================================================
// Archiver - 子任务归档器（Task Paradigm Redesign §5）
// ============================================================
// 子任务完成时，在 prepareStep 边界用该子任务的消息切片调 LLM 提炼结构化
// {tool_chain, conclusion, key_facts}，写入 todo.metadata.facts（不改 result 字符串）。
// 同步 await（checkpoint 竞态教训）；每子任务边界一次额外 LLM 调用（成本已记录）。
// 见 docs/task-paradigm-redesign.md §5。

import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { TodoStore, Todo } from '../todos/types';
import { logger } from '../../primitives/logger';

/** 归档提炼出的结构化事实（写入 todo.metadata.facts） */
export interface SubtaskFacts {
  tool_chain: string;
  conclusion: string;
  key_facts: unknown[];
}

const ARCHIVE_PROMPT = `你是一个任务结果摘要助手。请将以下子任务的执行过程和结果提炼为 JSON：
1. tool_chain：工具链摘要（≤100 字符），如 "read_file ×3, search ×1"
2. conclusion：最终结论（≤300 字符）
3. key_facts：结构化关键事实列表（JSON 数组），如 [{"type":"file","path":"/src/main.py"}]

只输出 JSON 对象，不要前缀或解释。`;

/** 从消息切片渲染可读文本（assistant 文本 + 工具输出），供摘要 LLM 阅读 */
export function renderSubtaskText(messages: import('ai').ModelMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.content.trim()) lines.push(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as Record<string, unknown>;
        if (p.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
          lines.push(p.text);
        } else if (
          (typeof p.type === 'string' && p.type.startsWith('tool-')) ||
          p.type === 'tool-result' ||
          p.type === 'tool-call'
        ) {
          const out = p.output;
          if (out != null) {
            lines.push(typeof out === 'string' ? out : JSON.stringify(out));
          }
        }
      }
    }
  }
  return lines.join('\n');
}

/** 从 LLM 文本解析 facts JSON（容忍代码围栏） */
export function parseFactsJson(text: string): SubtaskFacts | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<SubtaskFacts>;
    if (typeof obj.tool_chain !== 'string' || typeof obj.conclusion !== 'string') return null;
    return {
      tool_chain: obj.tool_chain,
      conclusion: obj.conclusion,
      key_facts: Array.isArray(obj.key_facts) ? obj.key_facts : [],
    };
  } catch {
    return null;
  }
}

export interface ArchiveOptions {
  model: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName?: string;
}

/**
 * 从已渲染文本提炼事实（LLM 调用；失败返回 null）。
 * 首败重试复用同一文本输入，保证重试与首次提炼使用完全相同的输入内容。
 */
export async function summarizeFactsFromText(text: string, opts: ArchiveOptions): Promise<SubtaskFacts | null> {
  if (!text.trim()) return null;

  const candidates = [opts.model, ...(opts.fallbackModels ?? [])];
  for (const model of candidates) {
    try {
      const { text: out } = await generateText({
        model,
        instructions: ARCHIVE_PROMPT,
        prompt: text,
        maxOutputTokens: 500,
      });
      const facts = out ? parseFactsJson(out) : null;
      if (facts) return facts;
    } catch {
      // 尝试下一个模型
    }
  }
  return null;
}

/**
 * 提炼子任务事实（LLM 调用；失败返回 null，由调用方决定兜底）。
 */
export async function extractSubtaskFacts(
  messages: import('ai').ModelMessage[],
  opts: ArchiveOptions,
): Promise<SubtaskFacts | null> {
  return summarizeFactsFromText(renderSubtaskText(messages), opts);
}

/** 判断 todo 是否已写入结构化 facts（供归档重试去重） */
export function hasSubtaskFacts(todo: Todo): boolean {
  const facts = (todo.metadata as Record<string, unknown>).facts;
  return (
    !!facts &&
    typeof facts === 'object' &&
    typeof (facts as { conclusion?: unknown }).conclusion === 'string' &&
    ((facts as { conclusion: string }).conclusion.trim() !== '')
  );
}

export interface RetryArchiveDeps {
  store: TodoStore;
  model: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName?: string;
  /** 重试仍失败时回调（用于上抛 archiving_failed 事件） */
  onRetryFailed?: (todoId: string) => void;
}

/**
 * 重试归档失败的子任务（每个 todo 最多重试一次）。
 * 输入 pending 为 todoId → 已渲染子任务文本 的映射（首败时缓存）。
 * 对已完成但缺 facts 的 todo 用同一文本重新提炼：
 * - 成功 → 写 facts，清出队列
 * - 失败 → 回调 onRetryFailed，清出队列（不再重试）
 * - todo 已不存在 / 非 completed / 已有 facts → 清出队列（无需重试）
 * 返回实际重试过的 todoId 列表。
 */
export async function retryPendingArchives(
  pending: Map<string, string>,
  deps: RetryArchiveDeps,
): Promise<string[]> {
  const retried: string[] = [];
  for (const [todoId, text] of pending) {
    const todo = deps.store.getTodo(todoId);
    if (!todo || todo.status !== 'completed' || hasSubtaskFacts(todo)) {
      pending.delete(todoId);
      continue;
    }
    const facts = await summarizeFactsFromText(text, {
      model: deps.model,
      fallbackModels: deps.fallbackModels,
      modelName: deps.modelName,
    });
    if (facts) {
      deps.store.updateTodo({ id: todoId, metadata: { facts } });
    } else {
      deps.onRetryFailed?.(todoId);
      logger.warn('Archiver', `[archiving_failed] 子任务 ${todoId} 归档重试仍失败，跳过（保留 result）`);
    }
    pending.delete(todoId); // 最多重试一次
    retried.push(todoId);
  }
  return retried;
}

/**
 * 归档子任务：提炼 facts 并写入 todo.metadata.facts（保留 result 字符串）。
 * LLM 失败/无法提炼 → 跳过写 facts（避免不完整 facts 污染索引池），
 * 记录 archiving_failed 告警，只保留 result 字符串。
 * 返回写入的 facts；失败返回 null。
 */
export async function archiveSubtask(
  store: TodoStore,
  todoId: string,
  messages: import('ai').ModelMessage[],
  opts: ArchiveOptions,
): Promise<SubtaskFacts | null> {
  const text = renderSubtaskText(messages);
  if (!text.trim()) return null;
  const facts = await extractSubtaskFacts(messages, opts);
  if (!facts) {
    logger.warn('Archiver', `[archiving_failed] 子任务 ${todoId} 事实归档失败，跳过写 facts（保留 result）`);
    return null;
  }
  store.updateTodo({ id: todoId, metadata: { facts } });
  return facts;
}
