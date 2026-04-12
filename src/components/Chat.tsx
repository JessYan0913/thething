'use client';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { SubAgentStream } from '@/components/ai-elements/subagent-stream';
import { TaskPanel } from '@/components/chat-task-panel';
import type { SubDataPart } from '@/components/ai-elements/subagent-stream';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import type { ConversationItem } from '@/components/ConversationSidebar';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type ToolUIPart, UIMessage } from 'ai';
import { CopyIcon, RefreshCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

const CONVERSATION_ID_KEY = 'chat_conversation_id';

export function getStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CONVERSATION_ID_KEY);
}

function createChatTransport(conversationId: string) {
  return new DefaultChatTransport({
    api: '/api/chat',
    body: { conversationId },
    prepareSendMessagesRequest({ messages, body }) {
      return {
        body: {
          message: messages.at(-1),
          conversationId,
          ...body,
        },
      };
    },
  });
}

export interface ChatProps {
  conversationId: string;
  onTitleUpdated?: () => void;
}

export default function Chat({ conversationId, onTitleUpdated }: ChatProps) {
  const initialMessageCountRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);

  const transport = useMemo(() => createChatTransport(conversationId), [conversationId]);

  const { messages, setMessages, sendMessage, status, stop, regenerate, error } = useChat({
    id: conversationId,
    transport,
    onFinish: async ({ messages: finishedMessages }) => {
      try {
        const res = await fetch('/api/chat', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, messages: finishedMessages }),
        });
        if (!res.ok) {
          console.error('[Chat] Failed to save messages');
        }
      } catch (err) {
        console.error('[Chat] Error saving messages:', err);
      }

      const msgCount = finishedMessages.length;

      if (initialMessageCountRef.current === 0 && msgCount > 0) {
        let attempts = 0;
        const maxAttempts = 5;
        let timerId: ReturnType<typeof setTimeout> | null = null;

        const pollForTitle = async () => {
          attempts++;
          try {
            const res = await fetch('/api/conversations');
            if (res.ok) {
              const data = await res.json();
              const current = (data.conversations || []).find((c: ConversationItem) => c.id === conversationId);

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`);
        if (!res.ok) return;

        const data = await res.json();
        if (!cancelled && data.messages && data.messages.length > 0) {
          initialMessageCountRef.current = data.messages.length;
          setMessages(data.messages as UIMessage[]);
        } else {
          initialMessageCountRef.current = 0;
        }

        if (!cancelled) {
          const convRes = await fetch('/api/conversations');
          if (convRes.ok) {
            const convData = await convRes.json();
            const current = (convData.conversations || []).find((c: ConversationItem) => c.id === conversationId);
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
    [sendMessage],
  );

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const handleRegenerate = useCallback(
    (messageIndex: number) => {
      const lastUserMessageIndex = messages.findLastIndex(
        (m, idx) => m.role === 'user' && idx < messageIndex,
      );

      if (lastUserMessageIndex === -1) {
        return;
      }

      const userMessageToResend = messages[lastUserMessageIndex];

      setMessages(messages.slice(0, lastUserMessageIndex));

      sendMessage(userMessageToResend);
    },
    [messages, setMessages, sendMessage],
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {error && (
        <div className="mx-4 mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error.message}</div>
      )}

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
                const reasoningParts = message.parts.filter((part) => part.type === 'reasoning');
                const reasoningText = reasoningParts.map((part) => part.text).join('\n\n');
                const hasReasoning = reasoningParts.length > 0;

                const lastPart = message.parts.at(-1);
                const isReasoningStreaming =
                  messageIndex === messages.length - 1 && status === 'streaming' && lastPart?.type === 'reasoning';

                return (
                  <Message from={message.role} key={message.id}>
                    <MessageContent>
                      {hasReasoning && (
                        <Reasoning className="w-full" isStreaming={isReasoningStreaming}>
                          <ReasoningTrigger />
                          <ReasoningContent>{reasoningText}</ReasoningContent>
                        </Reasoning>
                      )}
                      {message.parts.map((part, index) => {
                        if (part.type === 'text') {
                          return <MessageResponse key={`${message.id}-${index}`}>{part.text}</MessageResponse>;
                        }

                        if (part.type.startsWith('data-sub-')) {
                          return null;
                        }

                        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                          const toolPart = part as ToolUIPart;
                          const toolCallId = (toolPart as unknown as { toolCallId?: string }).toolCallId;

                          const subParts = toolCallId
                            ? (message.parts as SubDataPart[]).filter(
                                (p) => p.type.startsWith('data-sub-') && p.id === toolCallId,
                              )
                            : [];

                          const isSubAgent = subParts.length > 0;
                          const isStreaming = toolPart.state === 'input-available' || toolPart.state === 'input-streaming';

                          return (
                            <Tool
                              key={`${message.id}-${index}`}
                              defaultOpen={toolPart.state === 'output-available' || toolPart.state === 'output-error' || isStreaming}
                            >
                              <ToolHeader type={toolPart.type} state={toolPart.state} isStreaming={isStreaming} />
                              <ToolContent>
                                <ToolInput input={toolPart.input} />
                                {isSubAgent ? (
                                  <SubAgentStream parts={subParts} />
                                ) : (
                                  <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                                )}
                              </ToolContent>
                            </Tool>
                          );
                        }

                        return null;
                      })}
                    </MessageContent>

                    {message.role === 'assistant' && (
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
                                  .filter((p) => p.type === 'text')
                                  .map((p) => (p.type === 'text' ? p.text : ''))
                                  .join(''),
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

      <div className="shrink-0 border-t p-4">
        <div className="mx-auto max-w-3xl">
          {/* Task List Panel - always visible above input */}
          <TaskPanel conversationId={conversationId} />

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