import {
  ConversationSidebar,
  type ConversationItem,
} from "@/components/ConversationSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { nanoid } from "nanoid";
import { useCallback, createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Outlet } from "react-router-dom";

// ============================================================================
// ChatContext - Share sidebar state with child pages
// ============================================================================

interface ChatContextValue {
  activeConversationId: string | null;
  conversations: ConversationItem[];
  isLoading: boolean;
  switchToConversation: (id: string) => void;
  handleCreateConversation: () => Promise<void>;
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
// ChatLayout - React Router Layout Component
//
// Manages sidebar state and provides it to all child pages via Context.
// The sidebar persists across route changes within /chat/*
// ============================================================================

export default function ChatLayout() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const urlConversationId = params?.id ?? null;

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

  // Track the active conversation ID
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    urlConversationId
  );

  // Ref to prevent double-initialization
  const initializedRef = useRef(false);

  // Load conversations on mount
  useEffect(() => {
    async function loadConversations() {
      try {
        const res = await fetch("/api/conversations");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch {
        // Failed to load conversations
      } finally {
        setIsLoadingConversations(false);
      }
    }
    loadConversations();
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
      navigate(`/chat/${id}`);
    },
    [navigate]
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      switchToConversation(id);
    },
    [activeConversationId, switchToConversation]
  );

  const handleCreateConversation = useCallback(async () => {
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
        switchToConversation(newId);
      }
    } catch {
      // Failed to create
    }
  }, [switchToConversation]);

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
              navigate("/chat");
            }
          }
        }
      } catch {
        // Failed to delete
      }
    },
    [activeConversationId, conversations, switchToConversation, navigate]
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
            conversations={conversations}
            isLoading={isLoadingConversations}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
            onSelectConversation={handleSelectConversation}
          />

          {/* Main Content - changes per route */}
          <SidebarInset className="flex flex-col flex-1 overflow-hidden">
            {/* Top bar with sidebar toggle */}
            <div className="flex shrink-0 items-center border-b px-4 py-2">
              <SidebarTrigger />
            </div>
            {/* Outlet renders child routes */}
            <Outlet />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ChatContext.Provider>
  );
}