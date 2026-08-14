// ============================================================
// Multi-Step Detector - 多步请求确定性检测 (Phase A)
// ============================================================
// 让"建 todo"的触发从模型自觉（不稳定）转为 harness 确定性判定。
//
// 原则：保守、宁多勿漏。误报是可接受的——注入的提示自带"若为单步可忽略"
// 出口；漏报则回到现状（模型自觉）。
//
// 信号（对最后一条用户消息）：
//   - 显式枚举："三件事/几个步骤/第一步/第二步/① ② / 1. 2."
//   - 动作串联："写 X 并/然后/再 做 Y"（多动词）
//   - 排序词："先…再/然后…"
//   - 多交付物："和一份清单/并生成报告"
//   - 连接词 + 较长文本；或文本很长（≥80 字，多步可能性极高）

const CONNECTOR_RE =
  /(然后|接着|随后|之后|再|同时|并且|以及|分别|还要|另外|顺便|最后|最终|并)/;

const SEQUENCE_RE =
  /(先|首先|第一步)[^。；\n]{0,50}(再|然后|接着|其次|第二步|之后)/;

const ENUMERATION_RE =
  /(三|两|几|多|四|五|六)件(事|事项|任务|东西)|(三|两|几|多|四|五|六)个(部分|步骤|环节|任务)|第一步|第二步|①|②|\b(1|2)\s*[\.、]/;

const MULTI_VERB_RE =
  /(写|生成|创建|整理|规划|设计|研究|完成|准备|比较|列出|安排|翻译|分析|做|收集|总结|起草|发布)[^。；\n]{0,30}(和|与|并|然后)[^。；\n]{0,30}(写|生成|创建|整理|规划|设计|研究|完成|准备|比较|列出|安排|翻译|分析|做|收集|总结|起草|发布)/;

const DELIVERABLE_RE =
  /(和|与|并)[^，。；\n]{0,20}(报告|清单|方案|草稿|初稿|总结|列表|表格|邮件|建议|摘要|公司|标题|大纲|计划|文章|文档)/;

const MIN_LEN_WITH_CONNECTOR = 20;
const MIN_LEN_BARE = 80;

/** 判定一条用户请求是否为"多步骤"（应建 todo）。保守，宁多勿漏。 */
export function looksMultiStep(requestText: string): boolean {
  const text = requestText.trim();
  if (!text) return false;
  const len = text.length;

  if (ENUMERATION_RE.test(text)) return true;
  if (SEQUENCE_RE.test(text)) return true;
  if (MULTI_VERB_RE.test(text)) return true;
  if (DELIVERABLE_RE.test(text)) return true;
  if (CONNECTOR_RE.test(text) && len >= MIN_LEN_WITH_CONNECTOR) return true;
  if (len >= MIN_LEN_BARE) return true;
  return false;
}

// ============================================================
// 执行型 vs 内容型（收紧注入的依据）
// ============================================================
// 执行型：涉及对代码/文件或外部系统的实际改动，todo 价值最高——
//   文件操作、运行/部署/发送/预订等副作用动词、研究到交付物的多轮工具调用。
// 内容型：输出即答案（总结/解释/翻译/列大纲/写文案），todo 价值低。
// 执行型请求收紧注入（无出口、反复提醒），内容型保留出口由模型自行判断。

const CODE_FOCUS_RE =
  /(\.ts|\.js|\.py|\.go|\.rs|\.json|\.md|\.css|文件|代码|函数|类|模块|脚本|项目|应用|页面|组件|接口|服务|工具|测试|配置|数据库|接口)/;

const FILE_OP_RE =
  /(写|创建|新建|修改|重构|编辑|修复|重写|删除|实现|开发|构建|迁移|拆分|合并|添加|更新)(.{0,15})(文件|代码|函数|类|模块|脚本|测试|配置|页面|组件|接口|服务|工具|应用|项目)/;

const EXEC_VERB_RE =
  /(运行|执行|安装|部署|启动|构建|编译|发布|发送|发邮件|邮件|预订|订|安排会议|创建任务|创建提醒|提醒我|通知|下单|购买|支付|上传|下载|调用|订阅|报名|申请)/;

const RESEARCH_RE =
  /(调研|研究|比较|对比|分析|查|搜索|搜集|收集|评估)(.{0,15})(报告|数据|信息|价格|对比|行情|资料|清单|公司|趋势)/;

/** 请求是否属于"执行型"（涉及对代码/文件/外部系统的实际改动）。 */
export function executionIntent(requestText: string): boolean {
  const text = requestText.trim();
  if (!text) return false;
  return CODE_FOCUS_RE.test(text) || FILE_OP_RE.test(text) || EXEC_VERB_RE.test(text) || RESEARCH_RE.test(text);
}

/**
 * 上一步模型是否"没建清单就开始干活"（调用了非 todo 工具）。
 * 用于执行型任务：只要开始干活仍未建单，就反复注入硬提醒。
 */
export function workedWithoutPlanning(step: {
  toolCalls?: Array<{ toolName?: string; name?: string }>;
} | undefined): boolean {
  if (!step) return false;
  const calls = step.toolCalls ?? [];
  if (calls.length === 0) return false;
  return !calls.some((t) => (t.toolName ?? t.name ?? '').startsWith('todo_'));
}

// ============================================================
// 注入消息
// ============================================================

/** 首轮注入（内容型）：多步请求且尚未建单时，在第一次模型调用前注入。带出口。 */
export function buildPlanFirstInjection(): string {
  return `[任务规划提示] 这个请求看起来需要多个步骤才能完成。请先用 todo_write 建立任务清单（每步一个任务，可标注完成标准），再开始执行；执行过程中用 todo_write 保持清单更新，让用户能实时看到进度。如果你判断这其实是单步任务或纯问答，可直接回答，无需建清单。`;
}

/** 首轮注入（执行型）：涉及对代码/文件/外部系统的实际改动，无出口、必须建清单。 */
export function buildStrictPlanFirstInjection(): string {
  return `[任务规划提示] 该请求涉及对代码/文件或外部系统的实际改动，属于多步骤执行任务。执行前必须先用 todo_write 建立任务清单（每步一个任务，标注完成标准），清单建立后才能开始执行工具；执行过程中用 todo_write 保持清单更新。请立即调用 todo_write 建立清单，不要在没有清单的情况下直接动手。`;
}

/** 5 步兜底：跑了几步仍未建单时注入。 */
export function buildEmptyTodoReminder(): string {
  return `[任务清单为空] 已执行多步但仍未建立任务清单。若该请求确为多步骤任务，请立即调用 todo_write 建立清单再继续；若确为单步任务可忽略本提醒并继续完成。`;
}

/** 从消息历史中提取最后一条用户文本（用于多步判定）。 */
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
