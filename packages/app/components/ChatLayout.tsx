import {
  ConversationSidebar,
  type ConversationItem,
} from "@/components/ConversationSidebar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { nanoid } from "nanoid";
import { useCallback, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

export interface FilterOption {
  value: string;
  label: string;
  group?: string;
}

const SourceFilter = ({
  filterOptions,
  activeFilter,
  onFilterChange,
}: {
  filterOptions: FilterOption[];
  activeFilter: string;
  onFilterChange: (value: string) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Select value={activeFilter} onValueChange={onFilterChange}>
      <SelectTrigger size="sm" className="h-8 w-[160px] gap-1 rounded-md bg-sidebar-accent/50 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors px-3 border-0 shadow-none [&>svg]:size-3">
        <SelectValue />
      </SelectTrigger>
      <SelectContent sideOffset={4} className="min-w-36">
        {(() => {
          const ungrouped = filterOptions.filter((o) => !o.group);
          const grouped = filterOptions.filter((o) => o.group);
          const groups = [...new Set(grouped.map((o) => o.group!))];
          return (
            <>
              {ungrouped.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.label)}
                </SelectItem>
              ))}
              {groups.map((groupKey) => (
                <SelectGroup key={groupKey}>
                  <SelectSeparator />
                  <SelectLabel>{t(groupKey)}</SelectLabel>
                  {grouped
                    .filter((o) => o.group === groupKey)
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </>
          );
        })()}
      </SelectContent>
    </Select>
  );
}

// ============================================================================
// ChatContext - Share sidebar state with child pages
// ============================================================================

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatContextValue {
  activeConversationId: string | null;
  conversations: ConversationItem[];
  isLoading: boolean;
  switchToConversation: (id: string) => void;
  handleCreateConversation: (options?: { initialMessage?: string }) => Promise<void>;
  handleDeleteConversation: (id: string) => Promise<void>;
  handleRenameConversation: (id: string, title: string) => Promise<void>;
  handleRefreshConversations: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within ChatProvider");
  }
  return context;
}

// ============================================================================
// ChatLayout - Next.js Layout Component
//
// Manages sidebar state and provides it to all child pages via Context.
// The sidebar persists across route changes within /chat/*
// ============================================================================

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ source?: string; chatId?: string }>();
  const urlSearchParams = useSearchParams();
  const urlConversationId = params?.chatId ?? null;

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

  // Project state
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Source filter from URL: /chat/[source]?sid=subId
  // /chat → 'user'
  // /chat/connector → 'connector'
  // /chat/connector?sid=feishu → 'connector:feishu'
  // /chat/connector/{chatId}?sid=feishu → 'connector:feishu'
  const sourceFilter = (() => {
    if (!params.source) return 'user';
    const sid = urlSearchParams.get('sid');
    return sid ? `${params.source}:${sid}` : params.source;
  })();

  // List view when no chatId in URL
  const isChatHome = !params.chatId;
  const [connectors, setConnectors] = useState<{ id: string; name: string }[]>([]);
  const [cronJobs, setCronJobs] = useState<{ id: string; name: string }[]>([]);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    urlConversationId
  );

  // Derive active conversation title
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const activeConversationTitle = activeConversation?.title;

  // Ref to prevent double-initialization
  const initializedRef = useRef(false);

  // Load conversations, connectors, cron jobs, and projects on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [convRes, connRes, cronRes, projRes] = await Promise.all([
          fetch("/api/conversations"),
          fetch("/api/connectors"),
          fetch("/api/cron"),
          fetch("/api/projects"),
        ]);
        if (convRes.ok) {
          const data = await convRes.json();
          setConversations(data.conversations || []);
        }
        if (connRes.ok) {
          const data = await connRes.json();
          setConnectors(
            (data.connectors || []).map((c: { id: string; name: string }) => ({
              id: c.id,
              name: c.name,
            }))
          );
        }
        if (cronRes.ok) {
          const data = await cronRes.json();
          setCronJobs(
            (data.jobs || []).map((j: { id: string; name: string }) => ({
              id: j.id,
              name: j.name,
            }))
          );
        }
        if (projRes.ok) {
          const data = await projRes.json();
          setProjects(data.projects || []);
        }
      } catch {
        // Failed to load data
      } finally {
        setIsLoadingConversations(false);
      }
    }
    loadData();
  }, []);

  // Sync activeConversationId when URL param changes
  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setActiveConversationId(urlConversationId);
    }
  }, [urlConversationId]);

  // ============================================================================
  // Conversation management handlers
  // ============================================================================

  const switchToConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      // Find the conversation's source from loaded list
      const conv = conversations.find(c => c.id === id);
      const source = conv?.source || 'user';
      const encodedId = encodeURIComponent(id);
      // Preserve sub-filter (sid) when navigating from a filtered list view
      const sid = sourceFilter.includes(':') ? sourceFilter.split(':').slice(1).join(':') : null;
      const url = sid
        ? `/chat/${source}/${encodedId}?sid=${encodeURIComponent(sid)}`
        : `/chat/${source}/${encodedId}`;
      router.push(url);
    },
    [router, conversations, sourceFilter]
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      switchToConversation(id);
    },
    [activeConversationId, switchToConversation]
  );

  const handleCreateConversation = useCallback(async (options?: { initialMessage?: string }) => {
    const newId = nanoid();
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId, projectId: activeProjectId || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) => [data.conversation, ...prev]);
        setActiveConversationId(newId);
        const url = options?.initialMessage
          ? `/chat/user/${newId}?msg=${encodeURIComponent(options.initialMessage)}`
          : `/chat/user/${newId}`;
        router.push(url);
      }
    } catch {
      // Failed to create
    }
  }, [router, activeProjectId]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/conversations?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          if (id === activeConversationId) {
            const remaining = conversations.filter((c) => c.id !== id);
            if (remaining.length > 0) {
              switchToConversation(remaining[0].id);
            } else {
              // No conversations left, go to base /chat
              setActiveConversationId(null);
              router.push("/chat");
            }
          }
        }
      } catch {
        // Failed to delete
      }
    },
    [activeConversationId, conversations, switchToConversation, router]
  );

  const handleRenameConversation = useCallback(
    async (id: string, title: string) => {
      try {
        const res = await fetch("/api/conversations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, title }),
        });
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, title } : c))
          );
        }
      } catch {
        // Failed to rename
      }
    },
    []
  );

  /** Refresh conversation list from server (used after AI title generation) */
  const handleRefreshConversations = useCallback(async () => {
    try {
      const url = activeProjectId
        ? `/api/conversations?projectId=${encodeURIComponent(activeProjectId)}`
        : "/api/conversations";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Failed to refresh
    }
  }, [activeProjectId]);

  // ============================================================================
  // Project management
  // ============================================================================

  const handleSelectProject = useCallback(async (projectId: string | null) => {
    setActiveProjectId(projectId);
    // Reload conversations for the selected project
    try {
      const url = projectId
        ? `/api/conversations?projectId=${encodeURIComponent(projectId)}`
        : "/api/conversations";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Failed to load conversations
    }
  }, []);

  const handleCreateProject = useCallback(async (name: string, path: string) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects((prev) => [data.project, ...prev]);
        // Auto-select the new project and load its conversations
        setActiveProjectId(data.project.id);
        const convRes = await fetch(`/api/conversations?projectId=${encodeURIComponent(data.project.id)}`);
        if (convRes.ok) {
          const convData = await convRes.json();
          setConversations(convData.conversations || []);
        }
        return data.project;
      }
    } catch {
      // Failed to create
    }
    return null;
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
        if (activeProjectId === projectId) {
          setActiveProjectId(null);
          // Reload all conversations
          const convRes = await fetch("/api/conversations");
          if (convRes.ok) {
            const data = await convRes.json();
            setConversations(data.conversations || []);
          }
        }
      }
    } catch {
      // Failed to delete
    }
  }, [activeProjectId]);

  // ============================================================================
  // Source filter
  // ============================================================================

  // Handle filter change — navigate to new path
  const handleFilterChange = useCallback((value: string) => {
    if (value === 'user') {
      router.push('/chat');
    } else if (value.startsWith('connector:')) {
      const sid = value.slice('connector:'.length);
      router.push(sid ? `/chat/connector?sid=${encodeURIComponent(sid)}` : '/chat/connector');
    } else if (value.startsWith('cron:')) {
      const sid = value.slice('cron:'.length);
      router.push(sid ? `/chat/cron?sid=${encodeURIComponent(sid)}` : '/chat/cron');
    }
  }, [router]);

  const filterOptions = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [{ value: "user", label: "chat:conversation.filter.conversations" }];
    for (const c of connectors) {
      options.push({ value: `connector:${c.id}`, label: c.name, group: "chat:conversation.filter.connectors" });
    }
    for (const job of cronJobs) {
      options.push({ value: `cron:${job.id}`, label: job.name, group: "chat:conversation.filter.automation" });
    }
    return options;
  }, [connectors, cronJobs]);

  const showFilter = connectors.length > 0 || cronJobs.length > 0;

  const filteredConversations = useMemo(() => {
    if (sourceFilter === "user") {
      return conversations.filter((c) => c.source === 'user');
    }
    // Parse sourceType and optional sub-id: "connector" / "connector:feishu" / "cron" / "cron:job1"
    const colonIdx = sourceFilter.indexOf(':');
    const sourceType = colonIdx >= 0 ? sourceFilter.slice(0, colonIdx) : sourceFilter;
    const subId = colonIdx >= 0 ? sourceFilter.slice(colonIdx + 1) : '';
    if (sourceType === 'connector') {
      return conversations.filter((c) => c.source === 'connector' && (!subId || c.sourceId === subId));
    }
    if (sourceType === 'cron') {
      return conversations.filter((c) => c.source === 'cron' && (!subId || c.sourceId === subId));
    }
    return conversations;
  }, [conversations, sourceFilter]);

  // ============================================================================
  // Context value
  // ============================================================================

  const contextValue: ChatContextValue = {
    activeConversationId,
    conversations,
    isLoading: isLoadingConversations,
    switchToConversation,
    handleCreateConversation,
    handleDeleteConversation,
    handleRenameConversation,
    handleRefreshConversations,
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <ChatContext.Provider value={contextValue}>
      <SidebarProvider style={{ height: "100dvh" }}>
        <div className="flex h-full w-full overflow-hidden">
          {/* Sidebar - persists across route changes */}
          <ConversationSidebar
            activeConversationId={activeConversationId}
            conversations={filteredConversations}
            isLoading={isLoadingConversations}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
            onSelectConversation={handleSelectConversation}
            activeFilter={sourceFilter}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
          />

          {/* Main Content - changes per route */}
          <SidebarInset className="flex flex-col flex-1 overflow-hidden">
            {/* Top bar with sidebar toggle and current conversation title */}
            <div className="flex shrink-0 items-center justify-between border-b bg-background/80 backdrop-blur-md px-4 h-12">
              <div className="flex items-center gap-2 min-w-0">
                <SidebarTrigger />
                <div className="h-4 w-px bg-border shrink-0" />
                <span className="text-sm font-medium text-muted-foreground truncate">
                  {activeConversationTitle || (isChatHome ? 'TheThing' : '...')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {showFilter && (
                  <SourceFilter
                    filterOptions={filterOptions}
                    activeFilter={sourceFilter}
                    onFilterChange={handleFilterChange}
                  />
                )}
              </div>
            </div>
            {/* Children renders child routes */}
            {children}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ChatContext.Provider>
  );
}
