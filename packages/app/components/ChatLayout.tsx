import {
  ConversationSidebar,
  type ConversationItem,
} from "@/components/ConversationSidebar";
import { ModeToggle } from "@/components/ModeToggle";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { nanoid } from "nanoid";
import { useCallback, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";

// ============================================================================
// ChatContext - Share sidebar state with child pages
// ============================================================================

export interface FilterOption {
  value: string;
  label: string;
  group?: string;
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
  const params = useParams<{ id?: string }>();
  const urlConversationId = params?.id ?? null;

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

  // Source filter state
  const [sourceFilter, setSourceFilter] = useState<string>("user");
  const [connectors, setConnectors] = useState<{ id: string; name: string }[]>([]);
  const [cronJobs, setCronJobs] = useState<{ id: string; name: string }[]>([]);

  // Track the active conversation ID
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    urlConversationId
  );

  // Ref to prevent double-initialization
  const initializedRef = useRef(false);

  // Load conversations, connectors, and cron jobs on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [convRes, connRes, cronRes] = await Promise.all([
          fetch("/api/conversations"),
          fetch("/api/connectors"),
          fetch("/api/cron"),
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
      router.push(`/chat/${id}`);
    },
    [router]
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
        body: JSON.stringify({ id: newId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) => [data.conversation, ...prev]);
        setActiveConversationId(newId);
        const url = options?.initialMessage
          ? `/chat/${newId}?msg=${encodeURIComponent(options.initialMessage)}`
          : `/chat/${newId}`;
        router.push(url);
      }
    } catch {
      // Failed to create
    }
  }, [router]);

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
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Failed to refresh
    }
  }, []);

  // ============================================================================
  // Source filter
  // ============================================================================

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
      return conversations.filter((c) => !c.id.startsWith("connector:"));
    }
    // cron:{jobId} — filter by specific cron job
    if (sourceFilter.startsWith("cron:")) {
      const jobId = sourceFilter.slice("cron:".length);
      return conversations.filter((c) => c.id.includes(`cron-${jobId}`));
    }
    // connector:{connectorId}
    if (sourceFilter.startsWith("connector:")) {
      const prefix = `${sourceFilter}:channel:`;
      return conversations.filter((c) => c.id.startsWith(prefix));
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
            filterOptions={showFilter ? filterOptions : undefined}
            activeFilter={sourceFilter}
            onFilterChange={setSourceFilter}
          />

          {/* Main Content - changes per route */}
          <SidebarInset className="flex flex-col flex-1 overflow-hidden">
            {/* Top bar with sidebar toggle */}
            <div className="flex shrink-0 items-center justify-between border-b bg-background/80 backdrop-blur-md px-4 h-12">
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <div className="h-4 w-px bg-border" />
                <span className="text-sm font-medium text-muted-foreground">TheThing</span>
              </div>
              <ModeToggle />
            </div>
            {/* Children renders child routes */}
            {children}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ChatContext.Provider>
  );
}
