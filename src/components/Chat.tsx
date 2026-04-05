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
import type { ConversationItem } from "@/components/ConversationSidebar";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, UIMessage } from "ai";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

// ============================================================================
// Conversation ID persistence (localStorage)
// ============================================================================

const CONVERSATION_ID_KEY = "chat_conversation_id";

export function getStoredConversationId(): string | null {
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
// Chat Component Props
// ============================================================================

export interface ChatProps {
  /** Conversation ID to display. */
  conversationId: string;
  /** Callback when the AI-generated title updates (triggers sidebar refresh). */
  onTitleUpdated?: () => void;
}

// ============================================================================
// Main Chat Component
// ============================================================================

export default function Chat({
  conversationId,
  onTitleUpdated,
}: ChatProps) {
  // Track initial message count to detect first message completion
  const initialMessageCountRef = useRef<number | null>(null);

  // Ref to hold the original title, set when messages are loaded.
  // Used to detect when the AI-generated title replaces the fallback title.
  const originalTitleRef = useRef<string | null>(null);

  // Ref to hold the latest messages, avoiding stale closure in onFinish
  const messagesRef = useRef<UIMessage[]>([]);

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
    onFinish: async ({ messages: finishedMessages }) => {
      // Use the messages passed by the SDK, NOT the stale closure variable
      const msgCount = finishedMessages.length;

      // Detect if this is the first message in a new conversation
      if (initialMessageCountRef.current === 0 && msgCount > 0) {
        // Server is asynchronously generating the title (takes ~1-3 seconds).
        // Use lightweight polling to check for title update.
        let attempts = 0;
        const maxAttempts = 5;
        let timerId: ReturnType<typeof setTimeout> | null = null;

        const pollForTitle = async () => {
          attempts++;
          try {
            const res = await fetch("/api/conversations");
            if (res.ok) {
              const data = await res.json();
              const current = (data.conversations || []).find(
                (c: ConversationItem) => c.id === conversationId
              );

              // Compare against the original title stored when messages were loaded.
              // If the title changed (AI generation completed), refresh the sidebar.
              if (current && current.title !== originalTitleRef.current) {
                onTitleUpdated?.();
                return;
              }
            }
          } catch {
            // Network error, silently continue polling
          }

          if (attempts < maxAttempts) {
            timerId = setTimeout(pollForTitle, 1000);
          } else {
            // Final fallback: refresh regardless
            onTitleUpdated?.();
          }
        };

        // First poll after 1.5s to give server time for LLM call
        timerId = setTimeout(pollForTitle, 1500);
      }
    },
  });

  // Keep ref in sync with latest messages
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

        // Also capture the current title for this conversation
        if (!cancelled) {
          const convRes = await fetch("/api/conversations");
          if (convRes.ok) {
            const convData = await convRes.json();
            const current = (convData.conversations || []).find(
              (c: ConversationItem) => c.id === conversationId
            );
            originalTitleRef.current = current?.title ?? null;
          }
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
      {/* Conversation Area */}
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <ConversationEmptyState
            title="How can I help you today?"
            description="Start a conversation and I'll do my best to assist you."
          />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden pt-4">
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
        </div>
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
