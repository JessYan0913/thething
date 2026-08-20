import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { Todo, TodoStore } from './types';
import { logger } from '../../primitives/logger';
import { indexActiveTodos } from './snapshot-index';
import { renderIndexedActiveList } from './todo-tools/todo-snapshot';

/**
 * 收尾闸门（settle gate）——段末未收尾 in_progress 任务的"结账"。
 *
 * 背景：主 Agent 一轮（segment）正常结束但把最后一个任务留在 `in_progress` 没落账
 * （模型 follow-through 失败，尤其弱模型被打断后分心），导致面板永久显示"进行中"。
 * 提示词里的 "Close the loop" 是软约束，拦不住弱模型。
 *
 * 机制：在一轮正常结束（非中止/非截断）时，若仍有未收尾的 `in_progress` 项，
 * 发起一次只开放 `todo_write` 工具的小 LLM 调用，让模型对每一项明确结账
 * （completed+result / failed+error / cancelled），或以继续 in_progress 的方式显式保留。
 * 这样把"是否算完成"的判定交给模型，而不是由系统猜测完成。
 *
 * 方案 C 兼容：todo_write 真替换会取消未列出的活跃待办。因此结账提示词列出**全部**
 * 活跃任务（含编号），模型据此传"想保留的完整清单"——只把未收尾的 in_progress 结账，
 * 其余待办一并列出以免被取消。
 */

/**
 * 找出仍未收尾的 in_progress 项（收尾闸门的触发条件）。
 * @internal 导出仅用于测试
 */
export function findUnsettledInProgress(todos: Todo[]): Todo[] {
  return todos.filter((t) => t.status === 'in_progress');
}

/**
 * 构建收尾提示词：列出全部活跃任务（含编号），要求模型把未收尾的 in_progress 项结账，
 * 其余活跃项一并重列以免被真替换取消。
 * @internal 导出仅用于测试
 */
export function buildSettlePrompt(todos: Todo[], store: TodoStore): string {
  const indexed = indexActiveTodos(todos);
  const unsettledIds = new Set(findUnsettledInProgress(todos).map(t => t.id));

  const activeList = renderIndexedActiveList(todos, store) ?? '';

  const unsettledMark = indexed
    .filter(({ todo }) => unsettledIds.has(todo.id))
    .map(({ index, todo }) => `[#${index}] ${todo.subject}`)
    .join(', ');

  return (
    'You just finished your turn, but the following todo(s) are still marked "in_progress" and were never settled: ' +
    `${unsettledMark}.\n\n` +
    'Here is the FULL current active task list (with indices):\n' +
    `${activeList}\n\n` +
    'Use the todo_write tool to settle the in_progress item(s) into an accurate terminal state:\n' +
    '- If the work is actually done, mark it completed with a short `result` describing what was done.\n' +
    '- If it failed, mark it failed with an `error` explaining why.\n' +
    '- If it should no longer be tracked, cancel it.\n' +
    '- Only if you genuinely intend to keep working on it in a future turn, leave it as in_progress.\n\n' +
    'IMPORTANT: todo_write uses TRUE-REPLACE — pass the FULL active list you want to keep ' +
    '(re-list every active task by its index [#N]), and set only the in_progress item(s) to their terminal state. ' +
    'Do not create any new todos.'
  );
}

/**
 * 执行收尾闸门：若存在未收尾的 in_progress 项，调一次只开放 todo_write 的小 LLM 让其结账。
 * 返回是否有触发过收尾（调用方据此决定是否推送一次 data-todo-update 刷新面板）。
 */
export async function settleInProgressTodos(opts: {
  todoStore: TodoStore;
  conversationId: string;
  model: LanguageModel;
  todoWriteTool: ReturnType<typeof import('./todo-tools/todo-write-tool').createTodoWriteToolForConversation>;
}): Promise<{ triggered: boolean; count: number }> {
  const todos = opts.todoStore.getTodosByConversation(opts.conversationId);
  const unsettled = findUnsettledInProgress(todos);
  if (unsettled.length === 0) {
    return { triggered: false, count: 0 };
  }

  try {
    await generateText({
      model: opts.model,
      tools: { todo_write: opts.todoWriteTool },
      toolChoice: 'auto',
      prompt: buildSettlePrompt(todos, opts.todoStore),
    });
    logger.info('TodoSettle', `[settle-gate] asked to settle ${unsettled.length} in_progress todo(s) (${unsettled.map((t) => t.id).join(', ')})`);
    return { triggered: true, count: unsettled.length };
  } catch (error) {
    // 收尾调用失败不应破坏主流程——记日志即可，留待下次
    logger.warn('TodoSettle', `[settle-gate] settle call failed: ${error instanceof Error ? error.message : String(error)}`);
    return { triggered: false, count: 0 };
  }
}
