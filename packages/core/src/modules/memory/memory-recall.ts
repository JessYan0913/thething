// ============================================================
// Memory Recall - 召回追踪
// ============================================================
// 封装 usage-tracker.ts 的召回记录功能，提供批量操作接口

import { recordMemoryRecall, getAllMemoryUsage, type MemoryUsageData } from './usage-tracker';
import { logger } from '../../primitives/logger';

/**
 * 批量记录记忆召回事件
 * 在 findRelevantMemories 返回后调用，更新每个被召回记忆的使用统计
 */
export async function recordMemoryRecalls(
  memoryDir: string,
  filenames: string[],
  conversationId?: string,
): Promise<void> {
  if (filenames.length === 0) return;

  try {
    // 并行记录所有召回事件，避免串行 IO
    await Promise.all(
      filenames.map((filename) =>
        recordMemoryRecall(memoryDir, filename, conversationId),
      ),
    );
  } catch (err) {
    // 召回记录失败不阻塞主流程
    logger.debug('MemoryRecall', `Failed to record recalls: ${err}`);
  }
}

/**
 * 获取召回统计信息
 */
export async function getRecallStats(memoryDir: string): Promise<MemoryUsageData> {
  return getAllMemoryUsage(memoryDir);
}
