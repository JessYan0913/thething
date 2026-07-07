'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  AutoScrollToBottom,
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
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { SubAgentStream } from '@/components/ai-elements/subagent-stream';
import { TodoPanel } from '@/components/chat-todo-panel';
import type { SubDataPart } from '@/components/ai-elements/subagent-stream';
import { ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task';
import { WriteFileResult } from '@/components/ai-elements/write-file-result';
import { FilePreviewPanel } from '@/components/ai-elements/file-preview-panel';
import { ApprovalPanel, type ApprovalRequest } from '@/components/ai-elements/approval-panel';
import { UserQuestionPanel } from '@/components/ai-elements/user-question-panel';
import type { ConversationItem } from '@/components/ConversationSidebar';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type ToolUIPart, type UIMessageChunk, UIMessage, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { CopyIcon, RefreshCcwIcon, SearchIcon, ChevronDownIcon, FileIcon, EditIcon, TerminalIcon, UserIcon, PlusIcon, RefreshCwIcon, ListIcon, TrashIcon, SquareIcon, BookIcon, CheckCircleIcon, BrainIcon, PenLineIcon, WrenchIcon, XIcon, FileTextIcon, CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ModelSelector, AgentSelector, ApprovalModeSelector } from '@/components/chat-selectors';
import type { ApprovalMode } from '@/components/chat-selectors';
import { SlashCommandMenu, type SlashCommandItem } from '@/components/slash-command-menu';
import { parseCommand } from '@/lib/command-parser';
import { TShapeBlink } from '@/components/TShapeBlink';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CONVERSATION_ID_KEY = 'chat_conversation_id';
const SELECTED_MODEL_KEY = 'chat_selected_model';
const SELECTED_AGENT_KEY = 'chat_selected_agent';
const SELECTED_APPROVAL_MODE_KEY = 'chat_approval_mode';

const TODO_TOOL_TYPES = new Set([
  'tool-todo_create',
  'tool-todo_update',
  'tool-todo_list',
  'tool-todo_get',
  'tool-todo_stop',
  'tool-todo_delete',
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
    case 'web_fetch':
      return { title: `Search: ${i.query ?? ''}`, icon: SearchIcon };
    case 'agent':
      return { title: `${i.agentType ?? 'Agent'}: ${String(i.task ?? '').slice(0, 30)}...`, icon: UserIcon };
    case 'todo_create':
      return { title: `Create: ${i.subject ?? ''}`, icon: PlusIcon };
    case 'todo_update':
      return { title: `Update: ${i.subject ?? i.id ?? ''}`, icon: RefreshCwIcon };
    case 'todo_list':
      return { title: i.status ? `Todos (${i.status})` : 'Todos', icon: ListIcon };
    case 'todo_get':
      return { title: `Get: ${i.id ?? ''}`, icon: SearchIcon };
    case 'todo_stop':
      return { title: `Stop: ${i.id ?? ''}`, icon: SquareIcon };
    case 'todo_delete':
      return { title: `Delete: ${i.id ?? ''}`, icon: TrashIcon };
    case 'research': 
      return { title: `Research: ${i.task ?? ''}`, icon: BookIcon };
    default:
      return undefined;
  }
}

/**
 * 计算工具调用的会话信任 scope
 * bash → 按命令前缀分类（bash:git, bash:npm）
 * 文件/其他工具 → 按工具名分类（edit_file, read_file）
 */
function computeApprovalScope(toolName: string, toolInput: Record<string, unknown>): string {
  const normalized = toolName.replace('tool-', '').replace(/ /g, '_').toLowerCase();
  if (normalized === 'bash') {
    const command = String(toolInput.command || '').trim();
    const prefix = command.split(' ')[0];
    return prefix ? `bash:${prefix}` : 'bash';
  }
  return normalized;
}

/**
 * 保存 Always allow 规则到配置文件（持久化，跨会话生效）
 * 通过 API 端点保存（因为客户端无法直接访问 fs）
 */
async function saveAlwaysAllowRule(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<void> {
  try {
    const normalizedToolName = toolName.replace(' ', '_').toLowerCase();

    let pattern: string | undefined;

    if (normalizedToolName === 'bash') {
      const command = String(toolInput.command || '').trim();
      const prefix = command.split(' ')[0];
      if (prefix) pattern = `${prefix} *`;
    }

    const res = await fetch('/api/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: normalizedToolName,
        pattern,
        behavior: 'allow',
      }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }

    console.log(`[Permissions] Saved always-allow rule: ${normalizedToolName}${pattern ? ` (${pattern})` : ''}`);
  } catch (error) {
    console.error('[Permissions] Failed to save always-allow rule:', error);
  }
}

function AttachmentPreview() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {files.map((file: any) => {
        const isImage = file.mediaType?.startsWith('image/');
        return (
          <div key={file.id} className="group relative">
            {isImage ? (
              <img
                src={file.url}
                alt={file.filename ?? ''}
                className="h-16 w-16 rounded-md border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 flex-col items-center justify-center rounded-md border bg-muted p-1">
                <FileTextIcon className="size-5 text-muted-foreground" />
                <span className="mt-0.5 max-w-full truncate text-[10px] text-muted-foreground">
                  {file.filename ?? 'file'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(file.id)}
              className="absolute -right-1.5 -top-1.5 hidden rounded-full border bg-background p-0.5 shadow-sm group-hover:block"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function getStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CONVERSATION_ID_KEY);
}

// 跟踪原始 chunk 数量的传输层
// parts（逻辑单元）和 chunks（原始 SSE 事件）之间不是 1:1 关系，
// 例如一个 reasoning part 对应 reasoning-start + N * reasoning-delta + reasoning-end。
// 用原始 chunk 数量跳过才能避免跳到序列中间导致错误。
class ResumableChatTransport extends DefaultChatTransport<UIMessage> {
  rawChunkCount = 0;

  protected processResponseStream(stream: ReadableStream<Uint8Array<ArrayBufferLike>>): ReadableStream<UIMessageChunk> {
    this.rawChunkCount = 0;
    return super.processResponseStream(stream).pipeThrough(
      new TransformStream({
        transform: (chunk: UIMessageChunk, controller) => {
          this.rawChunkCount++;
          controller.enqueue(chunk);
        },
      })
    );
  }
}

function createChatTransport(conversationId: string, apiEndpoint: string = '/api/chat', extraBodyRef?: React.RefObject<Record<string, unknown> | undefined>, _messagesGetter?: () => UIMessage[]) {
  const transport: ResumableChatTransport = new ResumableChatTransport({
    api: apiEndpoint,
    body: { conversationId },
    prepareSendMessagesRequest({ messages, body }: { id: string; messages: UIMessage[]; body: Record<string, any> | undefined; credentials: RequestCredentials | undefined; headers: HeadersInit | undefined; api: string; requestMetadata: unknown; trigger: string; messageId: string | undefined }) {
      return {
        body: {
          message: messages.at(-1),
          conversationId,
          ...extraBodyRef?.current,
          ...body,
        },
      };
    },
    // 支持流恢复：使用 transport 实例的 rawChunkCount（通过闭包引用已创建的实例）
    prepareReconnectToStreamRequest: ({ id }: { id: string; requestMetadata: unknown; body: Record<string, any> | undefined; credentials: RequestCredentials | undefined; headers: HeadersInit | undefined; api: string }) => {
      const skipChunks = transport.rawChunkCount;
      const baseEndpoint = apiEndpoint || '/api/chat';
      const streamApi = skipChunks > 0
        ? `${baseEndpoint}/${id}/stream?skipChunks=${skipChunks}`
        : `${baseEndpoint}/${id}/stream`;

      return {
        api: streamApi,
        credentials: 'include' as const,
      };
    },
  });

  return transport;
}

export interface ChatProps {
  conversationId?: string | null;
  onTitleUpdated?: () => void;
  apiEndpoint?: string;
  onTurnFinish?: () => void;
  extraBody?: Record<string, unknown>;
  initialMessage?: string;
  showAgentSelector?: boolean;
}

export default function Chat({ conversationId: propConversationId, onTitleUpdated, apiEndpoint, onTurnFinish, extraBody, initialMessage, showAgentSelector = true }: ChatProps) {
  const { t } = useTranslation('chat');
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(propConversationId ?? null);
  const isNewConversation = !conversationId;
  const initialMessageCountRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const initialMessageSentRef = useRef(false);

  // 审批对话框状态（用于工具审批）- 支持批量审批
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);

  // 会话信任：本次对话中已审批过的 scope，同类操作自动放行
  const sessionApprovedScopesRef = useRef(new Set<string>());
  const autoApprovedIdsRef = useRef(new Set<string>());

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

  // 消息编辑状态
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingAttachments, setEditingAttachments] = useState<Array<{ type: 'file'; mediaType?: string; url: string; filename?: string }>>([]);

  // 文件预览分栏状态
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    content: string;
    language?: string;
    fileUrl?: string;
    mediaType?: string;
  } | null>(null);

  // 模型和 Agent 选择状态（持久化到 localStorage）
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SELECTED_MODEL_KEY) || 'default';
    }
    return 'default';
  });
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SELECTED_AGENT_KEY) || 'auto';
    }
    return 'auto';
  });

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value);
    localStorage.setItem(SELECTED_MODEL_KEY, value);
  }, []);

  const handleAgentChange = useCallback((value: string) => {
    setSelectedAgent(value);
    localStorage.setItem(SELECTED_AGENT_KEY, value);
  }, []);

  // 审批模式选择状态
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(SELECTED_APPROVAL_MODE_KEY) as ApprovalMode | null) || 'smart';
    }
    return 'smart';
  });

  const handleApprovalModeChange = useCallback((value: string) => {
    setApprovalMode(value as ApprovalMode);
    localStorage.setItem(SELECTED_APPROVAL_MODE_KEY, value);
  }, []);

  // ── Slash Command Menu ──────────────
  const [slashCommandOpen, setSlashCommandOpen] = useState(false);
  const [slashCommandQuery, setSlashCommandQuery] = useState('');
  const [slashCommandSelectedIndex, setSlashCommandSelectedIndex] = useState(0);
  const [slashCommandAgents, setSlashCommandAgents] = useState<Array<{ agentType: string; displayName?: string; description: string; source: string; metadata?: Record<string, unknown> }>>([]);
  const [slashCommandModels, setSlashCommandModels] = useState<Record<string, { model: string; contextLimit?: number }> | null>(null);
  const [slashCommandSkills, setSlashCommandSkills] = useState<Array<{ name: string; folderName: string; description: string }>>([]);
  const [slashCommandDataLoaded, setSlashCommandDataLoaded] = useState(false);
  const slashCommandJustSelectedRef = useRef(false);

  // Fetch data for slash command menu on first open
  useEffect(() => {
    if (slashCommandOpen && !slashCommandDataLoaded) {
      setSlashCommandDataLoaded(true);
      Promise.all([
        fetch('/api/agents').then((r) => r.json()).catch(() => ({ agents: [] })),
        fetch('/api/config').then((r) => r.json()).catch(() => ({ modelAliases: null })),
        fetch('/api/skills').then((r) => r.json()).catch(() => ({ skills: [] })),
      ]).then(([agentsData, configData, skillsData]) => {
        setSlashCommandAgents(
          (agentsData.agents || []).filter(
            (a: { source: string; metadata?: Record<string, unknown> }) =>
              (a.source === 'user' || a.source === 'project') && a.metadata?.enabled !== false,
          ),
        );
        setSlashCommandModels(configData.modelAliases || null);
        setSlashCommandSkills(skillsData.skills || []);
      });
    }
  }, [slashCommandOpen, slashCommandDataLoaded]);

  // Build all slash command items
  const allSlashCommandItems = useMemo<SlashCommandItem[]>(() => {
    const items: SlashCommandItem[] = [];

    // Agents
    items.push({ id: 'agent:auto', type: 'agent', label: 'Auto', description: '自动路由' });
    for (const agent of slashCommandAgents) {
      items.push({
        id: `agent:${agent.agentType}`,
        type: 'agent',
        label: agent.displayName || agent.agentType,
        description: agent.description,
      });
    }

    // Models
    if (slashCommandModels) {
      const LABELS: Record<string, string> = { default: 'Default', fast: 'Fast', smart: 'Smart' };
      for (const [key, config] of Object.entries(slashCommandModels)) {
        if (config.model) {
          items.push({
            id: `model:${key}`,
            type: 'model',
            label: config.model.split('/').pop() || key,
            description: LABELS[key] || key,
          });
        }
      }
    }

    // Approval Modes
    items.push(
      { id: 'mode:smart', type: 'mode', label: 'Smart', description: '智能审批' },
      { id: 'mode:auto-review', type: 'mode', label: 'Auto-review', description: 'Agent 审批' },
      { id: 'mode:full-trust', type: 'mode', label: 'Full trust', description: '完全信任' },
    );

    // Skills
    for (const skill of slashCommandSkills) {
      items.push({
        id: `skill:${skill.name}`,
        type: 'skill',
        label: skill.name,
        description: skill.description,
      });
    }

    return items;
  }, [slashCommandAgents, slashCommandModels, slashCommandSkills]);

  // Filter items by query
  const filteredSlashCommandItems = useMemo(() => {
    if (!slashCommandQuery) return allSlashCommandItems;
    const lower = slashCommandQuery.toLowerCase();
    return allSlashCommandItems.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower),
    );
  }, [allSlashCommandItems, slashCommandQuery]);

  // Clamp selected index when items change
  useEffect(() => {
    if (filteredSlashCommandItems.length === 0) {
      setSlashCommandSelectedIndex(0);
    } else if (slashCommandSelectedIndex >= filteredSlashCommandItems.length) {
      setSlashCommandSelectedIndex(filteredSlashCommandItems.length - 1);
    }
  }, [filteredSlashCommandItems.length, slashCommandSelectedIndex]);

  // Close slash command menu on click outside
  useEffect(() => {
    if (!slashCommandOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('textarea[name="message"]') && !target.closest('[data-slash-menu]')) {
        setSlashCommandOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [slashCommandOpen]);

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    (item: SlashCommandItem) => {
      const textarea = document.querySelector('textarea[name="message"]') as HTMLTextAreaElement;

      switch (item.type) {
        case 'agent':
          handleAgentChange(item.id.replace('agent:', ''));
          if (textarea) { textarea.value = ''; textarea.focus(); }
          break;
        case 'model':
          handleModelChange(item.id.replace('model:', ''));
          if (textarea) { textarea.value = ''; textarea.focus(); }
          break;
        case 'mode':
          handleApprovalModeChange(item.id.replace('mode:', ''));
          if (textarea) { textarea.value = ''; textarea.focus(); }
          break;
        case 'skill':
          if (textarea) { textarea.value = `/skill ${item.label} `; textarea.focus(); }
          break;
      }

      setSlashCommandOpen(false);
      setSlashCommandQuery('');
      setSlashCommandSelectedIndex(0);
      // Prevent the menu from re-opening on the next input change
      slashCommandJustSelectedRef.current = true;
    },
    [handleAgentChange, handleModelChange, handleApprovalModeChange],
  );

  // Detect / at start of input to open slash command menu
  const handleSlashCommandInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    
    // Only show menu when input starts with '/' and doesn't contain space after '/'
    // If there's a space after '/', it means the command type is already selected
    if (value.startsWith('/') && !value.includes('\n')) {
      const slashQuery = value.slice(1);
      if (!slashQuery.includes(' ')) {
        // 如果输入只有 '/'，无条件打开菜单（忽略 slashCommandJustSelectedRef）
        setSlashCommandOpen(true);
        setSlashCommandQuery(slashQuery);
        setSlashCommandSelectedIndex(0);
      } else {
        setSlashCommandOpen(false);
      }
    } else {
      setSlashCommandOpen(false);
    }
    // 重置标志，允许下次输入 / 时打开菜单
    slashCommandJustSelectedRef.current = false;
  }, []);

  // Handle keyboard navigation in slash command menu
  const handleSlashCommandKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!slashCommandOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashCommandSelectedIndex((prev) => Math.min(prev + 1, filteredSlashCommandItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashCommandSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (filteredSlashCommandItems[slashCommandSelectedIndex]) {
          handleSlashCommandSelect(filteredSlashCommandItems[slashCommandSelectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSlashCommandOpen(false);
      }
    },
    [slashCommandOpen, filteredSlashCommandItems, slashCommandSelectedIndex, handleSlashCommandSelect],
  );

  const extraBodyRef = useRef<Record<string, unknown> | undefined>(extraBody);
  extraBodyRef.current = {
    ...extraBody,
    modelName: selectedModel === 'default' ? undefined : selectedModel,
    agentType: selectedAgent === 'auto' ? undefined : selectedAgent,
    approvalMode,
  };

  const transport = useMemo(() => {
    if (!conversationId) return undefined;
    return createChatTransport(conversationId, apiEndpoint, extraBodyRef, () => messagesRef.current);
  }, [conversationId, apiEndpoint]);

  const { messages, setMessages, sendMessage, status, stop, error, addToolApprovalResponse } = useChat({
    id: conversationId || 'pending',
    transport: transport as any,
    resume: !!conversationId,
    experimental_throttle: 80, // 节流 UI 更新，避免每块 SSE chunk 都触发 React 全量重渲染
    sendAutomaticallyWhen: ({ messages }) => {
      const lastMsg = messages.at(-1);
      if (lastMsg?.role === 'assistant') {
        // 如果有 data-plan 类型，不自动发送
        if (lastMsg.parts.some((p) => p.type === 'data-plan')) {
          return false;
        }

        // 使用原始（未节流）消息检测审批请求，避免 throttling 导致中间状态被跳过
        const pendingApprovals: ApprovalRequest[] = [];
        const seenApprovalIds = new Set<string>();
        let questionRequest: {
          approvalId: string;
          toolCallId: string;
          questions: Array<{
            question: string;
            header: string;
            options: string[];
            multiSelect?: boolean;
          }>;
        } | null = null;

        for (const part of lastMsg.parts) {
          const isToolPart = part.type.startsWith('tool-') || part.type === 'dynamic-tool';
          const hasToolCallId = 'toolCallId' in part;
          const toolState = (part as { state?: string }).state;

          if (isToolPart && hasToolCallId && toolState === 'approval-requested') {
            const toolPart = part as unknown as {
              toolCallId: string;
              toolName?: string;
              input?: Record<string, unknown>;
              approval?: { id: string };
              type: string;
            };
            const toolName = toolPart.type.startsWith('tool-')
              ? toolPart.type.replace('tool-', '').replace(/_/g, ' ')
              : toolPart.toolName || 'unknown';

            const approvalId = toolPart.approval?.id;
            const toolInput = toolPart.input || {};

            if (approvalId && !seenApprovalIds.has(approvalId)) {
              seenApprovalIds.add(approvalId);
              const isQuestionTool = toolName === 'ask user question';

              if (isQuestionTool && !questionRequest) {
                const questions = (toolInput.questions as Array<{
                  question: string;
                  header: string;
                  options: string[];
                  multiSelect?: boolean;
                }>) || [];
                questionRequest = {
                  approvalId,
                  toolCallId: toolPart.toolCallId,
                  questions,
                };
              } else if (!isQuestionTool) {
                // 会话信任：如果该 scope 已在本次对话中被批准过，自动放行
                const scope = computeApprovalScope(toolName, toolInput);
                if (sessionApprovedScopesRef.current.has(scope) && !autoApprovedIdsRef.current.has(approvalId)) {
                  autoApprovedIdsRef.current.add(approvalId);
                  addToolApprovalResponse({ id: approvalId, approved: true });
                } else {
                  pendingApprovals.push({
                    approvalId,
                    toolCallId: toolPart.toolCallId,
                    toolName,
                    toolInput,
                  });
                }
              }
            }
          }
        }

        // 更新审批请求列表（只在有变化时更新）
        setApprovalRequests(prev => {
          if (pendingApprovals.length !== prev.length ||
              !pendingApprovals.every(r => prev.some(ar => ar.approvalId === r.approvalId))) {
            return pendingApprovals;
          }
          return prev;
        });

        // 更新问题面板
        if (questionRequest) {
          setQuestionPanel(prev => prev?.isOpen ? prev : {
            isOpen: true,
            approvalId: questionRequest.approvalId,
            toolCallId: questionRequest.toolCallId,
            questions: questionRequest.questions,
          });
        }

        // 如果还有待审批的工具调用，不自动发送（等待用户处理所有审批）
        if (pendingApprovals.length > 0) {
          return false;
        }

        // 只有当所有审批都已响应，且消息看起来完成时才自动发送
        return lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
               lastAssistantMessageIsCompleteWithToolCalls({ messages });
      }
      return false;
    },
    onFinish: async ({ messages: finishedMessages }) => {
      const endpoint = apiEndpoint || '/api/chat';
      try {
        const res = await fetch(endpoint, {
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

      onTurnFinish?.();

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

  // 处理审批批准（单个）
  const handleApprove = useCallback((approvalId: string, options?: { alwaysAllow?: boolean }) => {
    // 记录 session scope — 本次对话内同类操作自动放行
    const request = approvalRequests.find(r => r.approvalId === approvalId);
    if (request) {
      const scope = computeApprovalScope(request.toolName, request.toolInput);
      sessionApprovedScopesRef.current.add(scope);
    }

    addToolApprovalResponse({
      id: approvalId,
      approved: true,
    });

    // 持久化规则（跨会话生效）
    if (options?.alwaysAllow && request) {
      saveAlwaysAllowRule(request.toolName, request.toolInput);
    }
  }, [addToolApprovalResponse, approvalRequests]);

  // 处理批量审批批准
  const handleApproveAll = useCallback((requests: ApprovalRequest[], options?: { alwaysAllow?: boolean }) => {
    for (const req of requests) {
      // 记录 session scope
      const scope = computeApprovalScope(req.toolName, req.toolInput);
      sessionApprovedScopesRef.current.add(scope);

      addToolApprovalResponse({
        id: req.approvalId,
        approved: true,
      });

      if (options?.alwaysAllow) {
        saveAlwaysAllowRule(req.toolName, req.toolInput);
      }
    }
  }, [addToolApprovalResponse]);

  // 处理审批拒绝（单个）
  const handleDeny = useCallback((approvalId: string, reason?: string) => {
    addToolApprovalResponse({
      id: approvalId,
      approved: false,
      reason: reason,
    });

    // 不立即从列表移除
  }, [addToolApprovalResponse]);

  // 处理批量审批拒绝
  const handleDenyAll = useCallback((requests: ApprovalRequest[], reason?: string) => {
    for (const req of requests) {
      addToolApprovalResponse({
        id: req.approvalId,
        approved: false,
        reason: reason,
      });
    }

    // 不立即清空
  }, [addToolApprovalResponse]);

  // 停止 Agent 时清理未完成的 todo，避免 orphaned in_progress 状态
  const handleStop = useCallback(() => {
    stop();
    // Fire and forget: 将在执行中的 todo 重置为 pending，下一轮 Agent 可以继续
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reset-conversation',
        conversationId,
      }),
    }).catch(err => console.error('[Chat] Failed to reset todos:', err));
  }, [stop, conversationId]);

  useEffect(() => {
    let cancelled = false;

    // 新建对话状态（无 conversationId）：直接标记加载完成
    if (!conversationId) {
      setIsInitialLoadDone(true);
      return;
    }

    async function loadMessages() {
      const endpoint = apiEndpoint || '/api/chat';
      try {
        const res = await fetch(`${endpoint}?conversationId=${encodeURIComponent(conversationId!)}`);
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
      } finally {
        if (!cancelled) {
          setIsInitialLoadDone(true);
        }
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [conversationId, setMessages, apiEndpoint]);

  // 恢复待审批状态（跨重启恢复）
  useEffect(() => {
    if (!isInitialLoadDone || !conversationId) return;
    
    let cancelled = false;
    
    async function restorePendingApprovals() {
      try {
        const res = await fetch('/api/chat/pending-approvals');
        if (!res.ok || cancelled) return;
        
        const data = await res.json();
        const pendingForConversation = data.pendingApprovals?.find(
          (p: { conversationId: string }) => p.conversationId === conversationId
        );
        
        if (pendingForConversation && pendingForConversation.approvals?.length > 0 && !cancelled) {
          console.log(`[Chat] Restored ${pendingForConversation.approvals.length} pending approvals for conversation ${conversationId}`);
          setApprovalRequests(pendingForConversation.approvals);
        }
      } catch (error) {
        console.error('[Chat] Failed to restore pending approvals:', error);
      }
    }
    
    restorePendingApprovals();
    return () => {
      cancelled = true;
    };
  }, [isInitialLoadDone, conversationId]);

  useEffect(() => {
    if (
      isInitialLoadDone &&
      initialMessage &&
      !initialMessageSentRef.current &&
      initialMessageCountRef.current === 0
    ) {
      initialMessageSentRef.current = true;
      sendMessage({ text: initialMessage });
      window.history.replaceState({}, document.title);
    }
  }, [isInitialLoadDone, initialMessage, sendMessage]);

  const thinkingState = useMemo(() => {
    if (status !== 'submitted' && status !== 'streaming') return null;

    const lastMsg = messages.at(-1);

    // Submitted but no assistant message yet
    if (!lastMsg || lastMsg.role !== 'assistant') {
      return { icon: BrainIcon, label: 'Thinking...', animate: 'pulse' as const };
    }

    const lastPart = lastMsg.parts.at(-1);
    if (!lastPart) return { icon: BrainIcon, label: 'Thinking...', animate: 'pulse' as const };

    // Reasoning / deep thinking
    if (lastPart.type === 'reasoning') {
      return { icon: BrainIcon, label: 'Thinking...', animate: 'pulse' as const };
    }

    // Tool call in progress
    if (lastPart.type.startsWith('tool-') || lastPart.type === 'dynamic-tool') {
      const toolPart = lastPart as { type: string; state?: string; input?: Record<string, unknown> };
      const isCompleted = toolPart.state === 'output-available' || toolPart.state === 'output-error' || toolPart.state === 'output-denied';
      if (!isCompleted) {
        const toolInfo = getToolTitleAndIcon(lastPart.type, toolPart.input as Record<string, unknown> ?? null);
        const ToolIcon = toolInfo?.icon ?? WrenchIcon;
        return { icon: ToolIcon, label: 'Running...', animate: 'spin' as const };
      }
      // Tool completed, model is deciding next step
      return { icon: BrainIcon, label: 'Thinking...', animate: 'pulse' as const };
    }

    // Text streaming
    if (lastPart.type === 'text') {
      return { icon: PenLineIcon, label: 'Writing...', animate: 'none' as const };
    }

    return { icon: BrainIcon, label: 'Thinking...', animate: 'pulse' as const };
  }, [status, messages]);

  const handleSend = useCallback(
    async ({ text, files }: PromptInputMessage) => {
      const trimmed = text.trim();
      if (!trimmed && files.length === 0) return;

      // 解析命令
      const commandResult = parseCommand(trimmed);

      // 前端命令：执行后不发送消息
      if (commandResult.type === 'frontend') {
        switch (commandResult.command) {
          case 'agent':
            handleAgentChange(commandResult.args || 'auto');
            break;
          case 'model':
            handleModelChange(commandResult.args || 'default');
            break;
          case 'mode':
            handleApprovalModeChange(commandResult.args || 'smart');
            break;
        }
        // 清空输入框
        const textarea = document.querySelector('textarea[name="message"]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = '';
          textarea.focus();
        }
        // 重置 slash command 标志，允许下次输入 / 时重新打开菜单
        slashCommandJustSelectedRef.current = false;
        setSlashCommandOpen(false);
        return;
      }

      // AI 命令或普通消息：发送给 AI
      // 如果是新建对话状态（无 conversationId），先创建对话
      if (isNewConversation) {
        try {
          const newId = nanoid();
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newId }),
          });
          if (res.ok) {
            setConversationId(newId);
            // 导航到新对话 URL（不触发重新加载）
            router.replace(`/chat/user/${newId}?msg=${encodeURIComponent(text)}`);
            return; // 等待 conversationId 更新后会自动发送
          }
        } catch {
          // 创建失败
        }
      }
      sendMessage({ text, files: files.length > 0 ? files : undefined });
    },
    [sendMessage, handleAgentChange, handleModelChange, handleApprovalModeChange],
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

  const handleEditStart = useCallback((messageId: string, currentText: string, attachments?: Array<{ type: 'file'; mediaType?: string; url: string; filename?: string }>) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
    setEditingAttachments(attachments ?? []);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
    setEditingAttachments([]);
  }, []);

  const handleEditConfirm = useCallback(() => {
    if (!editingMessageId || !editingText.trim()) return;

    const messageIndex = messages.findIndex(m => m.id === editingMessageId);
    if (messageIndex === -1) return;

    const originalMessage = messages[messageIndex];

    // 截断：保留被编辑消息之前的所有消息
    const truncated = messages.slice(0, messageIndex);

    // 更新被编辑消息的文本内容
    const updatedMessage = {
      ...originalMessage,
      parts: originalMessage.parts.map(p =>
        p.type === 'text' ? { ...p, text: editingText } : p
      ),
    };

    // 设置截断后的消息 + 更新后的消息
    setMessages([...truncated, updatedMessage]);

    // 发送 — 相同 ID 触发后端 re-send 截断逻辑
    sendMessage(updatedMessage);

    setEditingMessageId(null);
    setEditingText('');
    setEditingAttachments([]);
  }, [editingMessageId, editingText, messages, setMessages, sendMessage]);

  // ── 输入卡片（在空状态和对话模式中复用） ──────────────
  const inputCard = (
    <div className="relative">
      {slashCommandOpen && (
        <SlashCommandMenu
          items={filteredSlashCommandItems}
          selectedIndex={slashCommandSelectedIndex}
          onSelect={handleSlashCommandSelect}
          onHover={setSlashCommandSelectedIndex}
        />
      )}
      <div className="rounded-xl border bg-card shadow-lg shadow-primary/5 ring-1 ring-border/50">
        <PromptInput onSubmit={handleSend} accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.go,.rs,.rb,.sh,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.odt,.ods,.odp" multiple>
          <AttachmentPreview />
          <PromptInputTextarea placeholder="Message AI Assistant... (Type / for commands)" onChange={handleSlashCommandInputChange} onKeyDown={handleSlashCommandKeyDown} />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Add attachments" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                  <PromptInputActionAddScreenshot />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              {showAgentSelector && <AgentSelector value={selectedAgent} onChange={handleAgentChange} />}
              <ModelSelector value={selectedModel} onChange={handleModelChange} />
              <ApprovalModeSelector value={approvalMode} onChange={handleApprovalModeChange} />
            </PromptInputTools>
            <PromptInputSubmit status={status} onStop={handleStop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 左侧：聊天内容 */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {error && (
          <div className="mx-4 mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error.message}</div>
        )}

        {!isInitialLoadDone ? (
          /* Show nothing while loading messages — prevents empty state flash */
          <div className="flex flex-1 items-center justify-center">
            <Shimmer className="text-sm text-muted-foreground" duration={1.5}>Loading conversation...</Shimmer>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col pt-4">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-8">
                <div className="text-center space-y-3">
                  <div className="mx-auto mb-2" style={{ width: 80, height: 80 }}>
                    <TShapeBlink />
                  </div>
                  <h2 className="text-2xl font-bold">
                    {t('emptyState.quickStartTitle')}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                    {t('emptyState.quickStartDescription')}
                  </p>
                </div>
              </div>
            ) : (
            <Conversation>
              <ConversationContent>
                {messages.map((message, messageIndex) => {
                const reasoningParts = message.parts.filter((part) => part.type === 'reasoning');
                const reasoningText = reasoningParts.map((part) => part.text).join('\n\n');
                const hasReasoning = reasoningParts.length > 0;

                const lastPart = message.parts.at(-1);
                const isReasoningStreaming =
                  messageIndex === messages.length - 1 && status === 'streaming' && lastPart?.type === 'reasoning';

                const isEditing = editingMessageId === message.id;
                const userMessageText = message.role === 'user'
                  ? message.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
                  : '';

                return (
                  <Message from={message.role} key={message.id}>
                    {message.role === 'user' && isEditing ? (
                      <div className="ml-auto w-full max-w-2xl rounded-xl border bg-background px-4 py-3 shadow-sm">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleEditConfirm();
                            }
                            if (e.key === 'Escape') {
                              handleEditCancel();
                            }
                          }}
                          className="w-full resize-none bg-transparent text-sm text-foreground outline-none min-h-10"
                          rows={Math.min(editingText.split('\n').length + 1, 10)}
                          autoFocus
                        />
                        {editingAttachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t">
                            {editingAttachments.map((att, i) => (
                              att.mediaType?.startsWith('image/') ? (
                                <img
                                  key={i}
                                  src={att.url}
                                  alt={att.filename ?? 'image'}
                                  className="size-14 rounded-md border object-cover"
                                />
                              ) : (
                                <div
                                  key={i}
                                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground"
                                >
                                  <FileTextIcon className="size-3" />
                                  <span className="truncate max-w-20">{att.filename ?? 'file'}</span>
                                </div>
                              )
                            ))}
                          </div>
                        )}
                        <div className="flex justify-end gap-1 mt-2">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={handleEditCancel}
                            type="button"
                          >
                            <XIcon className="size-3" />
                          </Button>
                          <Button
                            size="icon-sm"
                            onClick={handleEditConfirm}
                            type="button"
                          >
                            <CheckIcon className="size-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
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

                          if (part.type === 'file') {
                            const filePart = part as { type: 'file'; mediaType?: string; url: string; filename?: string };
                            const handleFilePreview = () => {
                              setPreviewFile({
                                path: filePart.filename ?? 'file',
                                content: '',
                                fileUrl: filePart.url,
                                mediaType: filePart.mediaType,
                              });
                            };
                            if (filePart.mediaType?.startsWith('image/')) {
                              return (
                                <img
                                  key={`${message.id}-${index}`}
                                  src={filePart.url}
                                  alt={filePart.filename ?? 'image'}
                                  className="size-20 rounded-md border object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={handleFilePreview}
                                />
                              );
                            }
                            return (
                              <div
                                key={`${message.id}-${index}`}
                                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={handleFilePreview}
                              >
                                <FileTextIcon className="size-4 text-muted-foreground" />
                                <span>{filePart.filename ?? 'file'}</span>
                              </div>
                            );
                          }

                          if (part.type.startsWith('data-sub-')) {
                            return null;
                          }

                          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                            const toolPart = part as ToolUIPart;

                          if (TODO_TOOL_TYPES.has(toolPart.type)) {
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

                          // write_file 完成后：简洁渲染，不显示折叠面板和参数
                          if (toolPart.type === 'tool-write_file' && toolPart.state === 'output-available' && toolPart.output) {
                            return (
                              <WriteFileResult
                                key={`${message.id}-${index}`}
                                output={toolPart.output as Record<string, unknown>}
                                input={toolPart.input as Record<string, unknown> | undefined}
                                onPreview={(file: { path: string; content: string; language?: string }) => setPreviewFile(file)}
                              />
                            );
                          }

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
                                  <>
                                    {/* edit_file / read_file / bash / grep: always skip Parameters */}
                                    {!(
                                      toolPart.type === 'tool-edit_file' ||
                                      toolPart.type === 'tool-read_file' ||
                                      toolPart.type === 'tool-bash' ||
                                      toolPart.type === 'tool-grep'
                                    ) && (
                                      <ToolInput input={toolPart.input} />
                                    )}
                                    <ToolOutput
                                      output={toolPart.output}
                                      errorText={toolPart.errorText}
                                      toolType={toolPart.type}
                                      toolInput={toolPart.input}
                                    />
                                  </>
                                )}
                              </TaskContent>
                            </Task>
                          );
                        }

                        return null;
                      })}
                    </MessageContent>
                    )}
                    {message.role === 'user' && !isEditing && status !== 'streaming' && status !== 'submitted' && (
                      <MessageToolbar className="mt-0! opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <MessageActions>
                          <MessageAction
                            label="Edit"
                            onClick={() => {
                              const fileParts = message.parts
                                .filter(p => p.type === 'file')
                                .map(p => ({ type: 'file' as const, mediaType: (p as any).mediaType, url: (p as any).url, filename: (p as any).filename }));
                              handleEditStart(message.id, userMessageText, fileParts);
                            }}
                            tooltip="Edit message"
                          >
                            <EditIcon className="size-4" />
                          </MessageAction>
                          <MessageAction
                            label="Copy"
                            onClick={() => handleCopy(userMessageText)}
                            tooltip="Copy to clipboard"
                          >
                            <CopyIcon className="size-4" />
                          </MessageAction>
                        </MessageActions>
                      </MessageToolbar>
                    )}
                    {message.role === 'assistant' && messageIndex === messages.length - 1 && thinkingState ? (
                      <div className="flex items-center gap-2.5 px-1 py-2 text-sm text-muted-foreground">
                        <div className="relative">
                          <thinkingState.icon className="size-4 shrink-0 animate-building" />
                          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        </div>
                        <span className="animate-pulse">{thinkingState.label}</span>
                      </div>
                    ) : message.role === 'assistant' && (
                      <MessageToolbar className="mt-0! opacity-0 group-hover:opacity-100 transition-opacity">
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
              {/* Thinking indicator for gap between submission and assistant starting */}
              {status === 'submitted' && messages.length > 0 && messages.at(-1)?.role === 'user' && (
                <div className="flex items-center gap-2.5 px-1 py-2 text-sm text-muted-foreground">
                  <div className="relative">
                    <BrainIcon className="size-4 shrink-0 animate-building" />
                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  </div>
                  <span className="animate-pulse">Thinking...</span>
                </div>
              )}
              </ConversationContent>
              <AutoScrollToBottom trigger={isInitialLoadDone && messages.length > 0} />
              <ConversationScrollButton />
            </Conversation>
            )}
        </div>
      )}

      {isInitialLoadDone && (
        <div className="shrink-0 border-t bg-background/80 backdrop-blur-md p-4">
          <div className="mx-auto max-w-3xl space-y-2">
            {conversationId && <TodoPanel conversationId={conversationId} />}

            {questionPanel && (
              <UserQuestionPanel
                isOpen={questionPanel.isOpen}
                questions={questionPanel.questions}
                onComplete={handleQuestionsComplete}
                onCancel={handleQuestionsCancel}
              />
            )}

            {approvalRequests.length > 0 && (
              <ApprovalPanel
                isOpen={true}
                requests={approvalRequests}
                onApprove={handleApprove}
                onApproveAll={handleApproveAll}
                onDeny={handleDeny}
                onDenyAll={handleDenyAll}
              />
            )}

            {inputCard}
          </div>
        </div>
      )}
      </div>
      {/* 右侧：文件预览分栏 */}
      {previewFile && (
        <FilePreviewPanel
          open={!!previewFile}
          onOpenChange={(open: boolean) => !open && setPreviewFile(null)}
          filePath={previewFile.path}
          content={previewFile.content}
          language={previewFile.language}
          fileUrl={previewFile.fileUrl}
          mediaType={previewFile.mediaType}
        />
      )}
    </div>
  );
}