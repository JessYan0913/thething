'use client';

import {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
} from '@/components/ai-elements/prompt-input';
import { useEffect, useState } from 'react';
import { BotIcon, CpuIcon } from 'lucide-react';

// ============================================================
// Model Selector
// ============================================================

interface ModelAliasConfig {
  fast: { model: string; contextLimit?: number };
  smart: { model: string; contextLimit?: number };
  default: { model: string; contextLimit?: number };
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

const MODEL_LABELS: Record<string, string> = {
  default: 'Default',
  fast: 'Fast',
  smart: 'Smart',
};

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [aliases, setAliases] = useState<ModelAliasConfig | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.modelAliases) {
          setAliases(data.modelAliases);
        }
      })
      .catch(() => {
        // Ignore errors - show empty state
      });
  }, []);

  const availableModels = aliases
    ? (Object.entries(aliases).filter(([, config]) => config.model) as [string, { model: string; contextLimit?: number }][])
    : [];

  if (availableModels.length === 0) {
    return null;
  }

  return (
    <PromptInputSelect value={value} onValueChange={onChange}>
      <PromptInputSelectTrigger className="gap-1.5 text-xs">
        <CpuIcon className="size-3.5 shrink-0" />
        <PromptInputSelectValue placeholder="Model" />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {availableModels.map(([key, config]) => (
          <PromptInputSelectItem key={key} value={key}>
            <span className="font-medium">{MODEL_LABELS[key] ?? key}</span>
            <span className="ml-1.5 text-muted-foreground text-xs">
              {config.model.split('/').pop()}
            </span>
          </PromptInputSelectItem>
        ))}
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
          // 只显示用户自定义 Agent（非 built-in）
          const userAgents = data.agents.filter(
            (a: AgentDef) => a.source === 'user' || a.source === 'project',
          );
          setAgents(userAgents);
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
      <PromptInputSelectTrigger className="gap-1.5 text-xs">
        <BotIcon className="size-3.5 shrink-0" />
        <PromptInputSelectValue placeholder="Agent" />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        <PromptInputSelectItem value="auto">
          <span className="font-medium">Auto</span>
          <span className="ml-1.5 text-muted-foreground text-xs">自动路由</span>
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
