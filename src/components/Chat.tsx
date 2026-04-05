"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { ConversationSidebar, type ConversationItem } from "@/components/ConversationSidebar";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, UIMessage } from "ai";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ============================================================================
// Conversation ID persistence (localStorage)
// ============================================================================

const CONVERSATION_ID_KEY = "chat_conversation_id";

function getStoredConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CONVERSATION_ID_KEY);
}

function setConversationId(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(CONVERSATION_ID_KEY, id);
  }
}

// ============================================================================
// Custom transport that includes conversationId
// ============================================================================

function createChatTransport(conversationId: string) {
  return new DefaultChatTransport({
    api: "/api/chat",
    body: { conversationId },
  });
}

// ============================================================================
// Inner Chat Component (re-created when conversation changes via key prop)
// ============================================================================

function ChatInner({
  conversationId,
  onTitleUpdated,
}: {
  conversationId: string;
  onTitleUpdated?: () => void;
}) {
  // Track initial message count to detect first message completion
  const initialMessageCountRef = useRef<number | null>(null);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
  } = useChat({
    transport: createChatTransport(conversationId),
    onFinish: async () => {
      // Detect if this is the first message in a new conversation
      if (initialMessageCountRef.current === 0 && messages.length > 0) {
        // Server is asynchronously generating the title (takes ~1-3 seconds).
        // Use lightweight polling to check for title update.
        let attempts = 0;
        const maxAttempts = 5;

        const pollForTitle = async () => {
          attempts++;
          try {
            const res = await fetch("/api/conversations");
            if (res.ok) {
              const data = await res.json();
              const current = (data.conversations || []).find(
                (c: ConversationItem) => c.id === conversationId
              );

              // Title is updated when it's no longer the raw truncated user message
              // AI-generated titles are typically short (< 20 chars)
              if (current && current.title.length <= 20) {
                onTitleUpdated?.();
                return;
              }
            }
          } catch {
            // Network error, silently continue polling
          }

          if (attempts < maxAttempts) {
            setTimeout(pollForTitle, 1000);
          } else {
            // Final fallback: refresh regardless
            onTitleUpdated?.();
          }
        };

        // First poll after 1.5s to give server time for LLM call
        setTimeout(pollForTitle, 1500);
      }
    },
  });

  // Load messages on mount
  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(
          `/api/chat?conversationId=${encodeURIComponent(conversationId)}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (!cancelled && data.messages && data.messages.length > 0) {
          // Record initial count so onFinish can detect first message
          initialMessageCountRef.current = data.messages.length;
          setMessages(data.messages as UIMessage[]);
        } else {
          // No existing messages - this is a brand new conversation
          initialMessageCountRef.current = 0;
        }
      } catch {
        // Failed to load
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [conversationId, setMessages]);

  const handleSend = useCallback(
    async ({ text }: { text: string }) => {
      if (text.trim()) {
        sendMessage({ text });
      }
    },
    [sendMessage]
  );

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  /**
   * Regenerate from a specific assistant message.
   * Truncates the message at `messageIndex` and all subsequent messages,
   * then triggers regeneration with a placeholder assistant message.
   */
  const handleRegenerate = useCallback(
    (messageIndex: number) => {
      // Remove the target message and all messages after it
      const truncated = messages.slice(0, messageIndex);

      // Add a placeholder assistant message so regenerate() has something to replace.
      // The SDK's regenerate() finds the last assistant message, removes it,
      // and generates a new response based on the remaining messages.
      const placeholderId = `regen-placeholder-${Date.now()}`;
      const withPlaceholder: UIMessage[] = [
        ...truncated,
        {
          id: placeholderId,
          role: "assistant",
          parts: [],
          createdAt: new Date(),
        } as UIMessage,
      ];

      setMessages(withPlaceholder);
      // Defer to next tick so React state update is flushed
      setTimeout(() => regenerate(), 0);
    },
    [messages, setMessages, regenerate]
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg">AI Assistant</h1>
            <p className="text-muted-foreground text-sm">
              Powered by Qwen 3.5
            </p>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <span>Connection error</span>
              <button
                type="button"
                onClick={() => regenerate()}
                className="underline"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Conversation Area */}
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <ConversationEmptyState
            title="How can I help you today?"
            description="Start a conversation and I'll do my best to assist you."
          />
        </div>
      ) : (
        <Conversation>
          <ConversationContent>
            {messages.map((message, messageIndex) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-${index}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }

                    if (isToolUIPart(part)) {
                      return (
                        <div
                          key={`${message.id}-${index}`}
                          className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                        >
                          Using tool: {part.type.replace("tool-", "")}
                        </div>
                      );
                    }

                    return null;
                  })}
                </MessageContent>

                {message.role === "assistant" && (
                  <MessageToolbar>
                    <MessageActions>
                      <MessageAction
                        label="Regenerate"
                        onClick={() => handleRegenerate(messageIndex)}
                        tooltip="Regenerate response"
                      >
                        <RefreshCcwIcon className="size-4" />
                      </MessageAction>
                      <MessageAction
                        label="Copy"
                        onClick={() =>
                          handleCopy(
                            message.parts
                              .filter((p) => p.type === "text")
                              .map((p) =>
                                p.type === "text" ? p.text : ""
                              )
                              .join("")
                          )
                        }
                        tooltip="Copy to clipboard"
                      >
                        <CopyIcon className="size-4" />
                      </MessageAction>
                    </MessageActions>
                  </MessageToolbar>
                )}
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Prompt Input */}
      <div className="border-t p-4">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={handleSend}>
            <PromptInputTextarea placeholder="Message AI Assistant..." />
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Chat Component with Sidebar
// ============================================================================

interface ChatProps {
  /** Conversation ID from URL params. Null means no active conversation. */
  conversationId: string | null;
}

export default function Chat({ conversationId: urlConversationId }: ChatProps) {
  const router = useRouter();

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);

  // Track the active conversation ID (may differ from URL during transitions)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    urlConversationId
  );

  // Counter to force re-creation of ChatInner when switching conversations
  const [chatKey, setChatKey] = useState(0);

  // Ref to prevent double-initialization
  const initializedRef = useRef(false);

  // Redirect to stored conversation on first mount if URL has no conversation
  useEffect(() => {
    if (initializedRef.current) return;
    if (urlConversationId) {
      initializedRef.current = true;
      return;
    }
    const storedId = getStoredConversationId();
    if (storedId) {
      router.replace(`/chat/${storedId}`);
    }
    initializedRef.current = true;
  }, [urlConversationId, router]);

  // Sync activeConversationId when URL param changes
  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setActiveConversationId(urlConversationId);
      setChatKey((k) => k + 1);
    }
  }, [urlConversationId]);

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

  // ============================================================================
  // Conversation management handlers
  // ============================================================================

  const switchToConversation = useCallback((id: string) => {
    setConversationId(id);
    router.push(`/chat/${id}`);
  }, [router]);

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
  // Render
  // ============================================================================

  return (
    <div className="flex h-screen w-full">
      {/* Sidebar */}
      <ConversationSidebar
        activeConversationId={activeConversationId}
        conversations={conversations}
        isLoading={isLoadingConversations}
        onCreateConversation={handleCreateConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onSelectConversation={handleSelectConversation}
      />

      {/* Main Chat Area */}
      {activeConversationId ? (
        <ChatInner 
          key={chatKey} 
          conversationId={activeConversationId}
          onTitleUpdated={handleRefreshConversations}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <ConversationEmptyState
            title="Start a new conversation"
            description="Click the + button in the sidebar to begin."
          />
        </div>
      )}
    </div>
  );
}
