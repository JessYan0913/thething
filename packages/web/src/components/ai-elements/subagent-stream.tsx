'use client';

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

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
      <span>Tokens: {total.toLocaleString()}</span>
      <span className="text-muted-foreground/50">|</span>
      <span>In: {input.toLocaleString()}</span>
      <span className="text-muted-foreground/50">|</span>
      <span>Out: {output.toLocaleString()}</span>
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
    <div className="mt-2 space-y-3 pt-3 text-sm">
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
          <div className="max-h-48 overflow-y-auto rounded-md bg-muted/30 border border-muted/50 p-2">
            <div className="text-muted-foreground/80 text-sm leading-relaxed">
              {displayText}
            </div>
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
