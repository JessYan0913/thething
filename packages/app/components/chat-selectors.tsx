'use client';

import {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
} from '@/components/ai-elements/prompt-input';
import { SelectGroup, SelectLabel } from '@/components/ui/select';
import { useEffect, useState } from 'react';

// ============================================================
// Model Selector
// ============================================================

interface ProviderGroup {
  name: string;
  baseURL: string;
  models: { id: string; contextLimit?: number }[];
}

/** 分组标题回落:自定义名 → 域名 → baseURL */
function groupLabel(provider: ProviderGroup): string {
  if (provider.name?.trim()) return provider.name;
  try {
    return new URL(provider.baseURL).hostname;
  } catch {
    return provider.baseURL;
  }
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

// ============================================================
// Approval Mode Selector
// ============================================================

export type ApprovalMode = 'smart' | 'auto-review' | 'full-trust';

interface ApprovalModeSelectorProps {
  value: ApprovalMode;
  onChange: (value: ApprovalMode) => void;
}

const APPROVAL_MODE_CONFIG: Record<ApprovalMode, { label: string; hint: string }> = {
  'smart':    { label: '默认权限',    hint: '智能判断，需要时请求确认' },
  'auto-review': { label: '帮我审批', hint: 'Agent 自动审查后批准常规操作' },
  'full-trust':  { label: '全部授权', hint: '完全信任，所有操作无需确认' },
};

export function ApprovalModeSelector({ value, onChange }: ApprovalModeSelectorProps) {
  return (
    <PromptInputSelect value={value} onValueChange={onChange}>
      <PromptInputSelectTrigger className="min-w-0 max-w-32 gap-1.5 text-xs">
        <span className="truncate">{APPROVAL_MODE_CONFIG[value]?.label ?? 'Mode'}</span>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {Object.entries(APPROVAL_MODE_CONFIG).map(([key, config]) => (
          <PromptInputSelectItem key={key} value={key}>
            <div className="flex flex-col py-0.5">
              <span className="font-medium">{config.label}</span>
              <span className="text-xs text-muted-foreground">{config.hint}</span>
            </div>
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderGroup[]>([]);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.providers)) {
          const groups = (data.providers as ProviderGroup[]).filter(p => p.models?.length > 0);
          setProviders(groups);
          // 初始值/旧别名值不在列表中时,重置为 defaultModel
          const allIds = groups.flatMap(p => p.models.map(m => m.id));
          if (allIds.length > 0 && !allIds.includes(value)) {
            onChange(data.defaultModel || allIds[0]);
          }
        }
      })
      .catch(() => {
        // Ignore errors - show empty state
      });
  }, []);

  if (providers.length === 0) {
    return null;
  }

  // 只有一个供应商时不显示分组标题,减少视觉噪音
  const showGroups = providers.length > 1;

  return (
    <PromptInputSelect value={value} onValueChange={onChange}>
      <PromptInputSelectTrigger
        className="min-w-0 max-w-56 gap-1.5 text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
        title={value}
      >
        <PromptInputSelectValue placeholder="Model" />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {providers.map((provider) => {
          const items = provider.models.map((model) => (
            <PromptInputSelectItem key={model.id} value={model.id}>
              <span className="font-medium max-w-40 truncate" title={model.id}>{model.id.split('/').pop()}</span>
            </PromptInputSelectItem>
          ));
          return showGroups ? (
            <SelectGroup key={`${provider.baseURL}-${provider.name}`}>
              <SelectLabel className="text-xs text-muted-foreground">{groupLabel(provider)}</SelectLabel>
              {items}
            </SelectGroup>
          ) : items;
        })}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}

// ============================================================
// Agent Selector
// ============================================================

interface AgentDef {
  agentType: string;
  displayName?: string;
  description: string;
  source: string;
  metadata?: Record<string, unknown>;
}

interface AgentSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const [agents, setAgents] = useState<AgentDef[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          // 只显示已启用的用户自定义 Agent（非 built-in）
          const userAgents = data.agents.filter(
            (a: AgentDef) =>
              (a.source === 'user' || a.source === 'project') &&
              a.metadata?.enabled !== false,
          );
          setAgents(userAgents);
          // 如果当前选中的 Agent 已被禁用或不存在，重置为 auto
          if (value !== 'auto' && !userAgents.some((a: AgentDef) => a.agentType === value)) {
            onChange('auto');
          }
        }
      })
      .catch(() => {
        // Ignore errors
      });
  }, []);

  // 没有用户自定义 Agent 时隐藏选择器
  if (agents.length === 0) {
    return null;
  }

  return (
    <PromptInputSelect value={value} onValueChange={onChange}>
      <PromptInputSelectTrigger className="min-w-0 max-w-32 gap-1.5 text-xs [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate">
        <PromptInputSelectValue placeholder="Agent" />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        <PromptInputSelectItem value="auto">
          <span className="font-medium">Auto</span>
        </PromptInputSelectItem>
        {agents.map((agent) => (
          <PromptInputSelectItem key={agent.agentType} value={agent.agentType}>
            <span className="font-medium">
              {agent.displayName || agent.agentType}
            </span>
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}
