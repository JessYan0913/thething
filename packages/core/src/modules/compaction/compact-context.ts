// ============================================================
// Compact Context - 模型主动压缩工具（P2）
// ============================================================
// 见 docs/compaction-redesign.md §12.3 / §4.7（roadmap 落地）、docs/context-usage-redesign.md §14.3。
//
// MemGPT 式"事件驱动"：模型在"探索结束、进入实现"等节点主动请求压缩旧工具输出，
// 而不是等系统 85% 水位兜底。与 context_pin（保留）构成模型侧预算控制面。
//
// 机制：工具只做"登记 + 校验"（validateCompactionRequest 5 规则），实际压缩在
// 下一步 prepareStep 的 compactBeforeStep 应用（复用 manageToolOutputLifecycle 的
// value 阶梯，配收紧的 keepRecentSteps + 按工具过滤的 compactableTools）。
// 摘要策略（summarize_conversation）暂不支持——摘要只在后台生成（P7）。

import { tool } from 'ai';
import { z } from 'zod';

export const compactContextInputSchema = z.object({
  strategy: z
    .enum(['compress_old_outputs', 'summarize_conversation'])
    .default('compress_old_outputs')
    .describe('压缩策略；当前仅支持 compress_old_outputs（summarize_conversation 摘要只在后台生成）'),
  toolNames: z
    .array(z.string())
    .optional()
    .describe('要压缩的工具名列表（如 ["read_file","grep"]）；缺省 = 压缩所有可压缩的旧工具输出'),
  reason: z.string().min(1).describe('压缩原因（审计日志）'),
});
export type CompactContextInput = z.infer<typeof compactContextInputSchema>;

/** 已登记的压缩请求（下一步 compactBeforeStep 应用） */
export interface CompactContextRequest {
  toolNames?: string[];
  reason: string;
}

/** 防频繁压缩（可能模型在循环调用）的窗口 */
export const COMPACT_RATE_LIMIT_MS = 60_000;

export interface CompactContextValidationContext {
  /** 当前上下文使用率（0-100）；null = 未知（不据此拒绝） */
  utilizationPercent?: number | null;
  /** 上次模型主动压缩时间（ms）；null = 从未 */
  lastCompactionAt?: number | null;
}

/**
 * validateCompactionRequest —— §12.3 防错规则（MVP 版）：
 * 1. 低水位拒绝（浪费 turn）：<50% 不压
 * 3. 防频繁压缩（防循环）：1 分钟内 ≤1 次
 * （规则 2 最近 2 步保护 / 规则 4-5 由 keepRecentSteps 与策略范围在应用层保证）
 */
export function validateCompactionRequest(
  input: CompactContextInput,
  ctx: CompactContextValidationContext,
): { valid: true } | { valid: false; error: string } {
  if (input.strategy === 'summarize_conversation') {
    return { valid: false, error: 'summarize_conversation 暂不支持：摘要只在后台 checkpoint 生成。请用 compress_old_outputs。' };
  }
  if (ctx.utilizationPercent != null && ctx.utilizationPercent < 50) {
    return {
      valid: false,
      error: `Context usage is only ${ctx.utilizationPercent.toFixed(1)}%, no need to compress yet. Wait until >60%.`,
    };
  }
  if (ctx.lastCompactionAt != null && Date.now() - ctx.lastCompactionAt < COMPACT_RATE_LIMIT_MS) {
    return {
      valid: false,
      error: 'Too many compressions in short time (>= 1 in 1 min). Let the system auto-compress instead.',
    };
  }
  return { valid: true };
}

export interface CompactContextToolOptions {
  /** 与 compactBeforeStep 共享的登记槽（应用后清空） */
  requestRef: { current: CompactContextRequest | null };
  /** 当前上下文使用率（0-100），校验低水位用 */
  getUtilizationPercent: () => number | null;
  /** 上次主动压缩时间（ms），限流用 */
  lastCompactionAtRef?: { current: number | null };
}

/** 创建 compact_context 工具（模型主动释放旧工具输出） */
export function createCompactContextTool(options: CompactContextToolOptions) {
  return tool({
    description:
      '压缩旧的工具输出（把已读过的文件内容 / 搜索结果等替换为元信息并落盘），释放上下文空间。' +
      '在探索阶段结束后、开始实现前调用最有效（如读完一批文件、grep 找到目标后）。' +
      '压缩在下一步生效；被压缩的输出仍可通过 read_file 按文件路径找回。',
    inputSchema: compactContextInputSchema,
    execute: async (input: CompactContextInput) => {
      const utilizationPercent = options.getUtilizationPercent();
      const lastAt = options.lastCompactionAtRef?.current ?? null;
      const validation = validateCompactionRequest(input, { utilizationPercent, lastCompactionAt: lastAt });
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      options.requestRef.current = { toolNames: input.toolNames, reason: input.reason };
      if (options.lastCompactionAtRef) options.lastCompactionAtRef.current = Date.now();
      return {
        success: true,
        message:
          `已登记：下一步将压缩旧工具输出` +
          (input.toolNames && input.toolNames.length > 0
            ? `（${input.toolNames.join(', ')}）`
            : '（全部可压缩的旧输出）') +
          `。释放的上下文空间在下一步生效，被压缩内容已落盘可找回。`,
      };
    },
  });
}
