import { tool } from 'ai';
import { z } from 'zod';
import type { ContextLedger } from '../compaction/context-ledger';

/**
 * context_pin 工具：模型参与上下文管理的最小入口。
 *
 * - pin: 声明某文件是当前工作集核心，其最新读取结果豁免压缩
 * - release: 解除 pin，允许重新老化
 * - list: 查询上下文台账——哪些内容被压缩/截断了、如何找回、当前 pin 了什么
 *
 * 台账不注入消息流（避免每步破坏 prompt cache），按需查询。
 * 见 docs/context-compaction-architecture.md 读循环事故复盘。
 */
export function createContextPinTool(options: { ledger: ContextLedger }) {
  return tool({
    description: `管理上下文压缩：pin 住重要文件防止其内容被压缩，或查询哪些内容已被压缩及找回方式。
- pin: 该文件的最新读取结果将保留完整（适用于你需要反复参考的核心文件）
- release: 解除 pin，允许系统在需要时压缩它
- list: 查看当前 pin 列表和最近被压缩/截断的内容（含找回路径）
提示：如果你发现某个文件读取结果被替换成了摘要（如 "Read xxx → N lines"），pin 它再重新读取即可保留完整内容。`,
    inputSchema: z.object({
      action: z.enum(['pin', 'release', 'list']).describe('操作类型'),
      path: z.string().optional().describe('文件路径（pin/release 必填）'),
    }),
    execute: async ({ action, path }) => {
      if (action === 'list') {
        return options.ledger.formatLedger();
      }
      if (!path) {
        return JSON.stringify({ error: true, message: `action "${action}" requires a path` });
      }
      if (action === 'pin') {
        options.ledger.pin(path);
        return `Pinned ${path}: its latest read result will be kept in full (not compacted).`;
      }
      const had = options.ledger.release(path);
      return had
        ? `Released ${path}: it may be compacted again when context budget requires.`
        : `${path} was not pinned; nothing to release.`;
    },
  });
}
