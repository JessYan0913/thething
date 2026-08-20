// ============================================================
// Force Splitter - 强制拆分器（Task Paradigm Redesign §6）
// ============================================================
// 子任务过大无法在独立上下文执行时，拆成 2-5 个更小的子任务。
// 主路径：最小上下文 generateText 拆分；失败/不足 2 个 → 兜底按句号/段落语义切分。
// 写回：取消当前 todo（保留 id）+ 创建新子任务。
// 见 docs/task-paradigm-redesign.md §6。

import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { TodoStore, Todo } from '../todos/types';
import { getLifecycle, type TodoRuntime } from '../todos/todo-runtime';

const SPLIT_PROMPT = `你是一个任务拆分助手。请将以下过大的子任务拆分为 2-5 个更小、更独立、可逐个在有限上下文内完成的子任务。
只输出 JSON 数组，每个元素为 {"subject":"子任务标题(祈使句)","verify":"完成标准(可执行，可选)"}。不要前缀或解释。`;

/** 兜底拆分：按句号/问号/换行切分，每段 ≤500 字符 */
export function fallbackSplit(text: string, maxLen = 500): string[] {
  const segments = text.split(/[。？！\n]/).filter((s) => s.trim().length > 0);
  const result: string[] = [];
  let current = '';
  for (const seg of segments) {
    if (current.length + seg.length > maxLen) {
      if (current.trim()) result.push(current.trim());
      current = seg;
    } else {
      current += seg;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/** 从 LLM 文本解析子任务数组（容忍代码围栏）；失败返回 null */
export function parseSplitJson(text: string): Array<{ subject: string; verify?: string }> | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return null;
    const items = arr
      .filter((x) => x && typeof x.subject === 'string' && x.subject.trim())
      .map((x) => ({ subject: (x.subject as string).trim(), verify: typeof x.verify === 'string' ? x.verify : undefined }));
    return items.length >= 2 ? items : null;
  } catch {
    return null;
  }
}

/** LLM 拆分尝试；失败/不足 2 个返回 null */
async function llmSplit(subject: string, model: LanguageModelV3): Promise<Array<{ subject: string; verify?: string }> | null> {
  try {
    const { text } = await generateText({
      model,
      instructions: SPLIT_PROMPT,
      prompt: `请拆分：${subject}`,
      maxOutputTokens: 500,
    });
    return text ? parseSplitJson(text) : null;
  } catch {
    return null;
  }
}

export interface SplitTodoOptions {
  model?: LanguageModelV3;
  /** 统一写入口：取消/创建经 runtime（记录 lifecycle.split）。缺省回落 store 直写。 */
  runtime?: TodoRuntime;
}

/**
 * 拆分过大的子任务：取消原 todo + 创建新子任务。
 * @returns 新建的子任务 id 列表；若无法拆出 ≥2 个（子任务已原子），返回空数组（调用方不应重试）
 */
export async function splitTodo(
  store: TodoStore,
  todo: Todo,
  opts: SplitTodoOptions = {},
): Promise<string[]> {
  let items: Array<{ subject: string; verify?: string }> | null = null;
  if (opts.model) {
    items = await llmSplit(todo.subject, opts.model);
  }
  if (!items) {
    const subjects = fallbackSplit(todo.subject);
    items = subjects.length >= 2 ? subjects.map((subject) => ({ subject })) : null;
  }
  if (!items) return []; // 已原子，无法拆分

  // 取消原 todo（保留 id）+ 创建新子任务（经 runtime：记录 lifecycle.split / createdBy=splitter）
  const parentLifecycle = getLifecycle(todo);
  const rootTodoId = parentLifecycle.rootTodoId ?? todo.id;
  if (opts.runtime) {
    opts.runtime.cancelTodo(todo.id, 'split');
  } else {
    store.updateTodo({ id: todo.id, status: 'cancelled' });
  }

  const createdIds: string[] = [];
  for (const item of items.slice(0, 5)) {
    const created = store.createTodo({
      conversationId: todo.conversationId,
      subject: item.subject,
      metadata: {
        ...(item.verify ? { verify: item.verify } : {}),
        lifecycle: { createdBy: 'splitter', parentTodoId: todo.id, rootTodoId },
      },
    });
    createdIds.push(created.id);
  }

  // 在被取消的原 todo 上记录 supersededBy（仅生命周期合并，status 已由 runtime 处理）
  if (createdIds.length > 0) {
    const cancelled = store.getTodo(todo.id);
    if (cancelled) {
      store.updateTodo({
        id: todo.id,
        metadata: {
          lifecycle: { ...getLifecycle(cancelled), supersededBy: createdIds[0] },
        },
      });
    }
  }
  return createdIds;
}
