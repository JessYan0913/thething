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
import { SubAgentCard } from '@/components/ai-elements/subagent-stream';
import { TodoPanel } from '@/components/chat-todo-panel';
import type { SubDataPart } from '@/components/ai-elements/subagent-stream';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ContextRing } from '@/components/context/ContextRing';
import { ContextDetail } from '@/components/context/ContextDetail';
import { ContextBudgetSnapshotSchema, type ContextBudgetSnapshot } from '@the-thing/core/context-budget';
import { FilePreviewPanel } from '@/components/ai-elements/file-preview-panel';
import { WriteFileStreamingCard } from '@/components/ai-elements/write-file-streaming-card';
import { BashStreamingCard, BashOutputCard } from '@/components/ai-elements/bash-streaming-card';
import { ToolReportCard } from '@/components/ai-elements/tool-report-card';
import { FileOutputsSummary, collectFileOutputs } from '@/components/ai-elements/file-outputs-summary';
import { ApprovalPanel, type ApprovalRequest } from '@/components/ai-elements/approval-panel';
import { UserQuestionPanel } from '@/components/ai-elements/user-question-panel';
import { PlanReviewPanel, type PlanReviewRequest } from '@/components/ai-elements/plan-review-panel';
import type { ConversationItem } from '@/components/ConversationSidebar';
import { useChat } from '@ai-sdk/react';
import type { CSSProperties, MutableRefObject } from 'react';
import { DefaultChatTransport, type ToolUIPart, type DynamicToolUIPart, type UIMessageChunk, UIMessage, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { CopyIcon, RefreshCcwIcon, SearchIcon, FileIcon, EditIcon, TerminalIcon, UserIcon, TrashIcon, BookIcon, CheckCircleIcon, BrainIcon, PenLineIcon, WrenchIcon, XIcon, FileTextIcon, CheckIcon, Loader2Icon, GitBranchIcon, ChevronDownIcon, HelpCircleIcon, ListChecksIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ModelSelector, AgentSelector, ApprovalModeSelector } from '@/components/chat-selectors';
import type { ApprovalMode } from '@/components/chat-selectors';
import { McpAppToolPart } from '@/components/mcp-app-tool-part';
import { SlashCommandMenu, type SlashCommandItem } from '@/components/slash-command-menu';
import { parseCommand } from '@/lib/command-parser';
import { cn } from '@/lib/utils';
import { DoctorReportPanel } from '@/components/doctor-report-panel';
import type { DoctorReport, RepairOutcome } from '@the-thing/core';

import { BranchAction, ConversationRoutePanel } from '@/components/conversation-route-panel';
import type {
  ConversationBranchSummary,
  ConversationTree,
} from '@/components/conversation-route-panel';
import { TShapeBlink } from '@/components/TShapeBlink';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useChatPreferences } from '@/hooks/useChatPreferences';

const CONVERSATION_ID_KEY = 'chat_conversation_id';

const TODO_TOOL_TYPES = new Set([
  'tool-todo_write',
  'tool-todo_delete',
]);

// 报告/列表类工具：输出本质是摘要而非文件，点击内联展开报告卡（替代右侧文件预览面板）
// 文件类（write/read/edit_file/read_wiki_page）与 web_fetch 仍走右侧面板
// MCP 动态工具（mcp__*）同为报告性质，在 isInlineReportTool 里按前缀统一内联展开
const INLINE_REPORT_TOOLS = new Set([
  'grep', 'glob', 'skill',
  'save_wiki', 'lint_wiki', 'ingest_wiki_source',
  'inspect_wiki_history', 'restore_wiki_revision', 'cron',
  'ask_user_question',
]);

function getToolTitleAndIcon(type: string, input: Record<string, unknown> | null, toolName?: string): { title: string; icon: React.ComponentType<{ className?: string }> } | undefined {
  const toolType = type.replace('tool-', '');
  const i = input ?? {};

  // 动态工具（MCP 等）：使用 toolName 字段，将 __ 转为 : 提升可读性
  if (type === 'dynamic-tool' && toolName) {
    const displayName = toolName.replace(/__/g, ':');
    return { title: displayName, icon: WrenchIcon };
  }

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
    case 'todo_write':
      return { title: `Todos: ${(i.todos as unknown[] | undefined)?.length ?? ''} items`, icon: ListChecksIcon };
    case 'todo_delete':
      return { title: `Cancel: ${i.id ?? ''}`, icon: TrashIcon };
    case 'research':
      return { title: `Research: ${i.task ?? ''}`, icon: BookIcon };
    case 'ask_user_question':
      return { title: 'Ask User', icon: HelpCircleIcon };
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

type ConversationProjection = {
  revision: number;
  activeBranchId: string | null;
  activeTipId: string | null;
  messages: UIMessage[];
  tree: ConversationTree;
  branches: ConversationBranchSummary[];
};

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

type PendingQuestionRequest = {
  toolCallId: string;
  questions: Array<{
    question: string;
    header: string;
    options: string[];
    multiSelect?: boolean;
  }>;
};

// 从消息历史中收集待审批请求（消息驱动恢复）：
// 服务端 onEnd 会把含 approval-requested / input-available part 的 assistant 消息
// 持久化，刷新/重启后据此重建 ApprovalPanel / 问题面板。
function collectPendingApprovals(messages: UIMessage[]): {
  approvals: ApprovalRequest[];
  question: PendingQuestionRequest | null;
} {
  const approvals: ApprovalRequest[] = [];
  let question: PendingQuestionRequest | null = null;

  const lastMsg = messages.at(-1);
  if (!lastMsg || lastMsg.role !== 'assistant') return { approvals, question };

  const seenApprovalIds = new Set<string>();
  for (const part of lastMsg.parts) {
    const isToolPart = part.type.startsWith('tool-') || part.type === 'dynamic-tool';
    if (!isToolPart || !('toolCallId' in part)) continue;
    const state = (part as { state?: string }).state;

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

    // 客户端工具 ask_user_question：检测 input-available（无 execute 工具挂起等待前端）
    if (toolName === 'ask user question' && state === 'input-available') {
      if (!question) {
        question = {
          toolCallId: toolPart.toolCallId,
          questions: (toolPart.input?.questions as PendingQuestionRequest['questions']) || [],
        };
      }
      continue;
    }

    // 普通审批工具：检测 approval-requested
    if (state !== 'approval-requested') continue;
    const approvalId = toolPart.approval?.id;
    if (!approvalId || seenApprovalIds.has(approvalId)) continue;
    seenApprovalIds.add(approvalId);

    const toolInput = toolPart.input || {};
    approvals.push({
      approvalId,
      toolCallId: toolPart.toolCallId,
      toolName,
      toolInput,
    });
  }

  return { approvals, question };
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

function createChatTransport(
  conversationId: string,
  apiEndpoint: string = '/api/chat',
  extraBodyRef?: MutableRefObject<Record<string, unknown> | undefined>,
  operationRef?: MutableRefObject<'append' | 'regenerate' | 'edit'>,
) {
  const transport: ResumableChatTransport = new ResumableChatTransport({
    api: apiEndpoint,
    body: { conversationId },
    prepareSendMessagesRequest({ messages, body, trigger }: { id: string; messages: UIMessage[]; body: Record<string, any> | undefined; credentials: RequestCredentials | undefined; headers: HeadersInit | undefined; api: string; requestMetadata: unknown; trigger: string; messageId: string | undefined }) {
      const requestedOperation = operationRef?.current ?? 'append';
      if (operationRef) operationRef.current = 'append';
      return {
        body: {
          message: messages.at(-1),
          conversationId,
          trigger,
          operation: requestedOperation,
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

// ── 分支内联选择器 ──────────────────────────────
// 替换旧的 <1/2> 版本切换器。从 branchSummaries 按 fork 点聚合，
// 每个分支显示名称，点击通过 handleFormalBranchSwitch 切换。
function InlineBranchSelector({ branches, currentBranchId, switching, onSwitch }: {
  branches: ConversationBranchSummary[];
  currentBranchId: string | null;
  switching: boolean;
  onSwitch: (branchId: string) => void;
}) {
  if (branches.length < 2) return null;
  return (
    <div className="flex items-center gap-1 text-[11px] select-none">
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          disabled={switching}
          className={b.id === currentBranchId
            ? 'px-1.5 py-0.5 rounded font-medium bg-primary/10 text-primary'
            : 'px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent'}
          onClick={() => onSwitch(b.id)}
          title={b.preview}
        >
          {b.name || (b.status === 'candidate' ? '其他回答' : '未命名')}
        </button>
      ))}
    </div>
  );
}

export interface ChatProps {
  conversationId?: string | null;
  onTitleUpdated?: () => void;
  apiEndpoint?: string;
  onTurnFinish?: () => void;
  extraBody?: Record<string, unknown>;
  initialMessage?: string;
  showAgentSelector?: boolean;
  /** 项目根目录绝对路径，用于将 Agent 返回的相对路径补全为绝对路径 */
  projectPath?: string;
  /** 上下文水位数据（新 schema）。从会话数据库读取传入，SSE 流推送时会覆盖此值。 */
  contextBudget?: import('@the-thing/core').ContextBudgetSnapshot | null;
}

export default function Chat({ conversationId: propConversationId, onTitleUpdated, apiEndpoint, onTurnFinish, extraBody, initialMessage, showAgentSelector = true, projectPath, contextBudget }: ChatProps) {
  const { t } = useTranslation('chat');
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(propConversationId ?? null);
  const isNewConversation = !conversationId;
  const initialMessageCountRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const initialMessageSentRef = useRef(false);

  // 审批对话框状态（用于工具审批）- 支持批量审批
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);

  // 会话信任：本次对话中已审批过的 scope，同类操作自动放行
  const sessionApprovedScopesRef = useRef(new Set<string>());
  const autoApprovedIdsRef = useRef(new Set<string>());

  // 来自 SQLite 挂起状态的审批 ID（后台 connector 暂停后恢复的场景）
  // 这些审批不能使用 addToolApprovalResponse（需要活跃 stream），
  // 必须通过 /api/chat/suspended-approval-response REST 端点处理。
  const backgroundApprovalIdsRef = useRef(new Set<string>());

  // 问题收集面板状态（用于 ask_user_question）
  const [questionPanel, setQuestionPanel] = useState<{
    isOpen: boolean;
    toolCallId: string;
    questions: Array<{
      question: string;
      header: string;
      options: string[];
      multiSelect?: boolean;
    }>;
  } | null>(null);

  // 计划确认面板状态（用于 submit_plan）
  const [planPanel, setPlanPanel] = useState<PlanReviewRequest | null>(null);

  // 消息编辑状态
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingAttachments, setEditingAttachments] = useState<Array<{ type: 'file'; mediaType?: string; url: string; filename?: string }>>([]);

  const [conversationTree, setConversationTree] = useState<ConversationTree>({
    revision: 0,
    activeTipId: null,
    nodes: [],
  });
  const [branchSummaries, setBranchSummaries] = useState<ConversationBranchSummary[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  // 将分支按 fork 点聚合，用于 InlineBranchSelector 在消息旁显示
  const branchesByForkPoint = useMemo(() => {
    const map = new Map<string, ConversationBranchSummary[]>();
    for (const branch of branchSummaries) {
      if (!branch.forkMessageId) continue;
      const list = map.get(branch.forkMessageId) ?? [];
      list.push(branch);
      map.set(branch.forkMessageId, list);
    }
    return map;
  }, [branchSummaries]);
  const [branchPanelOpen, setBranchPanelOpen] = useState(false);
  const [branchActionError, setBranchActionError] = useState<string | null>(null);
  const [branchSwitching, setBranchSwitching] = useState(false);

  // /doctor 诊断面板状态
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  // 运行 /doctor 诊断：GET /api/doctor → 报告（确定性引擎，不走 LLM）
  const runDoctor = useCallback(async () => {
    setDoctorOpen(true);
    setDoctorLoading(true);
    setDoctorError(null);
    try {
      const res = await fetch('/api/doctor');
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error ?? '诊断失败');
      }
      setDoctorReport(await res.json() as DoctorReport);
    } catch (e) {
      setDoctorError(e instanceof Error ? e.message : '诊断失败');
      setDoctorReport(null);
    } finally {
      setDoctorLoading(false);
    }
  }, []);

  // 执行修复（POST /api/doctor）后刷新报告
  const handleDoctorRepair = useCallback(async (repairId: string, confirm: boolean): Promise<RepairOutcome> => {
    try {
      const res = await fetch('/api/doctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repairId, confirm }),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error ?? '修复失败');
      }
      const outcome = await res.json() as RepairOutcome;
      if (outcome.status !== 'needs-confirmation') {
        // 修复已执行，刷新报告
        await runDoctor();
      }
      return outcome;
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : '修复失败' };
    }
  }, [runDoctor]);

  // 文件预览分栏状态
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    content: string;
    language?: string;
    fileUrl?: string;
    mediaType?: string;
  } | null>(null);
  const [previewedToolKey, setPreviewedToolKey] = useState<string | null>(null);
  // 点击工具行内联展开输出卡的 toolKey 集合（bash 终端卡 + 报告类工具报告卡，不走右侧文件预览面板）
  const [expandedInlineKeys, setExpandedInlineKeys] = useState<Set<string>>(new Set());

  // 模型、Agent、审批模式选择状态（持久化到 ~/.thething/preferences.json + localStorage）
  const {
    selectedModel,
    selectedAgent,
    approvalMode,
    handleModelChange,
    handleAgentChange,
    handleApprovalModeChange,
  } = useChatPreferences();

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

    // Goal commands
    items.push(
      { id: 'goal:set', type: 'goal', label: '/goal', description: 'Set a goal for the agent to work towards' },
      { id: 'goal:status', type: 'goal', label: '/goal status', description: 'View current goal status' },
      { id: 'goal:pause', type: 'goal', label: '/goal pause', description: 'Pause auto-continuation' },
      { id: 'goal:resume', type: 'goal', label: '/goal resume', description: 'Resume from paused state' },
      { id: 'goal:continue', type: 'goal', label: '/goal continue', description: 'Continue after max turns' },
      { id: 'goal:complete', type: 'goal', label: '/goal complete', description: 'Mark goal as complete' },
      { id: 'goal:clear', type: 'goal', label: '/goal clear', description: 'Clear active goal' },
    );

    // Doctor 诊断
    items.push(
      { id: 'doctor:run', type: 'doctor', label: '/doctor', description: 'Diagnose and repair data dir / database' },
    );

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
        case 'doctor':
          runDoctor();
          if (textarea) { textarea.value = ''; textarea.focus(); }
          break;
        case 'skill':
          if (textarea) { textarea.value = `/skill ${item.label} `; textarea.focus(); }
          break;
        case 'goal':
          // For goal commands, set the textarea to the command
          if (textarea) {
            const goalId = item.id.replace('goal:', '');
            if (goalId === 'set') {
              textarea.value = '/goal ';
            } else {
              textarea.value = `/goal ${goalId} `;
            }
            textarea.focus();
          }
          break;
      }

      setSlashCommandOpen(false);
      setSlashCommandQuery('');
      setSlashCommandSelectedIndex(0);
      // Prevent the menu from re-opening on the next input change
      slashCommandJustSelectedRef.current = true;
    },
    [handleAgentChange, handleModelChange, handleApprovalModeChange, runDoctor],
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

  const pendingOperationRef = useRef<'append' | 'regenerate' | 'edit'>('append');
  const extraBodyRef = useRef<Record<string, unknown> | undefined>(extraBody);
  extraBodyRef.current = {
    ...extraBody,
    modelName: selectedModel === 'default' ? undefined : selectedModel,
    agentType: selectedAgent === 'auto' ? undefined : selectedAgent,
    approvalMode,
    branchId: activeBranchId ?? undefined,
    expectedTipId: conversationTree.activeTipId,
  };

  const transport = useMemo(() => {
    if (!conversationId) return undefined;
    return createChatTransport(conversationId, apiEndpoint, extraBodyRef, pendingOperationRef);
  }, [conversationId, apiEndpoint]);

  // 审批检测缓存：避免 sendAutomaticallyWhen 中的高频计算
  const lastProcessedPartCountRef = useRef(0);
  const pendingAutoApprovalRef = useRef(false);

  // ── 分支 ──────────────────────────────────────────────
  // 轮询拉取最新分支投影（一轮生成结束后分支结构会变化）
  const refreshBranchProjection = useCallback(async (minimumRevision?: number) => {
    if (!conversationId) return;
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const projectionRes = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/projection`);
        if (!projectionRes.ok) return;
        const projection = await projectionRes.json() as ConversationProjection;
        const tree = projection.tree;
        setBranchSummaries(projection.branches ?? []);
        setActiveBranchId(projection.activeBranchId);
        setConversationTree((current: ConversationTree) => tree.revision >= current.revision ? tree : current);
        if (minimumRevision == null || tree.revision > minimumRevision) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch {
      // 分支投影拉取失败不影响主流程
    }
  }, [conversationId]);

  // 用户主动终止标志：abort 后 SDK 会在 finally 里再跑一次 sendAutomaticallyWhen，
  // 若最后一条 assistant 消息的工具调用恰好都已完成，会立即自动重发（终止按钮"没反应"）。
  // 置位后 sendAutomaticallyWhen 一律返回 false；用户下一次主动操作时复位。
  const stopRequestedRef = useRef(false);

  // 声明提前：onFinish 回调中需要在 todos fetch 兜底时调用 setStreamTodoData
  const [streamTodoData, setStreamTodoData] = useState<import('@/lib/todos/types').Todo[] | null>(null);
  const lastTodoUpdateRef = useRef('');

  const { messages, setMessages, sendMessage, regenerate, status, stop, error, addToolApprovalResponse, addToolOutput } = useChat({
    id: conversationId || 'pending',
    transport: transport as any,
    resume: !!conversationId,
    experimental_throttle: 80, // 节流 UI 更新，避免每块 SSE chunk 都触发 React 全量重渲染
    sendAutomaticallyWhen: ({ messages }) => {
      if (stopRequestedRef.current) return false;
      const lastMsg = messages.at(-1);
      if (!lastMsg || lastMsg.role !== 'assistant') return false;

      // 如果有 data-plan 类型，不自动发送
      if (lastMsg.parts.some((p) => p.type === 'data-plan')) {
        return false;
      }

      // 快速检查：如果没有工具调用或审批请求，直接判断是否完成
      const hasToolParts = lastMsg.parts.some(p => p.type.startsWith('tool-') || p.type === 'dynamic-tool');
      if (!hasToolParts) {
        return lastAssistantMessageIsCompleteWithToolCalls({ messages });
      }

      // 仅在 parts 数量变化时执行完整的审批检测（避免重复计算）
      const currentPartCount = lastMsg.parts.length;
      if (currentPartCount === lastProcessedPartCountRef.current && !pendingAutoApprovalRef.current) {
        // 使用缓存的审批状态
        return lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
               lastAssistantMessageIsCompleteWithToolCalls({ messages });
      }
      lastProcessedPartCountRef.current = currentPartCount;

      // 完整的审批检测（仅在 parts 变化时执行）
      const pendingApprovals: ApprovalRequest[] = [];
      const seenApprovalIds = new Set<string>();
      let questionRequest: {
        toolCallId: string;
        questions: Array<{
          question: string;
          header: string;
          options: string[];
          multiSelect?: boolean;
        }>;
      } | null = null;
      let planRequest: PlanReviewRequest | null = null;

      for (const part of lastMsg.parts) {
        const isToolPart = part.type.startsWith('tool-') || part.type === 'dynamic-tool';
        const hasToolCallId = 'toolCallId' in part;
        const toolState = (part as { state?: string }).state;

        if (!isToolPart || !hasToolCallId) continue;

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

        // 客户端工具 ask_user_question：检测 input-available（无 execute 工具挂起等待前端）
        if (toolName === 'ask user question' && toolState === 'input-available') {
          if (!questionRequest) {
            const questions = (toolPart.input?.questions as Array<{
              question: string;
              header: string;
              options: string[];
              multiSelect?: boolean;
            }>) || [];
            questionRequest = {
              toolCallId: toolPart.toolCallId,
              questions,
            };
          }
          continue;
        }

        if (toolState !== 'approval-requested') continue;
        const approvalId = toolPart.approval?.id;
        const toolInput = toolPart.input || {};

        // 计划确认（submit_plan）：不走通用审批列表和会话自动放行，
        // 必须由用户亲自确认，渲染专用计划卡
        if (toolName === 'submit_plan' && approvalId && !seenApprovalIds.has(approvalId)) {
          seenApprovalIds.add(approvalId);
          const todos = (toolInput.todos as Array<{ subject: string; verify?: string }>) || [];
          if (todos.length > 0) {
            planRequest = {
              approvalId,
              toolCallId: toolPart.toolCallId,
              todos,
            };
          }
          continue;
        }

        if (approvalId && !seenApprovalIds.has(approvalId)) {
          seenApprovalIds.add(approvalId);
          // 会话信任：如果该 scope 已在本次对话中被批准过，自动放行
          const scope = computeApprovalScope(toolName, toolInput);
          if (sessionApprovedScopesRef.current.has(scope) && !autoApprovedIdsRef.current.has(approvalId)) {
            autoApprovedIdsRef.current.add(approvalId);
            pendingAutoApprovalRef.current = true;
            Promise.resolve(addToolApprovalResponse({ id: approvalId, approved: true })).catch((err: unknown) => console.error('[Chat] Auto-approve error:', err));
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

      pendingAutoApprovalRef.current = false;

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
          toolCallId: questionRequest.toolCallId,
          questions: questionRequest.questions,
        });
      }

      // 更新计划确认面板
      if (planRequest) {
        setPlanPanel(planRequest);
      }

      // 如果还有待审批的工具调用，不自动发送（等待用户处理所有审批）
      if (pendingApprovals.length > 0 || planRequest) {
        return false;
      }

      // 只有当所有审批都已响应，且消息看起来完成时才自动发送
      return lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
             lastAssistantMessageIsCompleteWithToolCalls({ messages });
    },
    onFinish: async ({ messages: finishedMessages, isError, isDisconnect }) => {
      // 消息持久化由服务端流的 onEnd 统一负责（唯一写入权威），前端不再回写
      if (isError || isDisconnect) {
        console.warn(`[Chat] Stream failed (error=${isError}, disconnect=${isDisconnect})`);
        // 中断/断连时服务端 stop 路径仍会把部分 assistant 消息落库并前移分支 tip;
        // 必须刷新投影,否则下一条消息带过期 expectedTipId → Branch tip conflict 500
        void refreshBranchProjection(conversationTree.revision);
        // 断连时 SSE 流中的 data-todo-update 可能丢失，主动 fetch 最新状态
        if (conversationId) {
          try {
            const res = await fetch(`/api/todos?conversationId=${encodeURIComponent(conversationId)}`);
            if (res.ok) {
              const data = await res.json() as { todos: import('@/lib/todos/types').Todo[] };
              if (data.todos) {
                const serialized = JSON.stringify(data.todos);
                if (serialized !== lastTodoUpdateRef.current) {
                  lastTodoUpdateRef.current = serialized;
                  setStreamTodoData(data.todos);
                }
              }
            }
          } catch { /* 网络失败不影响主流程 */ }
        }
        return;
      }

      onTurnFinish?.();

      // 服务端 onEnd 与客户端 onFinish 可能并发；按已知 revision 做短轮询，
      // 只接受更新版本，避免固定等待后仍读到旧分支结构。
      void refreshBranchProjection(conversationTree.revision);

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

      // 正常完成路径：SSE 流最后一个 finish-step 后若断连可能丢失最终 todo 状态，主动兜底一次
      if (conversationId) {
        try {
          const res = await fetch(`/api/todos?conversationId=${encodeURIComponent(conversationId)}`);
          if (res.ok) {
            const data = await res.json() as { todos: import('@/lib/todos/types').Todo[] };
            if (data.todos) {
              const serialized = JSON.stringify(data.todos);
              if (serialized !== lastTodoUpdateRef.current) {
                lastTodoUpdateRef.current = serialized;
                setStreamTodoData(data.todos);
              }
            }
          }
        } catch { /* 网络失败不影响主流程 */ }
      }
    },
  });

  // ── 流式 todo 更新：从 SSE 流中提取 data-todo-update 事件 ──
  // streamTodoData / lastTodoUpdateRef 已在 useChat 上方声明，此处仅保留 effect
  useEffect(() => {
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === 'data-todo-update' && 'data' in part) {
          const d = (part as { data: { todos: import('@/lib/todos/types').Todo[] } }).data;
          if (d?.todos) {
            const serialized = JSON.stringify(d.todos);
            if (serialized !== lastTodoUpdateRef.current) {
              lastTodoUpdateRef.current = serialized;
              setStreamTodoData(d.todos);
            }
          }
        }
      }
    }
  }, [messages]);

  const [streamContextBudget, setStreamContextBudget] = useState<import('@the-thing/core').ContextBudgetSnapshot | null>(null);

  // 压缩状态：从输入框水位环迁到消息回复区内的工具调用风格指示器。
  // null=无事件, 'compacting'=压缩中(转圈), 'done'=刚完成(短暂显示已压缩 N tokens)。
  // 保留 tokensFreed 用于 end 时反馈具体释放量。
  type CompactionUiState = { status: 'compacting' } | { status: 'done'; tokensFreed?: number } | null;
  const [compactionUi, setCompactionUi] = useState<CompactionUiState>(null);

  // 持久化最新的上下文水位数据，流式数据消失后仍保留
  const persistedContextBudget = useRef(streamContextBudget);
  if (streamContextBudget != null) {
    persistedContextBudget.current = streamContextBudget;
  }

  const [showContextDetail, setShowContextDetail] = useState(false);
  const contextDetailRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭弹窗
  useEffect(() => {
    if (!showContextDetail) return;
    const handler = (e: MouseEvent) => {
      if (contextDetailRef.current && !contextDetailRef.current.contains(e.target as Node)) {
        setShowContextDetail(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [showContextDetail]);

  // 流式上下文水位优先，持久化兜底，再回退到 prop
  const effectiveContextBudget = streamContextBudget ?? persistedContextBudget.current ?? contextBudget ?? null;

  // 从流式消息的 data-context-usage 部分提取上下文水位数据
  // 优先用新 schema 字段；stream data 同时含旧字段做兜底
  // 关键：只处理本次 turn 的新 messages（index >= initialMessageCountRef），
  // 历史 messages 里的 data-context-usage parts 是旧 SSE 快照（含修复前的
  // bug 数据如 inputTokens=0），否则会把正确的初始 prop 覆盖回 100%。
  useEffect(() => {
    const startIndex = initialMessageCountRef.current ?? 0;
    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i];
      for (const part of msg.parts) {
        if (part.type === 'data-context-usage' && 'data' in part) {
          const d = (part as { data: Record<string, unknown> }).data;
          if (!d) continue;
          // 优先用新 schema 字段
          const snapshot: ContextBudgetSnapshot = {
            utilizationPercent: typeof d.utilizationPercent === 'number'
              ? d.utilizationPercent
              : (typeof d.usagePercentage === 'number' ? d.usagePercentage : 0),
            totalTokens: typeof d.totalTokens === 'number' ? d.totalTokens : 0,
            modelLimit: typeof d.modelLimit === 'number' ? d.modelLimit : 128_000,
            compaction: d.compaction && typeof d.compaction === 'object'
              ? d.compaction as ContextBudgetSnapshot['compaction']
              : {
                  state: 'idle' as const,
                  compactionsCount: typeof d.compactionActive === 'boolean' && d.compactionActive ? 1 : 0,
                  totalFreed: typeof d.lastCompactionFreedTokens === 'number' ? d.lastCompactionFreedTokens : 0,
                  triggerPercent: typeof d.compactionTriggerWatermark === 'number' ? d.compactionTriggerWatermark / 100 : 0.85,
                },
            sessionCost: {
              inputTokens: typeof d.sessionCost === 'object' && d.sessionCost !== null && 'inputTokens' in d.sessionCost
                ? Number((d.sessionCost as { inputTokens: number }).inputTokens)
                : (typeof d.sessionInputTokens === 'number' ? d.sessionInputTokens : 0),
              outputTokens: typeof d.sessionCost === 'object' && d.sessionCost !== null && 'outputTokens' in d.sessionCost
                ? Number((d.sessionCost as { outputTokens: number }).outputTokens)
                : (typeof d.sessionOutputTokens === 'number' ? d.sessionOutputTokens : 0),
              cachedReadTokens: typeof d.sessionCost === 'object' && d.sessionCost !== null && 'cachedReadTokens' in d.sessionCost
                ? Number((d.sessionCost as { cachedReadTokens: number }).cachedReadTokens)
                : (typeof d.sessionCachedReadTokens === 'number' ? d.sessionCachedReadTokens : 0),
              totalCostUsd: typeof d.sessionCost === 'object' && d.sessionCost !== null && 'totalCostUsd' in d.sessionCost
                ? Number((d.sessionCost as { totalCostUsd: number }).totalCostUsd)
                : 0,
            },
            capturedAt: typeof d.capturedAt === 'string' ? d.capturedAt : new Date().toISOString(),
            source: 'live' as const,
          };
          // schema 校验：失败则跳过本次更新
          const result = ContextBudgetSnapshotSchema.safeParse(snapshot);
          if (result.success) {
            setStreamContextBudget(result.data);
          }
        }
      }
    }
  }, [messages]);

  // 从流式消息的 data-compaction-status 部分提取压缩状态。
  // 用 ref 记录上次处理过的 part id，只处理新增的 part（避免 messages 后续变化时
  // 累积判断把 done 状态反复重置为 compacting/done，状态行卡住不消失）。
  const lastCompactionPartIdRef = useRef<string | null>(null);
  useEffect(() => {
    const allParts: Array<{ id: string; status: 'start' | 'end'; tokensFreed?: number }> = [];
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === 'data-compaction-status' && 'data' in part) {
          const d = (part as { data: { status: 'start' | 'end'; tokensFreed?: number } }).data;
          if (!d) continue;
          allParts.push({ id: (part as { id?: string }).id ?? '', status: d.status, tokensFreed: d.tokensFreed });
        }
      }
    }
    const lastSeen = lastCompactionPartIdRef.current;
    const lastSeenIdx = lastSeen ? allParts.findIndex((p) => p.id === lastSeen) : -1;
    const newParts = lastSeenIdx >= 0 ? allParts.slice(lastSeenIdx + 1) : allParts;
    if (newParts.length === 0) return;
    const latest = newParts[newParts.length - 1];
    lastCompactionPartIdRef.current = latest.id;

    if (latest.status === 'start') {
      setCompactionUi({ status: 'compacting' });
    } else {
      setCompactionUi({ status: 'done', tokensFreed: latest.tokensFreed });
      // 1.5 秒后自动清空，让流式回复自然继续
      const timer = setTimeout(() => setCompactionUi(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  // MCP App 发来的消息转发给 agent，触发 agent 回复
  const handleMcpAppMessage = useCallback((text: string) => {
    sendMessage({ text });
  }, [sendMessage]);

  // 处理问题收集完成
  const handleQuestionsComplete = useCallback((answersArray: Array<{ question: string; answer: string | string[] }>) => {
    if (questionPanel) {
      // 用 addToolOutput 回写结构化答案（客户端工具，无需审批通道）
      addToolOutput({
        tool: 'ask_user_question' as any,
        toolCallId: questionPanel.toolCallId,
        output: { answers: answersArray },
      });

      setQuestionPanel(null);
    }
  }, [addToolOutput, questionPanel]);

  // 处理问题收集取消
  const handleQuestionsCancel = useCallback(() => {
    if (questionPanel) {
      addToolOutput({
        tool: 'ask_user_question' as any,
        toolCallId: questionPanel.toolCallId,
        state: 'output-error',
        errorText: '用户取消了提问，请根据已有信息继续或换一种方式询问',
      });
      setQuestionPanel(null);
    }
  }, [addToolOutput, questionPanel]);

  // ── 调用后台挂起审批恢复 API ──
  const handleSuspendedApproval = useCallback(async (approved: boolean) => {
    if (!conversationId) return;
    const apiEndpoint = '/api/chat/suspended-approval-response';
    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, approved }),
      });
      const data = await res.json();
      if (data.success && data.messages) {
        setMessages(data.messages as UIMessage[]);
      }
      return data;
    } catch (err) {
      console.error('[Chat] Suspended approval API error:', err);
      return { success: false };
    }
  }, [conversationId, setMessages]);

  // 处理审批批准（单个）
  const handleApprove = useCallback((approvalId: string, options?: { alwaysAllow?: boolean }) => {
    // 用户主动批准：解除终止拦截（审批响应依赖 sendAutomaticallyWhen 续跑）
    stopRequestedRef.current = false;
    // 后台挂起的审批不能使用 addToolApprovalResponse（需要活跃 stream）
    if (backgroundApprovalIdsRef.current.has(approvalId)) {
      // 清空审批列表，调用恢复 API
      setApprovalRequests([]);
      backgroundApprovalIdsRef.current.clear();
      handleSuspendedApproval(true);
      return;
    }

    // 记录 session scope — 本次对话内同类操作自动放行
    const request = approvalRequests.find(r => r.approvalId === approvalId);
    if (request) {
      const scope = computeApprovalScope(request.toolName, request.toolInput);
      sessionApprovedScopesRef.current.add(scope);
    }

    // 立即从审批列表中移除该项
    setApprovalRequests(prev => prev.filter(r => r.approvalId !== approvalId));

    Promise.resolve(addToolApprovalResponse({
      id: approvalId,
      approved: true,
    })).catch((err: unknown) => console.error('[Chat] addToolApprovalResponse error:', err));

    // 持久化规则（跨会话生效）
    if (options?.alwaysAllow && request) {
      saveAlwaysAllowRule(request.toolName, request.toolInput);
    }
  }, [addToolApprovalResponse, approvalRequests, handleSuspendedApproval]);

  // 处理批量审批批准
  const handleApproveAll = useCallback((requests: ApprovalRequest[], options?: { alwaysAllow?: boolean }) => {
    // 用户主动批准：解除终止拦截
    stopRequestedRef.current = false;
    // 检查是否为后台挂起审批
    const hasBackground = requests.some(r => backgroundApprovalIdsRef.current.has(r.approvalId));
    if (hasBackground) {
      setApprovalRequests([]);
      backgroundApprovalIdsRef.current.clear();
      handleSuspendedApproval(true);
      return;
    }

    // 立即清空审批列表
    setApprovalRequests([]);

    for (const req of requests) {
      // 记录 session scope
      const scope = computeApprovalScope(req.toolName, req.toolInput);
      sessionApprovedScopesRef.current.add(scope);

      Promise.resolve(addToolApprovalResponse({
        id: req.approvalId,
        approved: true,
      })).catch((err: unknown) => console.error('[Chat] addToolApprovalResponse error:', err));

      if (options?.alwaysAllow) {
        saveAlwaysAllowRule(req.toolName, req.toolInput);
      }
    }
  }, [addToolApprovalResponse, handleSuspendedApproval]);

  // 处理审批拒绝（单个）
  const handleDeny = useCallback((approvalId: string, reason?: string) => {
    // 用户主动拒绝：解除终止拦截（拒绝后同样依赖自动续跑把拒绝结果发回 Agent）
    stopRequestedRef.current = false;
    // 后台挂起的审批
    if (backgroundApprovalIdsRef.current.has(approvalId)) {
      setApprovalRequests([]);
      backgroundApprovalIdsRef.current.clear();
      handleSuspendedApproval(false);
      return;
    }

    setApprovalRequests(prev => prev.filter(r => r.approvalId !== approvalId));
    addToolApprovalResponse({
      id: approvalId,
      approved: false,
      reason: reason,
    });
  }, [addToolApprovalResponse, handleSuspendedApproval]);

  // 处理批量审批拒绝
  const handleDenyAll = useCallback((requests: ApprovalRequest[], reason?: string) => {
    // 用户主动拒绝：解除终止拦截
    stopRequestedRef.current = false;
    // 检查是否为后台挂起审批
    const hasBackground = requests.some(r => backgroundApprovalIdsRef.current.has(r.approvalId));
    if (hasBackground) {
      setApprovalRequests([]);
      backgroundApprovalIdsRef.current.clear();
      handleSuspendedApproval(false);
      return;
    }

    setApprovalRequests([]);
    for (const req of requests) {
      addToolApprovalResponse({
        id: req.approvalId,
        approved: false,
        reason: reason,
      });
    }
  }, [addToolApprovalResponse, handleSuspendedApproval]);

  // ── 计划确认（submit_plan）──
  // 计划卡只在活跃 stream 上出现（模型刚调用 submit_plan 挂起），
  // 与普通审批一样用 addToolApprovalResponse 续跑；批准后服务端 execute
  // 把计划写入 todo，拒绝（附理由）则模型重新规划。
  const handlePlanApprove = useCallback((approvalId: string) => {
    stopRequestedRef.current = false;
    setPlanPanel(null);
    Promise.resolve(addToolApprovalResponse({
      id: approvalId,
      approved: true,
    })).catch((err: unknown) => console.error('[Chat] addToolApprovalResponse error:', err));
  }, [addToolApprovalResponse]);

  const handlePlanReject = useCallback((approvalId: string, reason?: string) => {
    stopRequestedRef.current = false;
    setPlanPanel(null);
    Promise.resolve(addToolApprovalResponse({
      id: approvalId,
      approved: false,
      reason: reason,
    })).catch((err: unknown) => console.error('[Chat] addToolApprovalResponse error:', err));
  }, [addToolApprovalResponse]);

  // 停止 Agent 时清理未完成的 todo，避免 orphaned in_progress 状态
  const handleStop = useCallback(() => {
    // 先置位：abort 触发的 finally 会再跑一次 sendAutomaticallyWhen，必须拦住自动重发
    stopRequestedRef.current = true;
    stop();
    // stop() 只中止客户端 fetch；resume 重连的流没有 abort signal，
    // 且服务端 agent（LLM 调用/bash 进程）需通过 /stop 端点的 abortChat 终止。
    // 服务端 stopStream 会向所有监听者发 DONE，恢复中的流也会随之关闭。
    if (conversationId) {
      const baseEndpoint = apiEndpoint || '/api/chat';
      fetch(`${baseEndpoint}/${conversationId}/stop`, { method: 'POST' })
        // stop 落库部分 assistant 消息后分支 tip 前移,刷新投影拿到新 tip,
        // 避免下一条消息带过期 expectedTipId 触发 Branch tip conflict
        .then(() => refreshBranchProjection(conversationTree.revision))
        .catch(err => console.error('[Chat] Failed to stop server stream:', err));
    }
    // Fire and forget: 将在执行中的 todo 重置为 pending，下一轮 Agent 可以继续
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reset-conversation',
        conversationId,
      }),
    }).catch(err => console.error('[Chat] Failed to reset todos:', err));
  }, [stop, conversationId, apiEndpoint, refreshBranchProjection, conversationTree.revision]);

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
          void refreshBranchProjection();

          // 刷新/重启后从消息历史重建待审批 UI
          const { approvals, question } = collectPendingApprovals(data.messages as UIMessage[]);
          if (approvals.length > 0) {
            setApprovalRequests(approvals);
          }
          if (question) {
            setQuestionPanel(prev => prev?.isOpen ? prev : {
              isOpen: true,
              toolCallId: question.toolCallId,
              questions: question.questions,
            });
          }
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
  }, [conversationId, setMessages, apiEndpoint, refreshBranchProjection]);

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
          console.log(`[Chat] Restored ${pendingForConversation.approvals.length} pending approvals from SQLite for conversation ${conversationId}`);
          // 记录这些审批 ID 为"后台挂起"类型，不能使用 addToolApprovalResponse
          for (const a of pendingForConversation.approvals) {
            backgroundApprovalIdsRef.current.add(a.approvalId);
          }
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

      // 用户主动发送：解除终止拦截，恢复自动继续
      stopRequestedRef.current = false;

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
          case 'doctor':
            runDoctor();
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
          // 从当前 URL 提取项目 ID（如果在项目视图中）
          const currentPath = window.location.pathname;
          const projectMatch = currentPath.match(/\/chat\/p\/([^/]+)/);
          const projectId = projectMatch ? projectMatch[1] : undefined;

          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newId, projectId }),
          });
          if (res.ok) {
            setConversationId(newId);
            // 导航到新对话 URL（保持项目上下文）
            const basePath = projectId ? `/chat/p/${projectId}` : '/chat';
            router.replace(`${basePath}/user/${newId}?msg=${encodeURIComponent(text)}`);
            return; // 等待 conversationId 更新后会自动发送
          }
        } catch {
          // 创建失败
        }
      }
      pendingOperationRef.current = 'append';
      sendMessage({ text, files: files.length > 0 ? files : undefined });
    },
    [sendMessage, handleAgentChange, handleModelChange, handleApprovalModeChange, runDoctor],
  );

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  // 使用 SDK 内置 regenerate：保留原用户消息 id 并截断其后所有消息。
  // 服务端（route.ts）按 message.id 匹配截断点，换新 id 重发会导致
  // 服务端不截断旧轮次，刷新后历史出现重复消息与错乱。
  const handleRegenerate = useCallback(
    (messageId: string) => {
      // 用户主动重新生成：解除终止拦截
      stopRequestedRef.current = false;
      Promise.resolve(regenerate({ messageId })).catch((err: unknown) => {
        console.error('[Chat] Regenerate error:', err);
      });
    },
    [regenerate],
  );

  const handleFormalBranchSwitch = useCallback(async (branchId: string) => {
    if (!conversationId || branchSwitching) return;
    // 先终止客户端活跃流，避免切换后残余数据覆盖新消息
    stop();
    setBranchSwitching(true);
    setBranchActionError(null);
    stopRequestedRef.current = true;
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'switch', branchId }),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        setBranchActionError(failure.error ?? '分支切换失败');
        return;
      }
      const data = await res.json() as { projection?: ConversationProjection };
      if (data.projection) {
        setMessages(data.projection.messages);
        setConversationTree(data.projection.tree);
        setBranchSummaries(data.projection.branches ?? []);
        setActiveBranchId(data.projection.activeBranchId);
      }
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : '分支切换失败');
    } finally {
      setBranchSwitching(false);
    }
  }, [conversationId, branchSwitching, apiEndpoint, setMessages, stop]);

  // 从消息处分叉：创建正式 Branch ���激活，保留分叉点以上为上下文。
  const handleFork = useCallback(async (messageId: string) => {
    if (!conversationId || branchSwitching || !activeBranchId) return;
    stop();
    setBranchSwitching(true);
    setBranchActionError(null);
    stopRequestedRef.current = true;
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fork', sourceBranchId: activeBranchId, fromMessageId: messageId }),
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        setBranchActionError(failure.error ?? '分叉失败');
        return;
      }
      const data = await res.json() as { projection?: ConversationProjection };
      if (data.projection) {
        // 保留分叉点以上所有消息为上下文，不删除任何消息
        setMessages(data.projection.messages);
        setConversationTree(data.projection.tree);
        setBranchSummaries(data.projection.branches ?? []);
        setActiveBranchId(data.projection.activeBranchId);
      }
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : '分叉失败');
    } finally {
      setBranchSwitching(false);
    }
  }, [conversationId, branchSwitching, activeBranchId, apiEndpoint, setMessages, stop]);

  const handleBranchManage = useCallback(async (
    branch: ConversationBranchSummary,
    action: BranchAction,
  ) => {
    if (!conversationId || branchSwitching) return;
    let method = 'PATCH';
    let body: Record<string, unknown> | undefined;
    if (action === 'pin') {
      body = { isPinned: !branch.isPinned };
    } else if (action === 'archive') {
      body = { status: branch.status === 'archived' ? 'active' : 'archived' };
    } else if (action === 'rename') {
      return;
    } else {
      if (!window.confirm(`确定删除路线“${branch.name || '未命名路线'}”吗？只有没有运行记录、摘要和子路线的路线可以删除；其他路线请归档。`)) return;
      method = 'DELETE';
    }
    setBranchSwitching(true);
    setBranchActionError(null);
    try {
      const res = await fetch(
        `/api/chat/${encodeURIComponent(conversationId)}/branches/${encodeURIComponent(branch.id)}`,
        {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        setBranchActionError(failure.error ?? '分支操作失败');
        return;
      }
      const data = await res.json() as { projection?: ConversationProjection };
      if (data.projection) {
        setBranchSummaries(data.projection.branches ?? []);
        setActiveBranchId(data.projection.activeBranchId);
        setConversationTree(data.projection.tree);
      }
    } catch (error) {
      setBranchActionError(error instanceof Error ? error.message : '分支操作失败');
    } finally {
      setBranchSwitching(false);
    }
  }, [conversationId, branchSwitching]);

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

    // 若旧一轮还在运行，先停掉客户端流（服务端由新 POST 的单飞行 abort 兜底），
    // 避免旧流的 UI 更新与编辑后的新流互踩
    if (status === 'streaming' || status === 'submitted') {
      stop();
    }

    // 用户主动重发编辑后的消息：解除终止拦截
    stopRequestedRef.current = false;

    const messageIndex = messages.findIndex(m => m.id === editingMessageId);
    if (messageIndex === -1) return;

    const originalMessage = messages[messageIndex];

    // 截断：保留被编辑消息之前的所有消息
    const truncated = messages.slice(0, messageIndex);

    // 更新被编辑消息的文本内容。保留原 id：服务端按 id 匹配截断点，
    // 换新 id 会导致旧轮次不被截断、历史错乱。
    // 只替换第一个 text part（编辑框展示的即合并后的文本），
    // 其余 text part 置空，避免多 text part 消息内容重复
    let textReplaced = false;
    const updatedMessage = {
      ...originalMessage,
      parts: originalMessage.parts
        .map(p => {
          if (p.type !== 'text') return p;
          if (textReplaced) return null;
          textReplaced = true;
          return { ...p, text: editingText };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    };

    // 只保留截断部分；sendMessage 会把消息重新推入列表
    //（若预先塞入再 sendMessage 会出现同 id 双份，即历史上的 duplicate keys 问题）
    setMessages(truncated);
    pendingOperationRef.current = 'edit';
    sendMessage(updatedMessage);

    setEditingMessageId(null);
    setEditingText('');
    setEditingAttachments([]);
  }, [editingMessageId, editingText, messages, setMessages, sendMessage, status, stop]);

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
            <div className="ml-auto flex items-center gap-2">
              {effectiveContextBudget && (
                <div className="relative">
                  <button
                    type="button"
                    className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                    title={`上下文窗口: ${effectiveContextBudget.utilizationPercent.toFixed(0)}% (${effectiveContextBudget.totalTokens >= 1000 ? `${(effectiveContextBudget.totalTokens / 1000).toFixed(0)}K` : effectiveContextBudget.totalTokens}/${effectiveContextBudget.modelLimit >= 1000 ? `${(effectiveContextBudget.modelLimit / 1000).toFixed(0)}K` : effectiveContextBudget.modelLimit})`}
                    onClick={() => setShowContextDetail(true)}
                  >
                    <ContextRing snapshot={effectiveContextBudget} />
                  </button>

                  {showContextDetail && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowContextDetail(false)}
                      />
                      <div
                        ref={contextDetailRef}
                        className="fixed bottom-20 right-4 z-50 w-72 rounded-lg border bg-popover text-popover-foreground shadow-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-semibold text-foreground/80">上下文用量</h4>
                          <button
                            type="button"
                            onClick={() => setShowContextDetail(false)}
                            className="text-muted-foreground/50 hover:text-foreground transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>

                        {/* 新 schema 详情（v1：3 段；detail 4 段 + 累计 3 段在 v2 加） */}
                        <ContextDetail snapshot={effectiveContextBudget} />
                      </div>
                    </>
                  )}
                </div>
              )}
              <PromptInputSubmit status={status} onStop={handleStop} />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {/* 对话路线按钮 — portal 到 header 区域 */}
      {isInitialLoadDone && conversationTree.nodes.length > 0 && typeof document !== 'undefined' ? createPortal(
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={branchPanelOpen ? 'secondary' : 'ghost'}
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              if (previewFile) {
                setPreviewFile(null);
                setPreviewedToolKey(null);
              }
              setBranchPanelOpen((open) => !open);
            }}
          >
            <GitBranchIcon className="size-3.5" />
            对话路线
            <span className="rounded bg-background px-1 text-[10px] text-muted-foreground">
              {branchSummaries.filter((b) => b.status !== 'archived').length}
            </span>
          </Button>
        </div>,
        document.getElementById('branch-panel-toggle')!,
      ) : null}
    </div>
  )

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden">
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
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                {messages.map((message, messageIndex) => {
                const isEditing = editingMessageId === message.id;
                const userMessageText = message.role === 'user'
                  ? message.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
                  : '';

                // 同一条消息中相同 (toolName + input) 的 MCP App 只渲染一个 iframe
                const mcpAppKeys = new Set<string>();

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
                        {message.parts.map((part, index) => {
                          if (part.type === 'reasoning') {
                            // 同一步思考可能被流拆成多个相邻 reasoning part：
                            // 只在连续段的第一个渲染，把相邻段合并进同一个折叠块
                            if (index > 0 && message.parts[index - 1].type === 'reasoning') {
                              return null;
                            }
                            let end = index;
                            while (end + 1 < message.parts.length && message.parts[end + 1].type === 'reasoning') {
                              end += 1;
                            }
                            const reasoningText = message.parts
                              .slice(index, end + 1)
                              .map((p) => (p as { text: string }).text)
                              .join('\n\n');
                            // 仅当该消息的最后一个 part 就是这段思考且正在流式时才显示思考中动画
                            const isReasoningStreaming =
                              messageIndex === messages.length - 1 &&
                              status === 'streaming' &&
                              end === message.parts.length - 1;
                            return (
                              <Reasoning key={`${message.id}-${index}`} className="w-full" isStreaming={isReasoningStreaming}>
                                <ReasoningTrigger />
                                <ReasoningContent>{reasoningText}</ReasoningContent>
                              </Reasoning>
                            );
                          }

                          if (part.type === 'text') {
                            return (
                              <MessageResponse
                                key={`${message.id}-${index}`}
                              >
                                {part.text}
                              </MessageResponse>
                            );
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

                          if (part.type.startsWith('data-sub-') || part.type === 'data-todo-update' || part.type === 'data-context-usage' || part.type === 'data-compaction-status') {
                            return null;
                          }

                          // bash 直播帧不独立渲染，由对应工具 part 消费
                          if (part.type.startsWith('data-bash-')) {
                            return null;
                          }

                          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                            const toolPart = part as ToolUIPart;

                            // MCP App 工具：探测工具 _meta.ui 后渲染交互式 App
                            //（非 App 的 MCP 工具由 McpAppToolPart 内部返回 null，零影响）
                            let mcpAppSlot: React.ReactNode = null;
                            if (part.type === 'dynamic-tool') {
                              const dynToolName = (part as DynamicToolUIPart).toolName;
                              const input = (part as { input?: Record<string, unknown> }).input;
                              const output = (part as { output?: unknown }).output;
                              // 仅在 input 或 output 就绪时渲染，避免空数据初始化
                              if (dynToolName?.startsWith('mcp__') && (input || output)) {
                                const mcpKey = input ? `${dynToolName}|${JSON.stringify(input)}` : dynToolName;
                                if (!mcpAppKeys.has(mcpKey)) {
                                  mcpAppKeys.add(mcpKey);
                                  mcpAppSlot = (
                                    <McpAppToolPart
                                      toolName={dynToolName}
                                      state={toolPart.state}
                                      input={input}
                                      output={output}
                                      errorText={(part as { errorText?: string }).errorText}
                                      onSendMessage={handleMcpAppMessage}
                                    />
                                  );
                                }
                              }
                            }

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

                          // data-sub 事件 id 形如 `${toolCallId}`、`${toolCallId}#${seq}`（步骤）
                          // 或 `${toolCallId}-${i}[#seq]`（并行子任务），前缀匹配全部关联
                          const subParts = toolCallId
                            ? (message.parts as SubDataPart[]).filter(
                                (p) =>
                                  p.type.startsWith('data-sub-') &&
                                  (p.id === toolCallId ||
                                    p.id?.startsWith(`${toolCallId}#`) ||
                                    p.id?.startsWith(`${toolCallId}-`)),
                              )
                            : [];

                          const isSubAgent = subParts.length > 0;
                          const isDynamicTool = part.type === 'dynamic-tool';
                          const toolInfo = getToolTitleAndIcon(toolPart.type, toolPart.input as Record<string, unknown>, isDynamicTool ? (part as DynamicToolUIPart).toolName : undefined);
                          const toolTitle = toolInfo?.title;
                          const ToolIcon = toolInfo?.icon || SearchIcon;

                          const isComplete = toolPart.state === 'output-available';
                          const isError = toolPart.state === 'output-error';
                          const isDenied = toolPart.state === 'output-denied';
                          const isRunning = !['output-available', 'output-error', 'output-denied', 'approval-responded', 'approval-requested'].includes(toolPart.state as string);
                          // output-error 时 errorText 为必填字段；这里取出来供卡片内联展示
                          const errorText = isError ? (toolPart as { errorText?: string }).errorText : undefined;

                          // 格式化工具输出用于预览面板
                          const formatToolOutput = (): { content: string; language?: string; title: string; needFetch?: boolean; structured?: string; input?: string } | null => {
                            if (!isComplete || !toolPart.output) return null;
                            const out = toolPart.output as Record<string, unknown>;
                            // 动态工具使用 toolName 字段，静态工具从 type 推导
                            const toolName = isDynamicTool
                              ? ((part as DynamicToolUIPart).toolName ?? 'tool')
                              : toolPart.type.replace('tool-', '');

                            // write_file 工具：需要从 API 加载最新内容
                            if (toolName === 'write_file') {
                              return {
                                content: '', // 内容稍后通过 API 加载
                                language: out.language as string | undefined,
                                title: (out.path as string) ?? 'file',
                                needFetch: true,
                              };
                            }
                            // read_file 工具：工具已返回内容，清理代码围栏、行号和截断提示
                            if (toolName === 'read_file') {
                              let content = (out.content as string) ?? '';
                              // 先去掉截断提示行（在代码围栏外面）
                              const lines = content.split('\n');
                              const cleanedLines = lines
                                .filter((line: string) => !/^\[Showing lines|^\[Use offset|^\[.*more lines in file|^\[Note:/.test(line.trim()));
                              content = cleanedLines.join('\n');
                              // 去掉 markdown 代码围栏（```language ... ```）
                              const fenceMatch = content.match(/^```\w*\n([\s\S]*?)\n```$/);
                              if (fenceMatch) {
                                content = fenceMatch[1];
                              }
                              // 去掉行号前缀（如 "1: ", "2: "）
                              content = content
                                .split('\n')
                                .map((line: string) => line.replace(/^\d+:\s/, ''))
                                .join('\n');
                              return {
                                content,
                                language: out.language as string | undefined,
                                title: (out.path as string) ?? 'file',
                              };
                            }
                            // edit_file：返回 diff 内容
                            if (toolName === 'edit_file') {
                              return {
                                content: (out.diff as string) ?? JSON.stringify(out, null, 2),
                                language: 'diff',
                                title: (out.path as string) ?? 'file',
                              };
                            }
                            // bash 工具：格式化输出
                            if (toolName === 'bash') {
                              const command = (out.command as string) ?? '';
                              const stdout = (out.stdout as string) ?? '';
                              const stderr = (out.stderr as string) ?? '';
                              const exitCode = out.exitCode as number | undefined;
                              const parts: string[] = [];
                              if (command) parts.push(`$ ${command}`);
                              if (stdout) parts.push(stdout);
                              if (stderr) parts.push(`STDERR:\n${stderr}`);
                              if (exitCode !== undefined) parts.push(`Exit code: ${exitCode}`);
                              return { content: parts.join('\n\n'), title: 'bash' };
                            }
                            // grep 工具：格式化搜索结果
                            if (toolName === 'grep') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                // 有 formattedOutput（带 context）直接使用
                                if (parsed.formattedOutput) {
                                  content = parsed.formattedOutput;
                                } else if (Array.isArray(parsed.matches)) {
                                  if (parsed.matches.length > 0) {
                                    // 按文件分组显示
                                    const byFile = new Map<string, Array<{ line: number; content: string }>>();
                                    for (const m of parsed.matches) {
                                      const file = m.file ?? 'unknown';
                                      if (!byFile.has(file)) byFile.set(file, []);
                                      byFile.get(file)!.push({ line: m.line, content: m.content });
                                    }
                                    const parts: string[] = [];
                                    for (const [file, matches] of byFile) {
                                      parts.push(`--- ${file} ---`);
                                      for (const m of matches) {
                                        parts.push(`${m.line}: ${m.content}`);
                                      }
                                      parts.push('');
                                    }
                                    content = parts.join('\n').trim();
                                  } else {
                                    // 空结果
                                    const pattern = parsed.pattern ?? '';
                                    content = pattern ? `No matches found for "${pattern}"` : 'No matches found';
                                    if (parsed.searchPath) content += `\nSearch path: ${parsed.searchPath}`;
                                  }
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'grep' };
                            }
                            // glob 工具：格式化文件列表
                            if (toolName === 'glob') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                if (Array.isArray(parsed.files)) {
                                  const lines: string[] = [];
                                  if (parsed.pattern) lines.push(`Pattern: ${parsed.pattern}`);
                                  if (parsed.searchDir) lines.push(`Search: ${parsed.searchDir}`);
                                  if (lines.length > 0) lines.push('');
                                  for (const f of parsed.files) {
                                    lines.push(f);
                                  }
                                  if (parsed.truncated) {
                                    lines.push('');
                                    lines.push(`... and ${parsed.totalCount - parsed.count} more files`);
                                  }
                                  content = lines.join('\n');
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'glob' };
                            }
                            // skill 工具：使用已格式化的技能输出
                            if (toolName === 'skill') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                // _skillOutput 是格式化好的技能内容
                                if (parsed._skillOutput) {
                                  content = parsed._skillOutput;
                                } else if (!parsed.success && parsed.error) {
                                  content = `Error: ${parsed.error}`;
                                } else if (parsed.skillName) {
                                  content = `Skill: ${parsed.skillName}`;
                                  if (parsed.allowedTools?.length) content += `\nTools: ${parsed.allowedTools.join(', ')}`;
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'skill' };
                            }
                            // web_fetch 工具：格式化网页抓取结果
                            if (toolName === 'web_fetch') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                const parts: string[] = [];
                                if (parsed.url) parts.push(`URL: ${parsed.url}`);
                                if (parsed.title) parts.push(`Title: ${parsed.title}`);
                                if (!parsed.success && parsed.error) {
                                  parts.push(`Error: ${parsed.error}`);
                                } else if (parsed.content) {
                                  parts.push('');
                                  parts.push(parsed.content);
                                  if (parsed.truncated) parts.push(`\n[Truncated from ${parsed.originalLength} chars]`);
                                }
                                content = parts.join('\n');
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'web_fetch' };
                            }
                            // save_wiki 工具：格式化知识库保存结果
                            if (toolName === 'save_wiki') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                const parts: string[] = [];
                                if (parsed.results && Array.isArray(parsed.results)) {
                                  for (const r of parsed.results) {
                                    const icon = r.success ? '✓' : '✗';
                                    parts.push(`${icon} [${r.action}] ${r.name}${r.error ? ` — ${r.error}` : ''}`);
                                  }
                                  parts.push('');
                                  parts.push(`Saved: ${parsed.saved ?? 0}  Skipped: ${parsed.skipped ?? 0}  Failed: ${parsed.failed ?? 0}`);
                                } else if (parsed.message) {
                                  parts.push(parsed.message);
                                }
                                content = parts.join('\n');
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'wiki' };
                            }
                            // read_wiki_page 工具：格式化为 markdown，走面板的 markdown 预览
                            if (toolName === 'read_wiki_page') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                if (!parsed.found) {
                                  content = parsed.message || 'Page not found';
                                } else {
                                  const parts: string[] = [];
                                  parts.push(`# ${parsed.name ?? ''}`);
                                  const meta: string[] = [];
                                  if (parsed.category) meta.push(`**${parsed.category}**`);
                                  if (parsed.description) meta.push(parsed.description);
                                  if (meta.length > 0) parts.push(`> ${meta.join(' · ')}`);
                                  if (parsed.content) {
                                    parts.push('');
                                    parts.push(parsed.content);
                                  }
                                  content = parts.join('\n');
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, language: 'markdown', title: 'wiki' };
                            }
                            // lint_wiki 工具：格式化知识库健康检查结果
                            if (toolName === 'lint_wiki') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                const parts: string[] = [];
                                if (parsed.error) {
                                  parts.push(`Error: ${parsed.error}`);
                                } else {
                                  parts.push(`Checked ${parsed.checked ?? 0} page(s)  Issues: ${parsed.totalIssues ?? 0}  Auto-fixed: ${parsed.autoFixed ?? 0}${parsed.semanticChecked ? `  Semantic: ${parsed.semanticIssueCount ?? 0}` : ''}`);
                                  if (Array.isArray(parsed.issues) && parsed.issues.length > 0) {
                                    parts.push('');
                                    for (const issue of parsed.issues) {
                                      parts.push(`[${issue.severity}] ${issue.type} — ${issue.pages?.join(', ') ?? ''}`);
                                      parts.push(`  ${issue.description}`);
                                      if (issue.suggestion) parts.push(`  → ${issue.suggestion}`);
                                    }
                                  }
                                  if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
                                    parts.push('');
                                    parts.push(`Pages (${parsed.pages.length}):`);
                                    for (const p of parsed.pages) {
                                      parts.push(`  ${p.name}${p.category ? ` [${p.category}]` : ''}${p.updated ? ` — ${p.updated}` : ''}`);
                                    }
                                  }
                                }
                                content = parts.join('\n');
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'wiki' };
                            }
                            // ingest_wiki_source 工具：格式化来源登记结果
                            if (toolName === 'ingest_wiki_source') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                const parts: string[] = [];
                                if (parsed.source) {
                                  const s = parsed.source;
                                  parts.push(`Source: ${s.title ?? s.value ?? ''}${s.type ? ` (${s.type})` : ''}`);
                                  if (s.value && s.title) parts.push(`  ${s.value}`);
                                  parts.push(`  ${parsed.sourceCreated ? 'Registered' : 'Already registered'}${parsed.snapshotCreated ? ', snapshot saved' : ''}`);
                                }
                                const wiki = parsed.wiki;
                                if (wiki?.results && Array.isArray(wiki.results) && wiki.results.length > 0) {
                                  parts.push('');
                                  for (const r of wiki.results) {
                                    const icon = r.success ? '✓' : '✗';
                                    parts.push(`${icon} [${r.action}] ${r.name}${r.error ? ` — ${r.error}` : ''}`);
                                  }
                                  parts.push('');
                                  parts.push(`Saved: ${wiki.saved ?? 0}  Skipped: ${wiki.skipped ?? 0}  Failed: ${wiki.failed ?? 0}`);
                                } else if (wiki) {
                                  parts.push('');
                                  parts.push('No page changes');
                                }
                                content = parts.join('\n');
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'wiki' };
                            }
                            // inspect_wiki_history 工具：格式化修订历史查询结果
                            if (toolName === 'inspect_wiki_history') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                if (Array.isArray(parsed.revisions)) {
                                  // list_revisions
                                  const parts: string[] = [];
                                  for (const r of parsed.revisions) {
                                    parts.push(`${r.id}  [${r.operation}]  ${r.createdAt}${r.reason ? ` — ${r.reason}` : ''}`);
                                  }
                                  content = parts.length > 0 ? parts.join('\n') : 'No revisions';
                                } else if (parsed.record && typeof parsed.raw === 'string') {
                                  // read_revision snapshot
                                  const r = parsed.record;
                                  content = [`Revision: ${r.id}  [${r.operation}]  ${r.createdAt}`, '', parsed.raw].join('\n');
                                } else if (typeof parsed.unifiedDiff === 'string') {
                                  // diff
                                  return {
                                    content: parsed.changed ? parsed.unifiedDiff : 'No changes between revisions',
                                    language: parsed.changed ? 'diff' : undefined,
                                    title: 'wiki',
                                  };
                                } else if (Array.isArray(parsed.pages)) {
                                  // source_pages
                                  content = parsed.pages.length > 0
                                    ? parsed.pages.map((p: { name?: string; filename?: string } | string) =>
                                        typeof p === 'string' ? p : (p.name ?? p.filename ?? '')).join('\n')
                                    : 'No pages for this source';
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'wiki' };
                            }
                            // restore_wiki_revision 工具：格式化恢复结果
                            if (toolName === 'restore_wiki_revision') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                if (parsed.restored) {
                                  content = [
                                    `✓ Restored ${parsed.filename}`,
                                    `  From revision: ${parsed.restoredFromRevisionId}`,
                                    `  New revision: ${parsed.revisionId}`,
                                  ].join('\n');
                                }
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'wiki' };
                            }
                            // cron 工具：格式化定时任务结果
                            if (toolName === 'cron') {
                              let content = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                              try {
                                const parsed = JSON.parse(content);
                                const parts: string[] = [];
                                if (parsed.error) {
                                  parts.push(`Error: ${parsed.error}`);
                                } else if (parsed.jobs && Array.isArray(parsed.jobs)) {
                                  // 任务列表
                                  for (const job of parsed.jobs) {
                                    const status = job.enabled ? '●' : '○';
                                    parts.push(`${status} ${job.name}`);
                                    parts.push(`  Schedule: ${job.schedule}`);
                                    if (job.prompt) parts.push(`  Prompt: ${job.prompt}`);
                                    parts.push('');
                                  }
                                  parts.push(`Total: ${parsed.total ?? parsed.jobs.length} job(s)`);
                                } else if (parsed.job) {
                                  // 单个任务详情
                                  const j = parsed.job;
                                  parts.push(`Name: ${j.name}  [${j.enabled ? 'enabled' : 'disabled'}]`);
                                  parts.push(`Schedule: ${j.schedule}`);
                                  if (j.prompt) parts.push(`Prompt: ${j.prompt}`);
                                  if (parsed.recentExecutions?.length > 0) {
                                    parts.push('');
                                    parts.push('Recent executions:');
                                    for (const e of parsed.recentExecutions) {
                                      const icon = e.status === 'success' ? '✓' : '✗';
                                      parts.push(`  ${icon} ${e.triggeredAt}${e.duration ? ` (${e.duration})` : ''}${e.error ? ` — ${e.error}` : ''}`);
                                    }
                                  }
                                } else if (parsed.message) {
                                  parts.push(parsed.message);
                                }
                                content = parts.join('\n');
                              } catch {
                                // 解析失败，保持原样
                              }
                              return { content, title: 'cron' };
                            }
                            // MCP 工具：输出是 CallToolResult { content:[{type:'text',text}], isError, structuredContent }
                            // 正文取 content[].text；structuredContent 作次要 JSON 视图。点击内联展开（不走右侧面板）
                            if (toolName.startsWith('mcp__')) {
                              const result = out as { content?: unknown[]; structuredContent?: unknown };
                              const texts: string[] = [];
                              if (Array.isArray(result.content)) {
                                for (const p of result.content) {
                                  const part = p as { type?: string; text?: string } | null;
                                  if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
                                    texts.push(part.text);
                                  }
                                }
                              }
                              const structured =
                                result.structuredContent && typeof result.structuredContent === 'object'
                                  ? JSON.stringify(result.structuredContent, null, 2)
                                  : undefined;
                              return {
                                content: texts.length > 0 ? texts.join('\n') : JSON.stringify(out, null, 2),
                                structured,
                                // mcp__server__tool → server:tool
                                title: toolName.split('__').slice(1).join(':'),
                                // 入参：点开仍能回看这次调了哪些参数
                                input:
                                  toolPart.input && typeof toolPart.input === 'object'
                                    ? JSON.stringify(toolPart.input, null, 2)
                                    : undefined,
                              };
                            }
                            // ask_user_question 是客户端工具，答案已内联显示，无需右侧面板预览
                            if (toolName === 'ask_user_question') {
                              return null;
                            }
                            // 其他工具：JSON 输出
                            return {
                              content: JSON.stringify(out, null, 2),
                              language: 'json',
                              title: toolName,
                            };
                          };

                          const previewData = formatToolOutput();
                          const toolKey = `${message.id}-${index}`;
                          const isPreviewed = previewedToolKey === toolKey;

                          // write_file 流式输入期间：展示尾部内容预览卡
                          //（input 由 AI SDK parsePartialJson 增量解析，content 会逐步增长）
                          const streamingWriteInput =
                            toolPart.type === 'tool-write_file' && toolPart.state === 'input-streaming'
                              ? (toolPart.input as { filePath?: string; content?: string } | undefined)
                              : undefined;

                          // bash 执行期间：查找同 toolCallId 的直播帧（服务端节流推送，同 id 替换式合并）
                          // 注意不能用 isRunning：审批通过后执行期间状态是 approval-responded（被 isRunning 排除）
                          const bashExecuting =
                            toolPart.state === 'input-available' ||
                            (toolPart.state === 'approval-responded' &&
                              (toolPart as unknown as { approval?: { approved?: boolean } }).approval?.approved !== false);
                          const bashStreamPart =
                            toolPart.type === 'tool-bash' && bashExecuting && toolCallId
                              ? (message.parts as SubDataPart[]).find(
                                  (p) => p.type === 'data-bash-output' && p.id === toolCallId,
                                )
                              : undefined;

                          // 子 Agent 工具（agent / parallel_agent）：渲染过程卡片
                          //（自动展开实时步骤 + 流式文本，结束后收起为摘要行）
                          if (isSubAgent && toolCallId) {
                            return (
                              <Fragment key={toolKey}>
                                {mcpAppSlot}
                                <SubAgentCard parts={subParts} toolCallId={toolCallId} />
                              </Fragment>
                            );
                          }

                          // bash 终端卡 + 报告类工具报告卡:点击内联展开(不走右侧文件预览面板)
                          // 文件类(write/read/edit_file/read_wiki_page)与 web_fetch 仍走右侧面板
                          const isBashTool = toolPart.type === 'tool-bash';
                          const reportToolName = isDynamicTool
                            ? ((part as DynamicToolUIPart).toolName ?? 'tool')
                            : toolPart.type.replace('tool-', '');
                          // inspect_wiki_history 的 diff 子分支仍走面板(保留 diff 高亮)
                          // MCP 工具(mcp__* 动态工具)输出同为"摘要/报告"性质,统一内联展开
                          const isInlineReportTool =
                            isComplete &&
                            (INLINE_REPORT_TOOLS.has(reportToolName) || reportToolName.startsWith('mcp__')) &&
                            previewData?.language !== 'diff';
                          const isInlineTool = isBashTool || isInlineReportTool;
                          const isInlineExpanded = isInlineTool && expandedInlineKeys.has(toolKey);
                          const isExpandedView = isInlineTool ? isInlineExpanded : isPreviewed;

                          return (
                            <Fragment key={toolKey}>
                            {mcpAppSlot}
                            <div
                              className={`flex w-full items-center gap-2 text-sm transition-colors ${
                                isComplete && (previewData || isInlineTool)
                                  ? `cursor-pointer ${isExpandedView ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`
                                  : 'text-muted-foreground'
                              }`}
                              onClick={isComplete && (previewData || isInlineTool) ? async () => {
                                if (isInlineTool) {
                                  setExpandedInlineKeys(prev => {
                                    const next = new Set(prev);
                                    if (next.has(toolKey)) next.delete(toolKey);
                                    else next.add(toolKey);
                                    return next;
                                  });
                                  return;
                                }
                                if (!previewData) return;
                                setPreviewedToolKey(toolKey);

                                // 如果需要从 API 获取内容（write/read 工具）
                                if (previewData.needFetch) {
                                  // 先显示空内容和文件路径
                                  setPreviewFile({
                                    path: previewData.title,
                                    content: '',
                                    language: previewData.language,
                                  });
                                  try {
                                    const res = await fetch(`/api/fs?action=read&path=${encodeURIComponent(previewData.title)}`);
                                    if (res.ok) {
                                      const data = await res.json();
                                      // 去掉行号前缀
                                      const cleanContent = (data.content ?? '')
                                        .split('\n')
                                        .map((line: string) => line.replace(/^\d+:\s/, ''))
                                        .join('\n');
                                      setPreviewFile(prev => prev ? { ...prev, content: cleanContent } : null);
                                    }
                                  } catch {
                                    // 加载失败时保持空内容
                                  }
                                } else {
                                  setPreviewFile({
                                    path: previewData.title,
                                    content: previewData.content,
                                    language: previewData.language,
                                  });
                                }
                              } : undefined}
                            >
                              {isComplete ? (
                                <ToolIcon className="size-4 shrink-0" />
                              ) : isError ? (
                                <XIcon className="size-4 shrink-0 text-red-500" />
                              ) : isDenied ? (
                                <XIcon className="size-4 shrink-0 text-orange-500" />
                              ) : (
                                <Loader2Icon className="size-4 shrink-0 animate-spin text-blue-500" />
                              )}
                              {isRunning ? (
                                <Shimmer className="text-sm" duration={1.5} spread={1}>{toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')}</Shimmer>
                              ) : (
                                <span className={`truncate ${isError ? 'text-red-600' : isDenied ? 'text-orange-600' : ''}`}>
                                  {toolTitle ?? toolPart.type.replace('tool-', '').replace(/_/g, ' ')}
                                </span>
                              )}
                              {isDenied && <span className="text-xs text-orange-500 ml-auto">(已拒绝)</span>}
                              {isComplete && (previewData || isInlineReportTool) && (
                                <ChevronDownIcon className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpandedView ? 'rotate-180' : 'rotate-0'}`} />
                              )}
                            </div>
                            {streamingWriteInput?.content !== undefined && (
                              <WriteFileStreamingCard
                                filePath={streamingWriteInput.filePath}
                                content={streamingWriteInput.content}
                              />
                            )}
                            {bashStreamPart?.data && (
                              <BashStreamingCard
                                command={(toolPart.input as { command?: string } | undefined)?.command}
                                tail={String(bashStreamPart.data.tail ?? '')}
                                bytes={Number(bashStreamPart.data.bytes ?? 0)}
                                elapsedMs={Number(bashStreamPart.data.elapsedMs ?? 0)}
                              />
                            )}
                            {isError && errorText && (
                              <div className="ml-6 mt-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded px-2 py-1 break-words">
                                {errorText}
                              </div>
                            )}
                            {isComplete && reportToolName === 'ask_user_question' && isInlineExpanded && (() => {
                              const out = toolPart.output as { answers?: Array<{ question: string; answer: string | string[] }> } | undefined;
                              if (!out?.answers?.length) return null;
                              return (
                                <div className="ml-6 mt-1 space-y-1">
                                  {out.answers.map((qa, i) => (
                                    <div key={i} className="text-xs text-muted-foreground">
                                      <span className="font-medium text-foreground">Q: {qa.question}</span>
                                      <br />
                                      <span className="text-green-600 dark:text-green-400">A: {Array.isArray(qa.answer) ? qa.answer.join(', ') : qa.answer}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                            {isBashTool && isInlineExpanded && isComplete && (() => {
                              const out = toolPart.output as { command?: string; stdout?: string; stderr?: string; exitCode?: number } | undefined;
                              return (
                                <BashOutputCard
                                  command={out?.command}
                                  stdout={out?.stdout ?? ''}
                                  stderr={out?.stderr ?? ''}
                                  exitCode={out?.exitCode}
                                />
                              );
                            })()}
                            {isInlineReportTool && isInlineExpanded && previewData && (
                              <ToolReportCard
                                label={previewData.title}
                                content={previewData.content}
                                input={previewData.input}
                                structured={previewData.structured}
                              />
                            )}
                            </Fragment>
                          );
                        }

                        return null;
                      })}
                      {/* 压缩状态行（工具调用风格）：从输入框水位环迁出，仅在最后一条 assistant 消息内显示。
                          start=压缩中(转圈+shimmer), end=短暂显示"已压缩 N tokens"后自动消失。 */}
                      {message.role === 'assistant' &&
                        messageIndex === messages.length - 1 &&
                        compactionUi && (
                        <div className="flex w-full items-center gap-2 text-sm text-muted-foreground">
                          {compactionUi.status === 'compacting' ? (
                            <>
                              <Loader2Icon className="size-4 shrink-0 animate-spin text-blue-500" />
                              <Shimmer className="text-sm" duration={1.5} spread={1}>
                                Compress: 上下文压缩中
                              </Shimmer>
                            </>
                          ) : (
                            <>
                              <CheckCircleIcon className="size-4 shrink-0 text-green-500" />
                              <span className="truncate">
                                Compress: 已压缩
                                {compactionUi.tokensFreed
                                  ? ` · 释放 ${compactionUi.tokensFreed >= 1000 ? `${(compactionUi.tokensFreed / 1000).toFixed(1)}K` : `${compactionUi.tokensFreed}`} tokens`
                                  : ''}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                      {/* 产出文件汇总卡:一轮结束后聚合本消息内 write/edit 的成功产出 */}
                      {message.role === 'assistant' &&
                        !(messageIndex === messages.length - 1 && (status === 'streaming' || status === 'submitted')) && (
                          <FileOutputsSummary
                            entries={collectFileOutputs(message.parts as Array<{ type: string; state?: string; output?: unknown }>)}
                            onOpen={async (entry: { path: string; language?: string }) => {
                              setPreviewFile({ path: entry.path, content: '', language: entry.language });
                              try {
                                const res = await fetch(`/api/fs?action=read&path=${encodeURIComponent(entry.path)}`);
                                if (res.ok) {
                                  const data = await res.json();
                                  const cleanContent = (data.content ?? '')
                                    .split('\n')
                                    .map((line: string) => line.replace(/^\d+:\s/, ''))
                                    .join('\n');
                                  setPreviewFile(prev => prev ? { ...prev, content: cleanContent } : null);
                                }
                              } catch {
                                // 加载失败时保持空内容
                              }
                            }}
                          />
                        )}
                    </MessageContent>
                    )}
                    {message.role === 'user' && !isEditing && status !== 'streaming' && status !== 'submitted' && (
                      <MessageToolbar className="mt-0! opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <MessageActions>
                          <InlineBranchSelector
                            branches={branchesByForkPoint.get(message.id) ?? []}
                            currentBranchId={activeBranchId}
                            switching={branchSwitching}
                            onSwitch={handleFormalBranchSwitch}
                          />
                          {messages.slice(messageIndex + 1).every((m) => m.role !== 'user') && (
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
                          )}
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
                          <InlineBranchSelector
                            branches={branchesByForkPoint.get(message.id) ?? []}
                            currentBranchId={activeBranchId}
                            switching={branchSwitching}
                            onSwitch={handleFormalBranchSwitch}
                          />
                          <MessageAction
                            label="Regenerate"
                            onClick={() => handleRegenerate(message.id)}
                            tooltip="Regenerate response"
                          >
                            <RefreshCcwIcon className="size-4" />
                          </MessageAction>
                          {messageIndex < messages.length - 1 && (
                            <MessageAction
                              label="Branch"
                              onClick={() => void handleFork(message.id)}
                              tooltip="从这里切出新分支（保留之前的所有上下文）"
                            >
                              <GitBranchIcon className="size-4" />
                            </MessageAction>
                          )}
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
                </div>
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
            {conversationId && !questionPanel && !planPanel && approvalRequests.length === 0 && (
              <TodoPanel conversationId={conversationId} streamData={streamTodoData} />
            )}

            {questionPanel && (
              <UserQuestionPanel
                isOpen={questionPanel.isOpen}
                questions={questionPanel.questions}
                onComplete={handleQuestionsComplete}
                onCancel={handleQuestionsCancel}
              />
            )}

            {planPanel && (
              <PlanReviewPanel
                isOpen={true}
                plan={planPanel}
                onApprove={handlePlanApprove}
                onReject={handlePlanReject}
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

            {!questionPanel && !planPanel && approvalRequests.length === 0 && doctorOpen && (
              <DoctorReportPanel
                report={doctorReport}
                loading={doctorLoading}
                error={doctorError}
                onClose={() => setDoctorOpen(false)}
                onRepair={handleDoctorRepair}
              />
            )}

            {!questionPanel && !planPanel && approvalRequests.length === 0 && inputCard}
          </div>
        </div>
      )}
      </div>
      {branchPanelOpen && !previewFile && (
        <ConversationRoutePanel
          tree={conversationTree}
          branches={branchSummaries}
          switching={branchSwitching}
          error={branchActionError}
          onClose={() => { setBranchPanelOpen(false); setBranchActionError(null); }}
          onSelectBranch={handleFormalBranchSwitch}
          onManage={handleBranchManage}
        />
      )}
      {/* 右侧：文件预览分栏 */}
      {previewFile && (
        <FilePreviewPanel
          open={!!previewFile}
          onOpenChange={(open: boolean) => { if (!open) { setPreviewFile(null); setPreviewedToolKey(null); } }}
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

/** 上下文占用柱状图条目 */
function ContextBarItem({ label, value, total, color, dotColor }: {
  label: string;
  value: number;
  total: number;
  color: string;
  dotColor: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  const formatted = value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="text-xs text-muted-foreground flex-1 truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">
          {formatted}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50 w-7 text-right">
          {percentage.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}