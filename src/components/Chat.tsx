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
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import type { ConversationItem } from "@/components/ConversationSidebar";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ToolUIPart, UIMessage } from "ai";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

// ============================================================================
// Conversation ID persistence (localStorage)
// ============================================================================

const CONVERSATION_ID_KEY = "chat_conversation_id";

export function getStoredConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CONVERSATION_ID_KEY);
}

// ============================================================================
// Custom transport that includes conversationId
// ============================================================================

function createChatTransport(conversationId: string) {
  return new DefaultChatTransport({
    api: "/api/chat",
    body: { conversationId },
    prepareSendMessagesRequest({messages, body}) {
      return {
        body: {
          message: messages.at(-1),
          conversationId,
          ...body,
        }
      }
    }
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
  const initialMessageCountRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);

  const transport = useMemo(
    () => createChatTransport(conversationId),
    [conversationId]
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
  } = useChat({
    id: conversationId,
    transport,
    onFinish: async ({ messages: finishedMessages }) => {
      const msgCount = finishedMessages.length;

      if (initialMessageCountRef.current === 0 && msgCount > 0) {
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
            onTitleUpdated?.();
          }
        };

        timerId = setTimeout(pollForTitle, 1500);

        return () => {
          if (timerId) clearTimeout(timerId);
        };
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
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {/* Conversation Area */}
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <ConversationEmptyState
            title="How can I help you today?"
            description="Start a conversation and I'll do my best to assist you."
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pt-4">
          <Conversation>
            <ConversationContent>
            {messages.map((message, messageIndex) => {
              // Consolidate all reasoning parts into one block
              const reasoningParts = message.parts.filter(
                (part) => part.type === "reasoning"
              );
              const reasoningText = reasoningParts.map((part) => part.text).join("\n\n");
              const hasReasoning = reasoningParts.length > 0;

              // Check if reasoning is still streaming (last part is reasoning on last message)
              const lastPart = message.parts.at(-1);
              const isReasoningStreaming =
                messageIndex === messages.length - 1 &&
                status === "streaming" &&
                lastPart?.type === "reasoning";

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {hasReasoning && (
                      <Reasoning
                        className="w-full"
                        isStreaming={isReasoningStreaming}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{reasoningText}</ReasoningContent>
                      </Reasoning>
                    )}
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={`${message.id}-${index}`}>
                            {part.text}
                          </MessageResponse>
                        );
                      }

                      if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                        const toolPart = part as ToolUIPart;
                        return (
                          <Tool key={`${message.id}-${index}`} defaultOpen={toolPart.state === "output-available" || toolPart.state === "output-error"}>
                            <ToolHeader
                              type={toolPart.type}
                              state={toolPart.state}
                            />
                            <ToolContent>
                              <ToolInput input={toolPart.input} />
                              <ToolOutput
                                output={toolPart.output}
                                errorText={toolPart.errorText}
                              />
                            </ToolContent>
                          </Tool>
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
              );
            })}
          </ConversationContent>
          <ConversationScrollButton />
          </Conversation>
        </div>
      )}

      {/* Prompt Input */}
      <div className="shrink-0 border-t p-4">
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
