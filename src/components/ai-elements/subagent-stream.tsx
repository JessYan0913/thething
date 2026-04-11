'use client';

import { MessageResponse } from '@/components/ai-elements/message';
import { WrenchIcon } from 'lucide-react';

export interface SubDataPart {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

export interface SubAgentStreamProps {
  parts: SubDataPart[];
}

function TokenBar({ input, output, total }: { input: number; output: number; total: number }) {
  if (!total) return null;
  const inputPercent = ((input / total) * 100).toFixed(1);
  const outputPercent = ((output / total) * 100).toFixed(1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">Token Usage</span>
        <span className="font-semibold">{total.toLocaleString()}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-blue-500 transition-all duration-300"
          style={{ width: `${inputPercent}%` }}
        />
        <div
          className="bg-emerald-500 transition-all duration-300"
          style={{ width: `${outputPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-500" />
          <span className="text-muted-foreground">Input</span>
          <span className="font-medium">{inputPercent}%</span>
          <span className="text-muted-foreground">({input.toLocaleString()})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">Output</span>
          <span className="font-medium">{outputPercent}%</span>
          <span className="text-muted-foreground">({output.toLocaleString()})</span>
        </div>
      </div>
    </div>
  );
}

export function SubAgentStream({ parts }: SubAgentStreamProps) {
  const lastTextDelta = [...parts].reverse().find((p) => p.type === 'data-sub-text-delta');
  const accumulatedText = (lastTextDelta?.data?.accumulated as string | undefined) ?? '';

  const toolCalls = parts.filter((p) => p.type === 'data-sub-tool-call').map((p) => p.data?.name as string);

  const donePart = parts.find((p) => p.type === 'data-sub-done');
  const isRunning = !donePart;
  const tokenUsage = donePart?.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

  const displayText = accumulatedText;
  if (toolCalls.length === 0 && !displayText && !isRunning) return null;

  return (
    <div className="mt-2 space-y-3 border-t pt-3 text-sm">
      {toolCalls.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Steps</p>
          {toolCalls.map((name, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <WrenchIcon className="size-3 shrink-0" />
              {name}
            </div>
          ))}
        </div>
      )}
      {displayText && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Output</p>
          <div className="max-h-48 overflow-y-auto rounded-md bg-muted/50 p-2">
            <MessageResponse>{displayText}</MessageResponse>
          </div>
        </div>
      )}
      {!isRunning && tokenUsage?.totalTokens && (
        <div className="space-y-1.5">
          <TokenBar
            input={tokenUsage.inputTokens ?? 0}
            output={tokenUsage.outputTokens ?? 0}
            total={tokenUsage.totalTokens}
          />
        </div>
      )}
    </div>
  );
}
