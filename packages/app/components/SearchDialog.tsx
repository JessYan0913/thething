"use client";

// ============================================================================
// SearchDialog — 全局会话检索（⌘K / Ctrl+K）
// 调用 /api/search 全文检索会话消息与标题；点击结果跳转到对应会话
// 并（命中消息时）带 ?message= 让 Chat 页滚动定位 + 高亮。
// 挂载于 ChatLayout，覆盖全部 /chat/* 路由。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface SearchSnippet {
  messageId: string | null;
  role: 'user' | 'assistant' | 'system' | null;
  text: string;
  matchIndex: number;
}

interface SearchResult {
  conversation: {
    id: string;
    title: string;
    source: string;
    sourceId: string | null;
    projectId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  snippet: SearchSnippet;
  matchCount: number;
}

// ============================================================================
// Date group (与 ConversationSidebar 相同的分桶)
// ============================================================================

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'thisWeek';
  return 'earlier';
}

const DATE_GROUP_KEYS: Record<string, string> = {
  today: 'chat:conversation.dateGroup.today',
  yesterday: 'chat:conversation.dateGroup.yesterday',
  thisWeek: 'chat:conversation.dateGroup.thisWeek',
  earlier: 'chat:conversation.dateGroup.earlier',
};

// ============================================================================
// Highlight — 截断命中上下文 + 高亮命中子串
// ============================================================================

function HighlightSnippet({
  text,
  matchIndex,
  query,
}: {
  text: string;
  matchIndex: number;
  query: string;
}) {
  // matchIndex 由后端按大小写不敏感定位；切片时按原始 text 字节
  const hasMatch = matchIndex >= 0 && query.length > 0;
  const qLen = hasMatch ? query.length : 0;
  const start = hasMatch ? Math.max(0, matchIndex - 60) : 0;
  const end = hasMatch ? Math.min(text.length, matchIndex + qLen + 60) : text.length;

  const before = text.slice(start, hasMatch ? matchIndex : end);
  const matched = hasMatch ? text.slice(matchIndex, matchIndex + qLen) : '';
  const after = hasMatch ? text.slice(matchIndex + qLen, end) : '';

  return (
    <>
      {start > 0 && '…'}
      {before}
      {hasMatch && (
        <mark className="rounded-sm bg-amber-200/70 px-0.5 text-inherit">{matched}</mark>
      )}
      {after}
      {end < text.length && '…'}
    </>
  );
}

// ============================================================================
// SearchDialog
// ============================================================================

const SEARCH_DEBOUNCE_MS = 280;

export default function SearchDialog({
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  /** 受控开关（侧边栏按钮传入）；缺省时自管理 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const requestSeqRef = useRef(0);

  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChangeProp?.(next);
  };

  // ⌘K / Ctrl+K 全局开关
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 每次打开时重置检索状态（⌘K 与侧边栏按钮共用入口）
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setStatus('idle');
    }
  }, [open]);

  // 防抖检索
  useEffect(() => {
    const q = query.trim();
    const seq = ++requestSeqRef.current;
    if (!q) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setResults([]);
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (seq !== requestSeqRef.current) return; // 过期请求丢弃
        const data = res.ok ? await res.json() : { results: [] };
        if (seq !== requestSeqRef.current) return;
        setResults((data.results ?? []) as SearchResult[]);
        setStatus('done');
      } catch {
        if (seq !== requestSeqRef.current) return;
        setResults([]);
        setStatus('done');
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const conv = result.conversation;
      const messageParam = result.snippet.messageId
        ? `?message=${encodeURIComponent(result.snippet.messageId)}`
        : '';
      router.push(
        `/chat/${encodeURIComponent(conv.source)}/${encodeURIComponent(conv.id)}${messageParam}`
      );
      setOpen(false);
    },
    [router]
  );

  const roleLabel = (role: SearchSnippet['role']) => {
    switch (role) {
      case 'user': return t('chat:search.role_user');
      case 'assistant': return t('chat:search.role_assistant');
      case 'system': return t('chat:search.role_system');
      default: return null;
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('chat:search.title')}
      description={t('chat:search.placeholder')}
    >
      <CommandInput
        autoFocus
        placeholder={t('chat:search.placeholder')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="space-y-1.5 p-1.5">
        {status === 'loading' && results.length === 0 && (
          <CommandEmpty>{t('chat:search.loading')}</CommandEmpty>
        )}
        {status !== 'loading' && results.length === 0 && (
          <CommandEmpty>
            {query.trim() ? t('chat:search.noResults') : t('chat:search.empty')}
          </CommandEmpty>
        )}
        {results.map((result) => {
          const { conversation, snippet } = result;
          return (
            <CommandItem
              key={conversation.id}
              value={`${conversation.title} ${snippet.text}`}
              onSelect={() => handleSelect(result)}
              className="flex flex-col items-start gap-0.5 py-2.5"
            >
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {conversation.title || 'New Conversation'}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                  {snippet.messageId && roleLabel(snippet.role) && (
                    <span className="rounded border bg-muted/60 px-1 py-px">
                      {roleLabel(snippet.role)}
                    </span>
                  )}
                  <span>{t(DATE_GROUP_KEYS[getDateGroup(conversation.updatedAt || conversation.createdAt)] ?? 'earlier')}</span>
                </span>
              </div>
              <span className={cn('line-clamp-1 w-full pr-2 text-xs text-muted-foreground')}>
                <HighlightSnippet text={snippet.text} matchIndex={snippet.matchIndex} query={query.trim()} />
                {result.matchCount > 1 && (
                  <span className="ml-1 text-muted-foreground/70">
                    {t('chat:search.matches', { count: result.matchCount })}
                  </span>
                )}
              </span>
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
