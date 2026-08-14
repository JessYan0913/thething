import { TOOL_FOLD_THRESHOLD, type StreamPart, type ToolCallState } from './types.js'

export interface ToolCluster {
  /** parts 数组中的首个 tool-call part 下标 */
  firstIndex: number
  count: number
  errorCount: number
  toolCallIds: string[]
}

/**
 * 按文本隔离工具折叠组：一段 text 后的连续 tool-call part 为一组，
 * 出现 text 则开启新组；step-boundary 不可见，不打断组。
 * 与 Web 端 Chat.tsx 的分组规则一致。
 */
export function computeToolClusters(
  parts: StreamPart[],
  getTool: (toolCallId: string) => ToolCallState | undefined,
): { clusters: ToolCluster[]; clusterOfIndex: Map<number, number> } {
  const clusters: ToolCluster[] = []
  const clusterOfIndex = new Map<number, number>()
  let current: ToolCluster | null = null
  let currentIndex = -1

  parts.forEach((part, i) => {
    if (part.type === 'tool-call') {
      if (!current) {
        current = { firstIndex: i, count: 0, errorCount: 0, toolCallIds: [] }
        currentIndex = clusters.length
        clusters.push(current)
      }
      clusterOfIndex.set(i, currentIndex)
      current.count += 1
      current.toolCallIds.push(part.toolCallId)
      if (getTool(part.toolCallId)?.status === 'error') {
        current.errorCount += 1
      }
    } else if (part.type === 'text') {
      current = null
    }
  })

  return { clusters, clusterOfIndex }
}

/** 是否存在可折叠（达到阈值）的折叠组 */
export function hasCollapsibleCluster(
  parts: StreamPart[],
  getTool: (toolCallId: string) => ToolCallState | undefined,
): boolean {
  return computeToolClusters(parts, getTool).clusters.some(c => c.count >= TOOL_FOLD_THRESHOLD)
}
