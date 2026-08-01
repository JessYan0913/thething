'use client'

import { useEffect, useState } from "react"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

interface AgentDef {
  agentType: string
  displayName?: string
  source: string
  metadata?: Record<string, unknown>
}

// Radix Select 的 item 不允许空字符串 value，用哨兵值表示"默认 Agent"
const DEFAULT_SENTINEL = "__default__"

/**
 * Agent 类型下拉选择器（自动化任务表单用）。
 * value 为空字符串表示使用默认 Agent。
 */
export function AgentTypeSelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [agents, setAgents] = useState<AgentDef[]>([])

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          // 只显示已启用的用户自定义 Agent（非 built-in）
          setAgents(
            data.agents.filter(
              (a: AgentDef) =>
                (a.source === 'user' || a.source === 'project') &&
                a.metadata?.enabled !== false,
            ),
          )
        }
      })
      .catch(() => {
        // Ignore errors
      })
  }, [])

  // 当前值不在列表中（如 Agent 已删除/禁用）时仍显示，避免下拉丢值
  const orphanValue = value && !agents.some((a) => a.agentType === value) ? value : null

  return (
    <Select
      value={value || DEFAULT_SENTINEL}
      onValueChange={(v) => onChange(v === DEFAULT_SENTINEL ? "" : v)}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="默认 Agent" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL}>默认 Agent</SelectItem>
        {orphanValue && (
          <SelectItem value={orphanValue}>{orphanValue}（不存在）</SelectItem>
        )}
        {agents.map((agent) => (
          <SelectItem key={agent.agentType} value={agent.agentType}>
            {agent.displayName || agent.agentType}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
