// ============================================================
// Plan Prompt - 多步规划提示 (Phase A 重构, 2026-08-15)
// ============================================================
// 原则：**"是否多步 / 是否要规划"的判断交给大模型**，harness 只做两件事——
//   1. 开工前对非超短请求轻问一句（建不建由模型判断）
//   2. 干了几步还没建清单时兜底提醒（模型再判断一次）
//
// 不再用关键词/正则去替模型判断复杂度（此前做法对"顺便""还有"等话术判断太粗，
// 且判断质量远不如模型）。唯一保留的确定性门槛 isTrivialRequest 只跳过超短请求
// （如"现在几点"），纯粹为不烦人，不是复杂度判断。

const TRIVIAL_LEN = 12;

/** 超短请求直接跳过提示（噪音控制，非复杂度判断）。 */
export function isTrivialRequest(requestText: string): boolean {
  return requestText.trim().length < TRIVIAL_LEN;
}

/** 开工前轻问一句：多步就建清单，单步直接答——由模型自行判断。 */
export function buildPlanPrompt(): string {
  return `[任务规划] 这个请求如果需要多个步骤、涉及多项交付物或多次操作，请先用 todo_write 建立任务清单（每步一个任务，可标注完成标准），再开始执行；执行中保持清单更新。如果它其实是单步任务、纯问答，或输出即答案（如解释、总结、翻译），直接回答即可，无需建清单。`;
}

/** 5 步兜底：干了几步还没建清单时提醒（不预判是否多步，由模型再判断一次）。 */
export function buildEmptyTodoReminder(): string {
  return `[任务清单为空] 已执行多步但仍未建立任务清单。如果这个请求确实需要多步完成，请先用 todo_write 建立清单再继续；如果确认是单步任务，忽略本提醒继续完成即可。`;
}

/** 从消息历史中提取最后一条用户文本（用于注入时的轻问）。 */
export function getLastUserText(messages: Array<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const text = c
        .filter(
          (p): p is { type: 'text'; text: string } =>
            typeof p === 'object' && p !== null && (p as { type?: string }).type === 'text',
        )
        .map((p) => p.text)
        .join(' ');
      if (text.trim()) return text;
    }
  }
  return '';
}
