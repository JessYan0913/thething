import React from 'react'
import { Static, Text, Box } from 'ink'
import type { CompletedMessage } from '../lib/types.js'
import { TOOL_FOLD_THRESHOLD } from '../lib/types.js'
import { renderMarkdown } from '../lib/markdown.js'
import { ToolCallLine } from './ToolCallLine.js'
import { ToolCallsSummaryLine } from './ToolCallsSummaryLine.js'
import { computeToolClusters, hasCollapsibleCluster } from '../lib/tool-clusters.js'

interface Props {
  items: CompletedMessage[]
  toolCallsExpanded: boolean
  onToggleToolCalls: () => void
}

function AssistantParts({
  item,
  collapsed,
  onToggle,
}: {
  item: CompletedMessage
  collapsed?: boolean
  onToggle?: () => void
}) {
  const toolCallMap = new Map(
    (item.toolCalls || []).map(tc => [tc.toolCallId, tc])
  )
  const { clusters, clusterOfIndex } = computeToolClusters(item.parts ?? [], id => toolCallMap.get(id))

  if (item.parts && item.parts.length > 0) {
    return (
      <>
        {item.parts.map((part, i) => {
          if (part.type === 'text') {
            return part.text ? <Text key={`text-${i}`}>{renderMarkdown(part.text)}</Text> : null
          }
          if (part.type === 'tool-call') {
            const ci = clusterOfIndex.get(i)
            const cluster = ci !== undefined ? clusters[ci] : undefined
            const collapsible = !!cluster && cluster.count >= TOOL_FOLD_THRESHOLD
            if (collapsed && collapsible) {
              if (i !== cluster!.firstIndex) return null
              return (
                <ToolCallsSummaryLine
                  key={`tool-summary-${i}`}
                  count={cluster!.count}
                  errorCount={cluster!.errorCount}
                  onToggle={onToggle}
                />
              )
            }
            const tc = toolCallMap.get(part.toolCallId)
            return tc ? <ToolCallLine key={part.toolCallId} tool={tc} /> : null
          }
          if (part.type === 'step-boundary') {
            return <Text key={`step-${i}`} dimColor>{' '}</Text>
          }
          return null
        })}
      </>
    )
  }

  return (
    <>
      <Text>{renderMarkdown(item.text)}</Text>
      {!collapsed && item.toolCalls && item.toolCalls.length > 0 && (
        <Box flexDirection="column">
          {item.toolCalls.map(tc => (
            <ToolCallLine key={tc.toolCallId} tool={tc} />
          ))}
        </Box>
      )}
    </>
  )
}

function MessageItem({
  item,
  expanded,
  onToggle,
}: {
  item: CompletedMessage
  expanded?: boolean
  onToggle?: () => void
}) {
  // 静态条目（expanded/onToggle 未定义）始终折叠；可切换的最近一条按 expanded 状态
  const collapsed = expanded === undefined ? true : !expanded

  return (
    <Box key={item.id} flexDirection="column" marginBottom={1}>
      {item.role === 'user' ? (
        <Box>
          <Text color="cyan" bold>You: </Text>
          <Text>{item.text}</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green" bold>Assistant:</Text>
          <AssistantParts item={item} collapsed={collapsed} onToggle={onToggle} />
          {item.cost && (
            <Text dimColor>
              Cost: ${item.cost.totalCostUsd.toFixed(6)} | Input: {item.cost.inputTokens} | Output: {item.cost.outputTokens}
            </Text>
          )}
        </Box>
      )}
      <Text dimColor>{'─'.repeat(Math.min(process.stdout.columns || 80, 60))}</Text>
    </Box>
  )
}

export function MessageList({ items, toolCallsExpanded, onToggleToolCalls }: Props) {
  // Ink <Static> 只追加渲染新条目、已输出条目永久冻结，无法重渲染切换展开态。
  // 因此仅「含可折叠组的 assistant 消息」需要 live 渲染以支持 Ctrl+E 展开；
  // 其余（用户消息 / 无折叠组）直接进 Static——live 与 Static 内容一致，
  // 消息进出 Static 时不会产生可见重复（Static 追加时内容与 live 渲染完全相同）。
  const lastItem = items[items.length - 1]
  const lastToolMap = new Map((lastItem?.toolCalls ?? []).map(tc => [tc.toolCallId, tc]))
  const liveItem =
    lastItem &&
    lastItem.role === 'assistant' &&
    hasCollapsibleCluster(lastItem.parts ?? [], id => lastToolMap.get(id))
      ? lastItem
      : undefined
  const staticItems = liveItem ? items.slice(0, -1) : items

  return (
    <>
      <Static items={staticItems}>
        {(item) => (
          <MessageItem key={item.id} item={item} />
        )}
      </Static>
      {liveItem && (
        <MessageItem
          key={liveItem.id}
          item={liveItem}
          expanded={toolCallsExpanded}
          onToggle={onToggleToolCalls}
        />
      )}
    </>
  )
}
