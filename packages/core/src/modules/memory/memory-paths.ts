// ============================================================
// Memory Paths - 路径工具
// ============================================================

import path from 'path'
import type { ResolvedLayout } from '../../services/config/layout'

/**
 * 获取主记忆目录：~/.thething/memory
 */
export function getPrimaryMemoryDir(
  layout: Pick<ResolvedLayout, 'configDir'>,
): string {
  return path.join(layout.configDir, 'memory')
}
