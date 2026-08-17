// ============================================================
// Archiver - 子任务归档器（Task Paradigm Redesign §5）
// ============================================================
// 子任务完成时，在 prepareStep 边界用该子任务的消息切片调 LLM 提炼结构化
// {tool_chain, conclusion, key_facts}，写入 todo.metadata.facts（不改 result 字符串）。
// 同步 await（checkpoint 竞态教训）；每子任务边界一次额外 LLM 调用（成本已记录）。
// 见 docs/task-paradigm-redesign.md §5。

import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { TodoStore } from '../todos/types';

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

/** LLM 失败兜底：conclusion = 输入文本首段（≤300 字符），其余空 */
export function fallbackFacts(text: string): SubtaskFacts {
  const conclusion = text.trim().slice(0, 300);
  return { tool_chain: '', conclusion, key_facts: [] };
}

export interface ArchiveOptions {
  model: LanguageModelV3;
  fallbackModels?: LanguageModelV3[];
  modelName?: string;
}

/**
 * 提炼子任务事实（LLM 调用；失败返回 null，由调用方决定兜底）。
 */
export async function extractSubtaskFacts(
  messages: import('ai').ModelMessage[],
  opts: ArchiveOptions,
): Promise<SubtaskFacts | null> {
  const text = renderSubtaskText(messages);
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
 * 归档子任务：提炼 facts 并写入 todo.metadata.facts（保留 result 字符串）。
 * LLM 失败时用 fallbackFacts 兜底，保证 facts.conclusion 至少可读。
 * 返回写入的 facts。
 */
export async function archiveSubtask(
  store: TodoStore,
  todoId: string,
  messages: import('ai').ModelMessage[],
  opts: ArchiveOptions,
): Promise<SubtaskFacts | null> {
  const text = renderSubtaskText(messages);
  const facts = (await extractSubtaskFacts(messages, opts)) ?? fallbackFacts(text);
  store.updateTodo({ id: todoId, metadata: { facts } });
  return facts;
}
