// ============================================================
// 结构化行动日志 - key/value 分离的根
// ============================================================
// 压缩系统的病根:extractMessageText 把 tool-call 输入(key=provenance)和
// tool-result 输出(value=内容)一起丢掉,LLM 摘要从未看到 web_fetch 的 URL、
// read_file 的路径,所以保不了来源。
//
// 本模块把对话显式拆成 (key, value) 对:key = 工具调用输入(工具名 + 参数,
// 如 filePath/url/command),永不被截断;value = 工具结果输出,按 valueState 降级渲染。
// 摘要器输入改用 renderActionLog,LLM 第一次能看到 provenance。
// 见 docs/compaction-redesign.md + plans/eventual-roaming-breeze.md。

import type { ModelMessage } from 'ai';
import { getToolOutputString, unwrapOutput } from './message-utils';
import { getItemToolName, detectError } from './message-view';

/** 一条行动日志条目 */
export interface ActionLogEntry {
  role: string;
  kind: 'text' | 'tool';
  /** text 类:消息文本 */
  text?: string;
  /** tool 类:工具名(key 的一部分) */
  toolName?: string;
  /** tool 类:工具调用输入(key,永不被截断) */
  input?: unknown;
  /** tool 类:工具结果输出(value) */
  output?: unknown;
  /** value 的序列化文本 */
  outputRaw?: string;
  /** value 的降级状态 */
  valueState: 'full' | 'truncated' | 'meta';
  /** 是否为错误结果 */
  isError?: boolean;
}

/**
 * 从消息列表提取结构化行动日志。
 * 显式分离 key(tool-call 输入)与 value(tool-result 输出),
 * 替代丢 key 的 extractMessageText。两种消息格式均支持。
 */
export function extractActionLog(messages: ModelMessage[]): ActionLogEntry[] {
  const entries: ActionLogEntry[] = [];

  for (const msg of messages) {
    const raw = msg as unknown as Record<string, unknown>;
    const parts = raw.parts;

    if (Array.isArray(parts)) {
      // UIMessage:.parts -- tool-call 的 input 与 output 在同一个 part
      for (const p of parts as Record<string, unknown>[]) {
        const partType = (p.type as string) ?? '';

        if (partType === 'text' || partType === 'reasoning') {
          const t = p.text as string | undefined;
          if (t) entries.push({ role: msg.role, kind: 'text', text: t, valueState: 'full' });
          continue;
        }

        if ((partType.startsWith('tool-') || partType === 'dynamic-tool') && p.state === 'output-available') {
          const outputStr = getToolOutputString(p.output);
          entries.push({
            role: msg.role,
            kind: 'tool',
            toolName: getItemToolName(p),
            input: p.input,
            output: unwrapOutput(p.output),
            outputRaw: outputStr,
            valueState: p._compacted === true ? 'meta' : p._truncated === true ? 'truncated' : 'full',
            isError: detectError(unwrapOutput(p.output)),
          });
        }
      }
      continue;
    }

    // ModelMessage:.content -- tool-call(key)与 tool-result(value)分离
    const content = raw.content;
    if (Array.isArray(content)) {
      for (const c of content as Record<string, unknown>[]) {
        const itemType = (c.type as string) ?? '';

        if (itemType === 'text') {
          const t = c.text as string | undefined;
          if (t) entries.push({ role: msg.role, kind: 'text', text: t, valueState: 'full' });
          continue;
        }

        if (itemType === 'tool-call') {
          // 纯 key:工具调用输入(args)。ModelMessage 把 key 和 value 拆成两项,
          // 这里捕获 key,value 在后续 tool-result 项里。
          entries.push({
            role: msg.role,
            kind: 'tool',
            toolName: (c.toolName as string) ?? '',
            input: c.args,
            valueState: 'full', // tool-call 本身就是 key,无 value
          });
          continue;
        }

        if (itemType === 'tool-result') {
          entries.push({
            role: msg.role,
            kind: 'tool',
            toolName: (c.toolName as string) ?? '',
            input: undefined, // key 在对应 tool-call 项里
            output: unwrapOutput(c.output),
            outputRaw: getToolOutputString(c.output),
            valueState: c._compacted === true ? 'meta' : c._truncated === true ? 'truncated' : 'full',
            isError: detectError(unwrapOutput(c.output)),
          });
        }
      }
      continue;
    }

    // 字符串 content
    if (typeof content === 'string' && content) {
      entries.push({ role: msg.role, kind: 'text', text: content, valueState: 'full' });
    }
  }

  return entries;
}

/**
 * 把行动日志渲染成摘要器可读的文本。
 * **key(工具调用输入)永远全文**;value(输出)按 valueState + maxValueChars 限制。
 * 工具调用标注来源类型 [remote]/[local]/[transient],帮助模型判断"远程文件用 web_fetch 找回,
 * 本地文件用 read_file 找回",不再把远程文件当本地(见 docs/compaction-redesign.md)。
 */
export function renderActionLog(entries: ActionLogEntry[], opts?: { maxValueChars?: number }): string {
  const maxValueChars = opts?.maxValueChars ?? 800;
  const lines: string[] = [];

  for (const e of entries) {
    if (e.kind === 'text') {
      const role = e.role === 'user' ? 'User' : e.role === 'assistant' ? 'Assistant' : e.role;
      const t = e.text ?? '';
      // 文本类:截断到 1200 字符(摘要器不需要全文,但保留足够语义)
      const preview = t.length > 1200 ? t.slice(0, 1200) + '...' : t;
      lines.push(`${role}: ${preview}`);
      continue;
    }

    // tool 类
    const toolName = e.toolName ?? 'unknown';
    const access = classifyToolAccess(toolName);
    // key:输入永远全文(小,是 provenance)
    const inputStr = e.input !== undefined && e.input !== null ? safeStringify(e.input) : '';

    if (e.outputRaw === undefined) {
      // 纯 key(ModelMessage tool-call 项)
      lines.push(`Tool call: ${toolName}(${inputStr}) [${access}]`);
      continue;
    }

    // key + value
    let valueStr = e.outputRaw;
    if (e.valueState === 'meta') {
      valueStr = `[meta] ${valueStr.slice(0, 200)}`;
    } else if (valueStr.length > maxValueChars) {
      valueStr = `${valueStr.slice(0, maxValueChars)}... [+${valueStr.length - maxValueChars} chars]`;
    }
    lines.push(`Tool[${toolName}](${inputStr}) -> ${valueStr} [${access}]`);
  }

  return lines.join('\n\n');
}

/** keys-only 行动日志:用于 checkpoint 持久化(机器生成,保 provenance 不靠 LLM) */
export function renderKeysOnlyActionLog(entries: ActionLogEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'tool') continue;
    const toolName = e.toolName ?? 'unknown';
    const access = classifyToolAccess(toolName);
    const inputStr = e.input !== undefined && e.input !== null ? safeStringify(e.input) : '';
    lines.push(`- ${toolName}(${inputStr}) [${access}]`);
  }
  return lines.join('\n');
}

/**
 * 分类工具的来源类型,引导模型用正确方式找回内容。
 * - remote:web_fetch/WebSearch 等,内容来自远程,用 web_fetch 重取
 * - local:read_file/Read/read_wiki_page,内容来自本地磁盘,用 read_file 重取
 * - transient:bash/grep/glob 等,命令/搜索结果,无法按路径找回(落盘的除外)
 */
function classifyToolAccess(toolName: string): 'remote' | 'local' | 'transient' {
  const t = toolName.toLowerCase();
  if (t === 'web_fetch' || t === 'webfetch' || t === 'web_search' || t === 'websearch') return 'remote';
  if (t === 'read_file' || t === 'read' || t === 'read_wiki_page' || t === 'readwikipage' || t === 'lint_wiki' || t === 'ingest_wiki_source') return 'local';
  return 'transient';
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s;
  } catch {
    return String(v);
  }
}

// ============================================================
// provenance 段附加（checkpoint + 紧急摘要共享）
// ============================================================
// 机器生成 keys-only 行动日志,附加到 LLM 摘要末尾。provenance 由代码保证,
// 不靠 LLM 听话。checkpoint(context-window.ts)和 Layer 3(emergency-summary.ts)都用。

/** 行动日志 provenance 段上限(字符),超出截断并提示 */
const ACTION_LOG_PROVENANCE_MAX = 2000;

/**
 * 在 LLM 摘要末尾附加机器生成的 keys-only 行动日志段。
 * 保证 web_fetch URL / read_file path / bash command 等来源信息不丢。
 */
export function appendActionLogProvenance(summary: string, messages: import('ai').ModelMessage[]): string {
  const keys = renderKeysOnlyActionLog(extractActionLog(messages));
  if (!keys) return summary;
  const section = keys.length > ACTION_LOG_PROVENANCE_MAX
    ? keys.slice(0, ACTION_LOG_PROVENANCE_MAX) + `\n... (+${keys.length - ACTION_LOG_PROVENANCE_MAX} chars, 已截断)`
    : keys;
  return `${summary}\n\n## 行动日志（provenance，机器生成）\n以下工具调用曾执行过,可据此判断文件来源与找回方式。标签含义:[remote]=远程文件,用 web_fetch 重取;[local]=本地文件,用 read_file 重取;[transient]=命令/搜索结果,落盘的可 read_file 找回:\n${section}`;
}
