import React from 'react'
import { Static, Text, Box } from 'ink'
import type { CompletedMessage } from '../lib/types.js'
import { renderMarkdown } from '../lib/markdown.js'
import { ToolCallLine } from './ToolCallLine.js'
import { ToolCallsSummaryLine } from './ToolCallsSummaryLine.js'

interface Props {
  items: CompletedMessage[]
  toolCallsExpanded: boolean
  onToggleToolCalls: () => void
}

function AssistantParts({ item, collapsed }: { item: CompletedMessage; collapsed?: boolean }) {
  const toolCallMap = new Map(
    (item.toolCalls || []).map(tc => [tc.toolCallId, tc])
  )

  if (item.parts && item.parts.length > 0) {
    return (
      <>
        {item.parts.map((part, i) => {
          if (part.type === 'text') {
            return part.text ? <Text key={`text-${i}`}>{renderMarkdown(part.text)}</Text> : null
          }
          if (part.type === 'tool-call') {
            if (collapsed) return null
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
  const showCollapsed = !!item.collapsedToolCallSummary && !expanded

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
          {showCollapsed && (
            <ToolCallsSummaryLine
              count={item.collapsedToolCallSummary!.count}
              errorCount={item.collapsedToolCallSummary!.errorCount}
              expanded={expanded}
              onToggle={onToggle}
            />
          )}
          <AssistantParts item={item} collapsed={showCollapsed} />
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
  // 因此仅「可折叠的 assistant 消息」需要 live 渲染以支持 Ctrl+E 展开；
  // 其余（用户消息 / 不可折叠 assistant）直接进 Static——live 与 Static 内容一致，
  // 消息进出 Static 时不会产生可见重复（Static 追加时内容与 live 渲染完全相同）。
  const lastItem = items[items.length - 1]
  const liveItem =
    lastItem && lastItem.role === 'assistant' && lastItem.collapsedToolCallSummary ? lastItem : undefined
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
