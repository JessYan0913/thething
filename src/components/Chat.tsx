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
import { ToolOutput } from '@/components/ai-elements/tool';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task';
import { ApprovalPanel } from '@/components/ai-elements/approval-panel';
import { UserQuestionPanel } from '@/components/ai-elements/user-question-panel';
import type { ConversationItem } from '@/components/ConversationSidebar';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type ToolUIPart, UIMessage, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { CopyIcon, RefreshCcwIcon, SearchIcon, ChevronDownIcon, FileIcon, EditIcon, TerminalIcon, UserIcon, PlusIcon, RefreshCwIcon, ListIcon, TrashIcon, SquareIcon, BookIcon, CheckCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CONVERSATION_ID_KEY = 'chat_conversation_id';

const TASK_TOOL_TYPES = new Set([
  'tool-task_create',
  'tool-task_update',
  'tool-task_list',
  'tool-task_get',
  'tool-task_stop',
  'tool-task_delete',
]);

function getToolTitleAndIcon(type: string, input: Record<string, unknown> | null): { title: string; icon: React.ComponentType<{ className?: string }> } | undefined {
  const toolType = type.replace('tool-', '');
  const i = input ?? {};

  switch (toolType) {
    case 'write_file':
      return { title: `Write: ${i.filePath ?? 'file'}`, icon: FileIcon };
    case 'read':
    case 'read_file':
      return { title: `Read: ${i.filePath ?? 'file'}`, icon: FileIcon };
    case 'edit':
    case 'edit_file':
      return { title: `Edit: ${i.filePath ?? 'file'}`, icon: EditIcon };
    case 'glob':
      return { title: `Glob: ${i.pattern ?? ''}`, icon: SearchIcon };
    case 'grep':
      return { title: `Grep: ${i.pattern ?? ''}`, icon: SearchIcon };
    case 'bash':
      return { title: `Bash: ${String(i.command ?? '').slice(0, 40)}...`, icon: TerminalIcon };
    case 'search':
    case 'exa_search':
      return { title: `Search: ${i.query ?? ''}`, icon: SearchIcon };
    case 'agent':
      return { title: `${i.agentType ?? 'Agent'}: ${String(i.task ?? '').slice(0, 30)}...`, icon: UserIcon };
    case 'task_create':
      return { title: `Create: ${i.subject ?? ''}`, icon: PlusIcon };
    case 'task_update':
      return { title: `Update: ${i.subject ?? i.id ?? ''}`, icon: RefreshCwIcon };
    case 'task_list':
      return { title: i.status ? `Tasks (${i.status})` : 'Tasks', icon: ListIcon };
    case 'task_get':
      return { title: `Get: ${i.id ?? ''}`, icon: SearchIcon };
    case 'task_stop':
      return { title: `Stop: ${i.id ?? ''}`, icon: SquareIcon };
    case 'task_delete':
      return { title: `Delete: ${i.id ?? ''}`, icon: TrashIcon };
    case 'research': 
      return { title: `Research: ${i.task ?? ''}`, icon: BookIcon };
    default:
      return undefined;
  }
}

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

  // 审批对话框状态（用于工具审批）
  const [approvalDialog, setApprovalDialog] = useState<{
    isOpen: boolean;
    approvalId: string;
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  } | null>(null);

  // 问题收集面板状态（用于 ask_user_question）
  const [questionPanel, setQuestionPanel] = useState<{
    isOpen: boolean;
    approvalId: string;
    toolCallId: string;
    questions: Array<{
      question: string;
      header: string;
      options: string[];
      multiSelect?: boolean;
    }>;
  } | null>(null);

  const transport = useMemo(() => createChatTransport(conversationId), [conversationId]);

  const { messages, setMessages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat({
    id: conversationId,
    transport,
    sendAutomaticallyWhen: ({ messages }) => {
      const lastMsg = messages.at(-1);
      if (lastMsg?.role === 'assistant' && lastMsg.parts.some((p) => p.type === 'data-plan')) {
        return false;
      }
      return (
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
        lastAssistantMessageIsCompleteWithToolCalls({ messages })
      );
    },
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

    // 检测 approval-requested 状态并显示审批对话框
    // 注意：审批请求的part类型是 "tool-${toolName}" 或 "dynamic-tool"，state为 "approval-requested"
    if (status === 'streaming' || status === 'submitted') {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        for (const part of lastMessage.parts) {
          // 使用正确的类型检测逻辑：type.startsWith('tool-') 或 type === 'dynamic-tool'
          const isToolPart = part.type.startsWith('tool-') || part.type === 'dynamic-tool';
          const hasToolCallId = 'toolCallId' in part;
          const toolState = (part as { state?: string }).state;

          if (isToolPart && hasToolCallId && toolState === 'approval-requested') {
            // 从 part 中提取审批和工具调用信息
            const toolPart = part as unknown as {
              toolCallId: string;
              toolName?: string;
              input?: Record<string, unknown>;
              approval?: { id: string };
              type: string;
            };
            // 从 type 中提取工具名（格式如 "tool-bash"）
            const toolName = toolPart.type.startsWith('tool-')
              ? toolPart.type.replace('tool-', '').replace(/_/g, ' ')
              : toolPart.toolName || 'unknown';

            const approvalId = toolPart.approval?.id;
            const toolInput = toolPart.input || {};

            // 判断是否是 ask_user_question 工具
            const isQuestionTool = toolName === 'ask user question';

            if (approvalId) {
              if (isQuestionTool && !questionPanel?.isOpen) {
                // 显示问题收集面板
                const questions = (toolInput.questions as Array<{
                  question: string;
                  header: string;
                  options: string[];
                  multiSelect?: boolean;
                }>) || [];
                setQuestionPanel({
                  isOpen: true,
                  approvalId: approvalId,
                  toolCallId: toolPart.toolCallId,
                  questions,
                });
              } else if (!isQuestionTool && !approvalDialog?.isOpen) {
                // 显示普通审批面板
                setApprovalDialog({
                  isOpen: true,
                  approvalId: approvalId,
                  toolCallId: toolPart.toolCallId,
                  toolName: toolName,
                  toolInput: toolInput,
                });
              }
            }
          }
        }
      }
    }
  }, [messages, status, approvalDialog?.isOpen, questionPanel?.isOpen]);

  // 处理问题收集完成
  const handleQuestionsComplete = useCallback((answers: Record<string, string | string[]>) => {
    if (questionPanel) {
      // 发送审批响应，包含用户选择作为 reason
      const responseReason = JSON.stringify({ answers });
      addToolApprovalResponse({
        id: questionPanel.approvalId,
        approved: true,
        reason: responseReason,
      });

      setQuestionPanel(null);
    }
  }, [addToolApprovalResponse, questionPanel]);

  // 处理问题收集取消
  const handleQuestionsCancel = useCallback(() => {
    if (questionPanel) {
      addToolApprovalResponse({
        id: questionPanel.approvalId,
        approved: false,
        reason: '用户取消问题收集',
      });
      setQuestionPanel(null);
    }
  }, [addToolApprovalResponse, questionPanel]);

  // 处理审批批准（普通工具）
  const handleApprove = useCallback((approvalId: string) => {
    addToolApprovalResponse({
      id: approvalId,
      approved: true,
    });
    setApprovalDialog(null);
  }, [addToolApprovalResponse]);

  // 处理审批拒绝
  const handleDeny = useCallback((approvalId: string, reason?: string) => {
    addToolApprovalResponse({
      id: approvalId,
      approved: false,
      reason: reason,
    });
    setApprovalDialog(null);
  }, [addToolApprovalResponse]);

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

                          if (TASK_TOOL_TYPES.has(toolPart.type)) {
                            return null;
                          }

                          // 处理 approval-requested 状态 - 显示等待审批的 UI
                          if (toolPart.state === 'approval-requested') {
                            const toolInfo = getToolTitleAndIcon(toolPart.type, toolPart.input as Record<string, unknown>);
                            const toolTitle = toolInfo?.title;
                            const ToolIcon = toolInfo?.icon || SearchIcon;

                            return (
                              <div
                                key={`${message.id}-${index}`}
                                className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm"
                              >
                                <ToolIcon className="size-4 text-yellow-600" />
                                <span className="text-yellow-700">等待审批:</span>
                                <span className="font-medium">{toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')}</span>
                                <CheckCircleIcon className="size-4 ml-auto text-yellow-500 animate-pulse" />
                              </div>
                            );
                          }

                          const toolCallId = (toolPart as unknown as { toolCallId?: string }).toolCallId;

                          const subParts = toolCallId
                            ? (message.parts as SubDataPart[]).filter(
                                (p) => p.type.startsWith('data-sub-') && p.id === toolCallId,
                              )
                            : [];

                          const isSubAgent = subParts.length > 0;
                          const toolInfo = getToolTitleAndIcon(toolPart.type, toolPart.input as Record<string, unknown>);
                          const toolTitle = toolInfo?.title;
                          const ToolIcon = toolInfo?.icon || SearchIcon;

                          return (
                            <Task
                              key={`${message.id}-${index}`}
                              defaultOpen={toolPart.state === 'output-error' || toolPart.state === 'output-denied'}
                            >
                              <TaskTrigger title={toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')} >
                                <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
                                  <ToolIcon className="size-4 shrink-0" />
                                  {toolPart.state !== 'output-available' && toolPart.state !== 'output-error' && toolPart.state !== 'output-denied' && toolPart.state !== 'approval-responded' && status === 'streaming' ? (
                                    <Shimmer className="text-sm" duration={1.5} spread={1}>{toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')}</Shimmer>
                                  ) : (
                                    <p className="text-sm">
                                      {toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')}
                                      {toolPart.state === 'output-denied' && ' (已拒绝)'}
                                    </p>
                                  )}
                                  <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                                </div>
                              </TaskTrigger>
                              <TaskContent>
                                {toolPart.state === 'output-denied' ? (
                                  <div className="text-sm text-orange-600">
                                    操作已被用户拒绝
                                  </div>
                                ) : isSubAgent ? (
                                  <SubAgentStream parts={subParts} />
                                ) : (
                                  <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                                )}
                              </TaskContent>
                            </Task>
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

          {/* User Question Panel - 问题收集 */}
          {questionPanel && (
            <UserQuestionPanel
              isOpen={questionPanel.isOpen}
              questions={questionPanel.questions}
              onComplete={handleQuestionsComplete}
              onCancel={handleQuestionsCancel}
            />
          )}

          {/* Approval Panel - 工具审批 */}
          {approvalDialog && (
            <ApprovalPanel
              isOpen={approvalDialog.isOpen}
              approvalId={approvalDialog.approvalId}
              toolCallId={approvalDialog.toolCallId}
              toolName={approvalDialog.toolName}
              toolInput={approvalDialog.toolInput}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          )}

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