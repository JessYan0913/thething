'use client';

import { cn } from '@/lib/utils';
import { Bot, Cpu, Shield, Wrench, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface SlashCommandItem {
  id: string;
  type: 'agent' | 'model' | 'mode' | 'skill' | 'goal';
  label: string;
  description?: string;
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onHover: (index: number) => void;
}

const TYPE_META: Record<string, { label: string; icon: typeof Bot }> = {
  agent: { label: 'Agents', icon: Bot },
  model: { label: 'Models', icon: Cpu },
  mode: { label: 'Approval Mode', icon: Shield },
  skill: { label: 'Skills', icon: Wrench },
  goal: { label: 'Goal', icon: Sparkles },
};

export function SlashCommandMenu({ items, selectedIndex, onSelect, onHover }: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElement = listRef.current.querySelector(`[data-cmd-index="${selectedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);
  // Group items by type
  const groups: Record<string, SlashCommandItem[]> = {};
  for (const item of items) {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push(item);
  }

  let flatIndex = 0;

  return (
    <div
      data-slash-menu
      className="absolute bottom-full left-0 right-0 z-50 mb-2"
    >
      <div className="mx-auto max-w-3xl rounded-xl border bg-popover shadow-lg overflow-hidden">
        {items.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No results found
          </div>
        ) : (
          <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1">
            {Object.entries(groups).map(([type, groupItems]) => {
              const meta = TYPE_META[type] || { label: type, icon: Sparkles };
              const Icon = meta.icon;
              return (
                <div key={type} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground select-none">
                    <Icon className="size-3" />
                    {meta.label}
                  </div>
                  {groupItems.map((item) => {
                    const idx = flatIndex++;
                    return (
                      <button
                        key={item.id}
                        data-cmd-index={idx}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors text-left',
                          idx === selectedIndex
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/50',
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onSelect(item);
                        }}
                        onMouseEnter={() => onHover(idx)}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{item.label}</span>
                          {item.description && item.type !== 'skill' && item.type !== 'agent' && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-3 select-none">
          <span>↑↓</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
