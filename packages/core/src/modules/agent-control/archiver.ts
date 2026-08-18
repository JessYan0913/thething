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

const ARCHIVE_PROMPT = `你是一个任务结果摘要助手。请将以下子任务的执行过程和结果提炼为单个 JSON 对象，结构必须严格为：
{"tool_chain": "工具链摘要（≤100 字符，如 read_file ×3, search ×1）", "conclusion": "最终结论（≤300 字符）", "key_facts": [结构化关键事实，最多 5 条，每条形如 {"type":"file","path":"/src/main.py"}]}

要求：
- 只输出这一个 JSON 对象本身，不要 markdown 代码围栏、不要任何前后缀或说明文字。
- key_facts 最多 5 条；conclusion 必须是一条完整结论（非过程叙述）。`;

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

/** 提取文本中首个 `{` 到最后一个 `}` 的 JSON 对象子串（容忍前后缀说明文字） */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** 从 LLM 文本解析 facts JSON（容忍代码围栏 + 前后缀说明文字） */
export function parseFactsJson(text: string): SubtaskFacts | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  for (const candidate of [cleaned, extractJsonObject(cleaned)]) {
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate) as Partial<SubtaskFacts>;
      if (typeof obj.tool_chain === 'string' && typeof obj.conclusion === 'string') {
        return {
          tool_chain: obj.tool_chain,
          conclusion: obj.conclusion,
          key_facts: Array.isArray(obj.key_facts) ? obj.key_facts : [],
        };
      }
    } catch {
      // fallthrough to next candidate
    }
  }
  return null;
}

export interface ArchiveOptions {
  model: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName?: string;
}

/** 归档提炼失败原因（写进 [archiving_failed] 日志，便于区分配额/超时/格式等） */
export type ArchiveFailureReason =
  | 'empty_input'
  | 'empty_response'
  | 'invalid_response'
  | 'quota_exceeded'
  | 'timeout'
  | 'api_error';

/** 把 LLM 调用异常归类为可诊断的原因 */
function classifyApiError(err: unknown): ArchiveFailureReason {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: number; name?: string; message?: string };
    const msg = typeof e.message === 'string' ? e.message : '';
    if (e.statusCode === 429 || /quota|exceeded.*(?:usage|limit|quota)|(?:usage|limit|quota).*exceeded/i.test(msg)) {
      return 'quota_exceeded';
    }
    if (/timeout|timed out|abort/i.test(msg)) return 'timeout';
    if (e.name === 'InvalidResponseError' || e.name === 'JSONParseError') return 'invalid_response';
  }
  return 'api_error';
}

export interface SummarizeFactsResult {
  facts: SubtaskFacts | null;
  /** 失败原因（成功时 undefined）。quota/timeout/invalid_response/api_error/... */
  reason?: ArchiveFailureReason;
}

/**
 * 从已渲染文本提炼事实（LLM 调用；失败返回 null + 失败原因）。
 * 首败重试复用同一文本输入，保证重试与首次提炼使用完全相同的输入内容。
 * 配额耗尽（quota_exceeded）时对全部候选模型（同一账号/provider）都生效，
 * 继续尝试只会制造无意义调用，故中断候选循环。
 */
export async function summarizeFactsFromText(text: string, opts: ArchiveOptions): Promise<SummarizeFactsResult> {
  if (!text.trim()) return { facts: null, reason: 'empty_input' };

  const candidates = [opts.model, ...(opts.fallbackModels ?? [])];
  let reason: ArchiveFailureReason | undefined;
  for (const model of candidates) {
    try {
      const { text: out } = await generateText({
        model,
        instructions: ARCHIVE_PROMPT,
        prompt: text,
        maxOutputTokens: 800,
        // 强制 OpenAI 兼容 provider 输出合法 JSON（非 OpenAI provider 忽略该选项，无回归）——
        // 从根上消除"纯散文/无效 JSON"导致的 invalid_response（蒸馏可靠性 P1）。
        // 注意：不用 Output.object() 结构化 schema——它要求 provider 支持且会改返回 shape，
        // 与 fallbackModels 兼容性有风险；response_format 足够保证合法 JSON。
        providerOptions: {
          openai: {
            response_format: { type: 'json_object' },
          },
        },
      });
      const facts = out ? parseFactsJson(out) : null;
      if (facts) return { facts };
      if (out?.trim()) {
        // 诊断：记录响应长/是否含 {}/输入长，便于区分截断/缺字段/纯散文三类根因（设计 P0）
        logger.warn(
          'Archiver',
          `[invalid_response] 响应无法解析为 facts JSON（响应长=${out.length}，含{=${out.includes('{')}}，含}=${out.includes('}')}，输入长=${text.length}），响应片段=${JSON.stringify(out.slice(0, 300))}`
        );
        reason = 'invalid_response';
      } else {
        reason = 'empty_response';
      }
    } catch (err) {
      reason = classifyApiError(err);
      if (reason === 'quota_exceeded') break;
    }
  }
  return { facts: null, reason };
}

/**
 * 提炼子任务事实（LLM 调用；失败返回 null + 失败原因，由调用方决定兜底）。
 */
export async function extractSubtaskFacts(
  messages: import('ai').ModelMessage[],
  opts: ArchiveOptions,
): Promise<SummarizeFactsResult> {
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
    const { facts, reason } = await summarizeFactsFromText(text, {
      model: deps.model,
      fallbackModels: deps.fallbackModels,
      modelName: deps.modelName,
    });
    if (facts) {
      deps.store.updateTodo({ id: todoId, metadata: { facts } });
    } else {
      deps.onRetryFailed?.(todoId);
      logger.warn('Archiver', `[archiving_failed] 子任务 ${todoId} 归档重试仍失败（原因=${reason ?? 'unknown'}），跳过（保留 result）`);
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
  const { facts, reason } = await extractSubtaskFacts(messages, opts);
  if (!facts) {
    logger.warn('Archiver', `[archiving_failed] 子任务 ${todoId} 事实归档失败（原因=${reason ?? 'unknown'}），跳过写 facts（保留 result）`);
    return null;
  }
  store.updateTodo({ id: todoId, metadata: { facts } });
  return facts;
}

/**
 * 批量触发归档（并行完成路径，设计决策 Q1）。
 * 并行子任务在子 Agent 内执行，父上下文没有其消息切片；executor 已把子 Agent 结论
 * 写入 todo.metadata.result（completeTodo）。此处以 result 作为归档输入，
 * 入队 pendingArchiveRetries，下一轮 prepareStep 经 retryPendingArchives 走与线性任务
 * 相同的 LLM 提炼→写 facts 路径（失败记 archiving_failed，保留 result）。
 * 返回实际入队的 todoId 列表。
 */
export function triggerArchiveForTodos(
  todoIds: string[],
  store: TodoStore,
  retries: Map<string, string>,
): string[] {
  const enqueued: string[] = [];
  for (const todoId of todoIds) {
    const todo = store.getTodo(todoId);
    if (!todo || todo.status !== 'completed' || hasSubtaskFacts(todo)) continue;
    const result = typeof todo.metadata.result === 'string' ? todo.metadata.result : '';
    if (!result.trim()) continue;
    retries.set(todoId, result);
    enqueued.push(todoId);
  }
  return enqueued;
}
