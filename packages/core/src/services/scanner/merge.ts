// ============================================================
// Scanner - 配置合并与缓存
// ============================================================

// ============================================================
// 按优先级合并
// ============================================================

/**
 * 按优先级合并配置项
 *
 * @param items 配置项列表（带 source 字段）
 * @param priorityOrder 优先级顺序（如 ['project', 'user']，project 最高）
 * @param getKey 获取唯一标识的函数
 * @returns 合并后的列表
 */
export function mergeByPriority<T extends { source: string }>(
  items: T[],
  priorityOrder: string[],
  getKey: (item: T) => string,
): T[] {
  const merged = new Map<string, T>();

  // 按优先级顺序处理（低优先级先处理，高优先级覆盖）
  const reversedOrder = [...priorityOrder].reverse();

  for (const source of reversedOrder) {
    for (const item of items) {
      const key = getKey(item);
      if (item.source === source) {
        merged.set(key, item);
      }
    }
  }

  return Array.from(merged.values());
}