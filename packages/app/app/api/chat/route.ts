import { nanoid } from 'nanoid';
import { getServerRuntime, getServerContext, getProjectContext, getModelConfig } from '@/lib/runtime';
import { agentStreamOnError } from '@/lib/agent-stream-on-error';
import { convertFileToText } from '@/lib/file-convert';
import { getStreamManager, registerAbortController, unregisterAbortController, abortChat } from '@/lib/stream-manager';
import {
  createAgent,
  finalizeAgentRun,
  handleReactiveRetry,
  isContextLengthError,
  applyCheckpointOnLoad,
  fingerprintMessage,
  sanitizeToolErrorInputs,
  isOutputTruncated,
  finalizeRun,
  startConversationRun,
  commitAssistantMessages,
  endConversationRun,
  indexActiveTodos,
  renderIndexedActiveLine,
  renderIndexedActiveList,
  type SubAgentStreamWriter,
  type Todo,
} from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';
import { safeBuildContextBudgetPayload } from './context-payload';

export const runtime = 'nodejs';

// GET: Load messages for a conversation
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const rt = await getServerRuntime();
    const messages = rt.dataStore.messageStore.getMessagesByConversation(conversationId);
    // 分支元信息：活跃路径上每个多版本位置的兄弟列表 + head 分叉时的前进入口
    const { branches, headChildId } = rt.dataStore.messageStore.getBranchInfo(conversationId);
    const projection = rt.dataStore.branchStore.getProjection(conversationId);
    return NextResponse.json({
      messages,
      branches,
      headChildId,
      revision: projection.revision,
      activeBranchId: projection.activeBranchId,
      branchSummaries: projection.branches,
    });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// POST: Stream chat response
export async function POST(request: Request) {
  try {
    const startTime = Date.now();
    const body = await request.json() as {
      message: UIMessage;
      conversationId: string;
      userId?: string;
      modelName?: string;
      agentType?: string;
      enableConnectors?: boolean;
      systemPrompt?: string;
      approvalMode?: string;
      trigger?: string; // 'submit-message' | 'regenerate-message'（来自 AI SDK transport）
      branchId?: string;
      expectedTipId?: string | null;
      operation?: 'append' | 'regenerate' | 'edit';
    };

    const { message, conversationId, userId: messageUserId, modelName, agentType, enableConnectors, systemPrompt, approvalMode, trigger, branchId, expectedTipId, operation } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    console.log(`[Chat API] POST start: conversationId=${conversationId} trigger=${trigger ?? 'submit-message'}`);

    const defaultContext = await getServerContext();
    console.log(`[Chat API] getServerContext done: ${Date.now() - startTime}ms`);

    const store = defaultContext.runtime.dataStore;
    const streamManager = getStreamManager();

    // Resolve project context: if conversation has a project_id, use cached project context
    let context = defaultContext;
    let conversation = store.conversationStore.getConversation(conversationId);

    // Ensure conversation exists (create if it's a new conversation)
    if (!conversation) {
      conversation = store.conversationStore.createConversation(conversationId);
      console.log(`[Chat API] Created new conversation: ${conversationId}`);
    }
    if (conversation?.projectId) {
      const project = store.projectStore.getProject(conversation.projectId);
      if (project) {
        context = await getProjectContext(conversation.projectId, project.path);
      }
    }

    const isFirstMessage = store.messageStore.getMessagesByConversation(conversationId).length === 0;

    // ── 本轮运行 id：abort 注册与写库守卫都按 runId 判定，
    //    旧运行迟到的 onEnd 因 runId 不匹配被拒绝写库 ──
    const runId = nanoid();

    // ── 单飞行：同会话已有运行 → 先中止（编辑/重新生成时这正是用户想要的）──
    abortChat(conversationId);

    // ── 请求消息落库（不可变消息树，见 message-store.ts）──
    // 普通发送提交 user 消息；工具审批后的自动续跑提交的是更新后的 assistant
    // 工具消息，必须按同一节点的下一不可变版本推进，不能走 user 编辑语义。
    // 客户端工具（ask_user_question）的 output-available/error 也是续跑。
    const isAssistantContinuation = message.role === 'assistant' && message.parts.some((part) => {
      if (!('state' in part)) return false;
      const state = part.state as string;
      return state === 'approval-responded' || state === 'output-available' || state === 'output-error';
    });
    if (message.role === 'assistant' && !isAssistantContinuation) {
      return NextResponse.json({ error: 'Invalid assistant continuation' }, { status: 400 });
    }

    const currentBranch = store.branchStore.ensureMainBranch(conversationId);
    let activeBranchId = branchId ?? currentBranch.id;
    let headMessageId: string;
    if (isAssistantContinuation) {
      headMessageId = store.messageStore.commitAssistantContinuation(conversationId, message);
    } else if (operation === 'edit') {
      // 编辑：原地修改，不创建分支。走 commitUserMessage 内部编辑路径
      // （同 id + 不同内容 → 同 parent 下插新节点，head 自动转移）
      headMessageId = store.messageStore.commitUserMessage(conversationId, message);
    } else if (branchId && operation === 'append') {
      const result = store.branchStore.executeCommand(conversationId, { type: 'append', branchId, message, expectedTipId: expectedTipId ?? null });
      activeBranchId = result.branchId;
      headMessageId = result.headMessageId!;
    } else {
      headMessageId = store.messageStore.commitUserMessage(conversationId, message);
    }
    const activeBranch = store.branchStore.getBranch(activeBranchId) ?? currentBranch;
    startConversationRun(store, {
      id: runId,
      conversationId,
      branchId: activeBranch.id,
      anchorMessageId: headMessageId,
      model: modelName ?? null,
      agentType: agentType ?? null,
    });

    // 模型输入基线 = 落库后的活跃路径（截断/编辑已由 head 移动体现）
    const activeMessages = store.messageStore.getMessagesByConversation(conversationId);

    // 续跑时把最后一条（刚 commit 的服务端新版本 id）还原为客户端消息 id：
    // SDK 的 start chunk 会带 originalMessages 末尾 assistant 的 id，
    // id 与客户端本地消息一致时续写才会合并进原消息，否则客户端把续写
    // 当成新消息追加 → UI 出现重复分段。落库仍用服务端 id（不可变树内唯一）。
    if (isAssistantContinuation && activeMessages.length > 0) {
      const last = activeMessages[activeMessages.length - 1];
      if (last.role === 'assistant') {
        activeMessages[activeMessages.length - 1] = { ...last, id: message.id };
      }
    }

    // 全量(含本次 user 消息)交给 applyCheckpointOnLoad:本次 user 消息落在锚点之后,
    // 作为 newerMessages 保留,避免"锚点之后无新消息 -> 返回全量"的 guard 误触发
    // 导致 checkpoint 不生效、旧大输出(如 read-loop 污染)原样进上下文。
    const checkpointResult = applyCheckpointOnLoad(activeMessages, conversationId, store);
    // Fix error-state tool parts whose rawInput (string) would be
    // double-serialized by the OpenAI-compatible provider, causing
    // HTTP 400 on providers like Ark / deepseek.
    const messages: UIMessage[] = sanitizeToolErrorInputs(checkpointResult.messages);

    // 检测未完成的 todo，让 Agent 感知到之前中断的任务
    const conversationTodos: Todo[] = store.todoStore.getTodosByConversation(conversationId);

    // 恢复上次被中断的任务为 in_progress：停止时 reset-conversation 把它重置为 pending
    // 并记 stopReason（todos/route.ts）。续做时恢复"正在执行"的状态信号，面板与模型
    // 都能看到——只恢复最近被中断的一条，保持"单一 in_progress"纪律。
    const interruptedTodo = conversationTodos
      .filter((t: Todo) => t.status === 'pending' && t.metadata?.stopReason)
      .sort((a: Todo, b: Todo) => b.updatedAt - a.updatedAt)[0];
    if (interruptedTodo) {
      store.todoStore.updateTodo({ id: interruptedTodo.id, status: 'in_progress' });
      interruptedTodo.status = 'in_progress'; // 让下方过滤与 note 反映恢复后的状态
    }

    // 权威任务台账：恢复/续做给模型一份确定性清单（实体台账，非对话词汇）。
    // 编号 = 快照内物化的 todo.number（创建时分配、永不复用）：indexActiveTodos
    // 必须传**全量** conversationTodos（含终态行）才能不重排，与 todo 工具 / overview
    // 完全一致，可跨界面引用。不再按标题重建/合并。
    const activeTodos = conversationTodos.filter(
      (t: Todo) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed'
    );
    const recentlyCompleted = conversationTodos
      .filter((t: Todo) => t.status === 'completed')
      .sort((a: Todo, b: Todo) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 3);

    // 活跃视图按物化编号展示（indexActiveTodos 读 todo.number，保证与 todo 工具一致）
    const indexedActive = indexActiveTodos(conversationTodos);

    let finalInstructions = systemPrompt;
    if (activeTodos.length > 0) {
      const authLines: string[] = [];
      authLines.push('## ✅ 任务台账（权威快照）');
      authLines.push('');
      authLines.push(
        '以下是当前任务的唯一权威来源。每项前的 [#N] 是创建时物化的稳定序号（永不复用）：更新用 todo 的 update 按编号引用（如 id: "#1"），不要发明编号、不要按标题重建已存在的任务。' +
        '新增任务用 todo 的 add（可一次建多行）；不再需要的任务用 update status= "cancelled" 或 delete 软取消。' +
        '只 patch 你引用的编号项；未提及的任务保持原样，不会被自动清除。'
      );
      authLines.push('');

      const markInterrupted = (idx: number, t: Todo): string =>
        interruptedTodo && t.id === interruptedTodo.id
          ? ' ⚠️ 上次执行中被中断，可能未完成：先检查产出是否完整，补全后再标 completed'
          : '';

      const inProgress = activeTodos.filter((t: Todo) => t.status === 'in_progress');
      const pending = activeTodos.filter((t: Todo) => t.status === 'pending');
      const failed = activeTodos.filter((t: Todo) => t.status === 'failed');

      if (inProgress.length > 0) {
        authLines.push('### 进行中');
        for (const t of inProgress) {
          const idx = indexedActive.find((e) => e.todo.id === t.id)?.index ?? -1;
          authLines.push(renderIndexedActiveLine(idx, t, store.todoStore) + markInterrupted(idx, t));
        }
        authLines.push('');
      }
      if (pending.length > 0) {
        const unblocked = pending.filter((t: Todo) => t.blockedBy.length === 0);
        const blocked = pending.filter((t: Todo) => t.blockedBy.length > 0);
        if (unblocked.length > 0) {
          authLines.push('### 待办');
          for (const t of unblocked) {
            const idx = indexedActive.find((e) => e.todo.id === t.id)?.index ?? -1;
            authLines.push(renderIndexedActiveLine(idx, t, store.todoStore));
          }
          authLines.push('');
        }
        if (blocked.length > 0) {
          authLines.push('### 待办（有依赖）');
          for (const t of blocked) {
            const idx = indexedActive.find((e) => e.todo.id === t.id)?.index ?? -1;
            authLines.push(renderIndexedActiveLine(idx, t, store.todoStore));
          }
          authLines.push('');
        }
      }
      if (failed.length > 0) {
        authLines.push('### 失败');
        for (const t of failed) {
          const idx = indexedActive.find((e) => e.todo.id === t.id)?.index ?? -1;
          authLines.push(renderIndexedActiveLine(idx, t, store.todoStore));
        }
        authLines.push('');
      }
      if (recentlyCompleted.length > 0) {
        authLines.push('### 最近完成');
        for (const t of recentlyCompleted) authLines.push(`- ✅ **${t.subject}**${t.metadata?.result ? `: ${t.metadata.result}` : ''}`);
        authLines.push('');
      }

      const authNote = '\n\n' + authLines.join('\n').trim();
      finalInstructions = systemPrompt ? systemPrompt + authNote : authNote;
    }

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null };
    // 子 Agent data-sub 事件缓冲：SDK 内层流（createAgentUIStream）不包含这些事件，
    // onEnd 保存的消息里没有它们；这里按 `${type}|${id}` 替换式缓冲（复刻 SDK 的
    // 同 type+同 id 合并语义，text-delta 只留最后一条），保存前合并进消息实现刷新后回看。
    const subEventBuffer = new Map<string, { type: string; id: string; data: unknown }>();
    // 压缩状态回调引用：流启动后设置 current，pipeline 每步压缩前后调用
    const compactionCallbackRef: { current: ((event: import('../../../../core/src/modules/agent-control').CompactionStatusEvent) => void) | null } = { current: null };
    const userId = messageUserId || 'default';

    console.log(`[Chat API] createAgent start: ${Date.now() - startTime}ms`);

    // 按用户所选模型读取凭据与上下文窗口(模型真名;旧别名值回落 defaultModel)
    const chatModelConfig = getModelConfig(modelName);
    const { agent, sessionState, mcpRegistry, ownedMcpRegistry, model, adjustedMessages, wikiBaseDir, tools } = await createAgent({
      context,
      conversationId,
      messages,
      userId,
      agentType,
      model: {
        apiKey: chatModelConfig.apiKey,
        baseURL: chatModelConfig.baseURL,
        modelName: chatModelConfig.modelName,
        models: chatModelConfig.models,
        includeUsage: true,
      },
      // 模型条目声明了 contextLimit 时跟随该模型的上下文窗口
      ...(chatModelConfig.contextLimit ? { session: { maxContextTokens: chatModelConfig.contextLimit } } : {}),
      modules: enableConnectors === false ? { connectors: false } : undefined,
      customInstructions: finalInstructions,
      approvalMode,
      writerRef,
      compactionCallbackRef,
      agentRunStore: store.agentRunStore,
      conversationMeta: {
        isNewConversation: isFirstMessage,
        conversationStartTime: conversation?.createdAt ? new Date(conversation.createdAt).getTime() : Date.now(),
        sessionSource: conversation?.source ?? 'user',
        sessionSourceId: conversation?.sourceId ?? undefined,
      },
    });

    console.log(`[Chat API] createAgent done: ${Date.now() - startTime}ms`);

    // ── 初始化 CompactionView（如果 checkpoint 应用成功）──
    if (checkpointResult.applied && checkpointResult.summaryMessage && checkpointResult.anchorIndex != null) {
      const anchorMsg = activeMessages[checkpointResult.anchorIndex];
      if (anchorMsg) {
        sessionState.compactionView.summary = {
          message: checkpointResult.summaryMessage as any, // UIMessage → ModelMessage
          anchorIndex: checkpointResult.anchorIndex,
          anchorFingerprint: fingerprintMessage(anchorMsg as any),
          summaryText: checkpointResult.summaryText!,
        };
        console.log(`[Checkpoint] View initialized: anchorIndex=${checkpointResult.anchorIndex}`);
      }
    }

    const messagesWithAttachments = adjustedMessages ?? messages;

    // Convert unsupported file types (e.g. docx, xlsx, pptx) to text for the LLM.
    // We create a new array so original messages (with file parts) are preserved for storage.
    const llmMessages: UIMessage[] = await Promise.all(
      messagesWithAttachments.map(async (msg) => {
        if (msg.role !== 'user' || !Array.isArray(msg.parts)) return msg;
        const newParts: typeof msg.parts = [];
        let changed = false;
        for (const part of msg.parts) {
          if (part.type === 'file') {
            const fp = part as { mediaType: string; url: string; filename?: string };
            const text = await convertFileToText(fp.url, fp.mediaType);
            if (text !== null) {
              const label = fp.filename ? `[文件: ${fp.filename}]\n\n` : '';
              newParts.push({ type: 'text', text: label + text } as (typeof msg.parts)[number]);
              changed = true;
              continue;
            }
          }
          newParts.push(part);
        }
        return changed ? { ...msg, parts: newParts } : msg;
      })
    );

    // Strip remaining multimodal parts (images, PDFs, etc.) that the LLM may not support.
    // After file-conversion, only image/PDF file parts survive; replace them with
    // text placeholders so text-only models (e.g. mimo-v2.5) don't 400.
    const finalMessages: UIMessage[] = llmMessages.map((msg) => {
      if (msg.role !== 'user' || !Array.isArray(msg.parts)) return msg;
      const strippedParts: typeof msg.parts = [];
      let changed = false;
      for (const part of msg.parts) {
        if (part.type === 'file') {
          const fp = part as { mediaType: string; filename?: string };
          const label = fp.filename || '未命名文件';
          strippedParts.push({
            type: 'text',
            text: `[附件: ${label} (${fp.mediaType})]`,
          } as (typeof msg.parts)[number]);
          changed = true;
        } else {
          strippedParts.push(part);
        }
      }
      return changed ? { ...msg, parts: strippedParts } : msg;
    });

    console.log(
      `[LLM Input] ${finalMessages.length} messages:\n` +
        finalMessages
          .map((m, i) => {
            const partSummaries = Array.isArray(m.parts) ? m.parts.map((p) => {
              if (p.type === 'text') return `text(${(p as { text: string }).text.slice(0, 40)})`;
              if (p.type === 'file') {
                const fp = p as { mediaType?: string; filename?: string; url?: string };
                return `file(${fp.mediaType}, ${fp.filename ?? 'unnamed'}, url:${fp.url ? fp.url.slice(0, 30) + '...' : 'none'})`;
              }
              return `[${p.type}]`;
            }) : ['<no-parts>'];
            return `  [${i}] ${m.role}: ${partSummaries.join(' | ')}`;
          })
          .join('\n'),
    );

    const abortController = new AbortController();
    registerAbortController(conversationId, abortController, runId);

    // onEnd 回调：流结束时把新 assistant 消息挂到本轮用户消息（headMessageId）之后。
    // appendMessages 的 head CAS 是写入权威：head 已被更新的运行移走时，
    // 本轮结果只是挂出一条孤儿分支，天然无害——无需依赖时序守卫。
    // 工厂形式：每次 createAgentUIStream 的输入消息数可能不同（context-length 重试会压缩消息），
    // 切片基准必须与实际传入的消息数一致，否则新增 assistant 消息会被切掉导致不保存。
    // ── 段执行结果（续写循环判定用）──
    type SegmentOutcome = {
      aborted: boolean;
      truncated: boolean;
      completedMessages: UIMessage[];
      lastAssistant: UIMessage | undefined;
      headMoved: boolean;
      /** 本段累计输出 tokens（各 step 的 usage.outputTokens 之和），续写预算判定用 */
      outputTokens: number;
    };

    // onEnd 回调：流结束时把新 assistant 消息挂到本轮消息（默认锚点）之后。
    // 手动续写语义（无自动续写循环，一段即止）：
    // - 截断（finishReason='length'）→ run 标记 failed(output_truncated) + 推 data-truncated，
    //   前端显示"继续"按钮，用户点继续 = 发一条"继续"消息 → 新的一轮回复（独立 assistant 消息）；
    // - 正常完成 → committed/superseded + finalize；
    // - 停止（isAborted）→ aborted（修复"停止后仍 committed"旧 bug）。
    const createOnEnd = (
      inputMessageCount: number,
      inputContinuation: UIMessage | undefined,
      outcome: SegmentOutcome,
      resolveDone: () => void,
      controller: ReadableStreamDefaultController<string>,
      defaultAnchorId: string,
    ) => async ({ messages: completedMessages, isAborted, finishReason }: {
      messages: UIMessage[];
      isAborted?: boolean;
      finishReason?: string;
    }) => {
      try {
        let resultAnchorId = defaultAnchorId;
        let continuationUpdated = false;
        if (inputContinuation) {
          const completedContinuation = completedMessages[inputMessageCount - 1];
          if (
            inputContinuation.role === 'assistant' &&
            completedContinuation?.role === 'assistant' &&
            JSON.stringify(inputContinuation.parts) !== JSON.stringify(completedContinuation.parts)
          ) {
            resultAnchorId = store.messageStore.commitAssistantContinuation(
              conversationId,
              completedContinuation,
            );
            continuationUpdated = true;
          }
        }

        const newAssistantMessages = completedMessages
          .slice(inputMessageCount)
          .filter((m) => m.role === 'assistant' && m.parts && m.parts.length > 0);

        // SDK 未传 messageId 时返回的 assistant 消息 id 为空串：appendMessages 会
        // 用 nanoid 兜底落库，但 outcome.lastAssistant.id 仍是 ""，续写段用它做锚点
        // 会因 `"" ?? getHead()` 不回落而把消息插成孤儿 → head CAS 失败 → superseded。
        // 先补上真实 id，保证落库 id 与 lastAssistant.id 一致。
        for (const m of newAssistantMessages) {
          if (!m.id) (m as { id: string }).id = nanoid();
        }

        if (newAssistantMessages.length === 0 && !continuationUpdated) {
          unregisterAbortController(conversationId, runId);
          // 统一收尾：即便没有产出 assistant 消息，也落下 agent_runs 终态 + 归位 todo。
          // 无输出是"完成但话没说出来"，沿用现 completeRun 语义 → forcedReason 'done'。
          try {
            await finalizeRun({
              dataStore: store,
              conversationId,
              sessionState,
              maxSteps: context.behavior?.maxStepsPerSession ?? 50,
              forcedReason: 'done',
            });
          } catch (e) {
            console.warn('[Chat API] finalizeRun (no assistant) error:', e);
          }
          endConversationRun(store, runId, { status: 'failed', error: 'No assistant messages produced' });
          console.warn(
            `[Chat API] Stream produced no valid assistant messages, skipping save.\n` +
            `  Conversation: ${conversationId}\n` +
            `  Messages sent to LLM: ${inputMessageCount}\n` +
            `  Message roles: ${completedMessages.map((m) => m.role).join(' → ')}`,
          );
          return;
        }

        // 合并缓冲的 data-sub 事件到包含对应工具 part 的 assistant 消息，
        // 使刷新加载后子 Agent 过程可回看。事件 id 形如
        // `${toolCallId}`、`${toolCallId}#${seq}`（步骤）或 `${toolCallId}-${i}[#seq]`（并行子任务），
        // 截断后缀得到宿主工具的 toolCallId。
        if (subEventBuffer.size > 0) {
          const findHost = (toolCallId: string): UIMessage | undefined =>
            newAssistantMessages.find((m) =>
              m.parts.some((p) => (p as { toolCallId?: string }).toolCallId === toolCallId),
            );
          let merged = 0;
          for (const event of subEventBuffer.values()) {
            const rootId = event.id.split('#')[0];
            // 先按完整 rootId 找（单 agent），再截去 `-index` 找（parallel 子任务）
            const host = findHost(rootId) ?? findHost(rootId.replace(/-\d+$/, ''));
            if (host) {
              (host.parts as unknown[]).push({ type: event.type, id: event.id, data: event.data });
              merged++;
            }
          }
          if (merged > 0) {
            console.log(`[Chat API] Merged ${merged}/${subEventBuffer.size} sub-agent data parts into messages`);
          }
        }

        // 普通 -> 本轮 user；审批续跑则锚定在已保存的工具 output 版本。
        // head 已移走时 commitAssistantMessages 的 CAS 会让迟到结果成为无害孤儿分支。
        const { headMoved, resultTipId } = commitAssistantMessages(
          store, conversationId, newAssistantMessages, resultAnchorId,
        );

        // 记录本段结果（手动续写：单段执行，无续写循环判定）
        outcome.completedMessages = completedMessages;
        outcome.lastAssistant = newAssistantMessages.at(-1);
        outcome.headMoved = headMoved;
        const aborted = isAborted || abortController.signal.aborted;
        const truncated = !aborted && isOutputTruncated(finishReason);
        outcome.aborted = aborted;
        outcome.truncated = truncated;

        // ── 终态收尾（统一收尾器）──
        // 每个退出路径（aborted / truncated / 正常 / 无输出）都经 finalizeRun 归位 agent_runs
        // 终态 + settle todo。agent_runs 的终态由此处唯一推导；conversation_runs 的结账
        // 统一走共享的 endConversationRun（派生终态见 run-conversation.ts）。
        unregisterAbortController(conversationId, runId);
        try {
          await finalizeRun({
            dataStore: store,
            conversationId,
            sessionState,
            maxSteps: context.behavior?.maxStepsPerSession ?? 50,
            truncated,
            forcedReason: aborted ? 'aborted' : undefined,
            pushTodoUpdate: (todos) => {
              controller.enqueue(JSON.stringify({
                type: 'data-todo-update',
                id: `todo-settle-${runId}`,
                data: { todos },
              }));
            },
          });
        } catch (e) {
          // 收尾失败不影响本轮主流程落库（guard 幂等 + settle 有内部 try/catch）
          console.warn('[Chat API] finalizeRun error:', e);
        }

        if (aborted) {
          endConversationRun(store, runId, {
            status: 'aborted',
            error: 'Output stream aborted by user',
          });
          return;
        }

        if (truncated) {
          // 输出被截断 → 不按"完成"收尾（复用 failed+error，零 schema 迁移）：
          // 半截答案不再进库当最终答案（静默截断事故的病根）。前端收到 data-truncated
          // 显示"继续"按钮，用户点继续 = 发一条"继续"消息，agent 作为新的一轮回复。
          endConversationRun(store, runId, {
            status: 'failed',
            error: 'output_truncated',
          });
          try {
            controller.enqueue(JSON.stringify({
              type: 'data-truncated',
              id: `trunc-${runId}`,
              data: { message: '输出被截断，已停在这里。点击"继续"从断点续写。' },
            }));
          } catch {
            // 不影响主流程
          }
          return;
        }

        endConversationRun(store, runId, { headMoved, resultTipId });
        console.log(
          `[Storage] Appended ${newAssistantMessages.length} assistant messages after ${resultAnchorId} (headMoved=${headMoved})`,
        );

        const costSummary = sessionState.costTracker.getSummary();
        console.log(
          `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
        );

        await finalizeAgentRun({
          dataStore: store,
          messages: [...store.messageStore.getMessagesByConversation(conversationId)],
          conversationId,
          costTracker: sessionState.costTracker,
          // 只清理 per-request registry；共享 registry 常驻，不逐轮断连
          mcpRegistry: ownedMcpRegistry ?? null,
          model,
          isNewConversation: isFirstMessage,
          userId,
          wikiBaseDir,
          commitConversationState: headMoved,
          checkpoint: {
            modelName: sessionState.model,
            fallbackModels: sessionState.fallbackModels,
          },
        });
      } catch (err) {
        endConversationRun(store, runId, {
          status: abortController.signal.aborted ? 'aborted' : 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        console.error('[Chat API] onFinish error:', err);
      } finally {
        resolveDone();
      }
    };

    // 创建可恢复流
    const resumableStream = await streamManager.createNewResumableStream(
      conversationId,
      () => {
        // 创建原始流：将 UIMessageChunk 对象序列化为 JSON 字符串，
        // 因为可恢复流按字符串缓冲/恢复，逐个 chunk 独立传输。
        const stream = new ReadableStream<string>({
          start: async (controller) => {
            try {
              // ── 段执行：创建 agent 流（含 context-length 压缩重试）→ 泵到 controller → 等 onEnd 落库 ──
              const runStreamSegment = async (
                segmentMessages: UIMessage[],
                inputContinuation: UIMessage | undefined,
                defaultAnchorId: string,
              ): Promise<SegmentOutcome & { controllerClosed: boolean }> => {
                let resolveDone!: () => void;
                const done = new Promise<void>((resolve) => { resolveDone = resolve; });
                const outcome: SegmentOutcome = {
                  aborted: false,
                  truncated: false,
                  completedMessages: [],
                  lastAssistant: undefined,
                  headMoved: false,
                  outputTokens: 0,
                };

                const pushContextUsage = (stepEvent: { usage?: import('ai').LanguageModelUsage }) => {
                  if (!stepEvent.usage) return;
                  outcome.outputTokens += stepEvent.usage.outputTokens ?? 0;
                  sessionState.tokenBudget.accumulate(stepEvent.usage);
                  const payload = safeBuildContextBudgetPayload({
                    lastEstimation: sessionState.lastEstimation,
                    compactionTracker: sessionState.compactionTracker,
                    costTracker: sessionState.costTracker,
                    source: 'live',
                  });
                  if (!payload) return;
                  try {
                    controller.enqueue(JSON.stringify({
                      type: 'data-context-usage',
                      id: 'ctx-on-step-end',
                      data: {
                        // === 新 schema（阶段 0/1 推送，UI 阶段 2 切）===
                        ...payload,
                        // === 旧字段（保留兼容，阶段 3 删除）===
                        // 注意：不在此处覆盖 messagesTokens/instructionsTokens/toolsTokens/
                        // outputReserve——payload 已带新 schema 正确值，同名定义会覆盖成
                        // undefined/占位，导致前端分段进度条缺段。
                        usagePercentage: payload.utilizationPercent,
                        totalTokens: payload.totalTokens,
                        modelLimit: payload.modelLimit,
                        sessionInputTokens: payload.sessionCost.inputTokens,
                        sessionOutputTokens: payload.sessionCost.outputTokens,
                        sessionCachedReadTokens: payload.sessionCost.cachedReadTokens,
                        lastCompactionFreedTokens: payload.compaction.totalFreed,
                        compactionActive: payload.compaction.compactionsCount > 0,
                        compactionTriggerWatermark: payload.compaction.triggerPercent * 100,
                      },
                    }));
                  } catch {
                    // 不影响主流程
                  }
                  try {
                    sessionState.updateContextBudget?.({
                      utilizationPercent: payload.utilizationPercent,
                      totalTokens: payload.totalTokens,
                      modelLimit: payload.modelLimit,
                      messagesTokens: undefined,
                      instructionsTokens: undefined,
                      toolsTokens: undefined,
                      outputReserve: undefined,
                      cachedReadTokens: payload.sessionCost.cachedReadTokens,
                      stepInputTokens: sessionState.tokenBudget.lastStepInputTokens,
                      lastCompactionFreedTokens: payload.compaction.totalFreed,
                      compactionActive: payload.compaction.compactionsCount > 0,
                      sessionInputTokens: payload.sessionCost.inputTokens,
                      sessionOutputTokens: payload.sessionCost.outputTokens,
                      sessionCostUsd: payload.sessionCost.totalCostUsd,
                    });
                  } catch {
                    // 不影响主流程
                  }
                };

                let agentStream;
                try {
                  agentStream = await createAgentUIStream({
                    agent,
                    uiMessages: segmentMessages,
                    abortSignal: abortController.signal,
                    sendReasoning: true,
                    onError: agentStreamOnError,
                    onEnd: createOnEnd(
                      segmentMessages.length,
                      inputContinuation,
                      outcome,
                      resolveDone,
                      controller,
                      defaultAnchorId,
                    ),
                    // onStepEnd 在 finish-step chunk 之前触发，直接入流
                    onStepEnd: pushContextUsage,
                  });
                } catch (streamErr) {
                  // context_length_error：压缩消息后重试
                  if (isContextLengthError(streamErr)) {
                    console.warn(`[Chat API] Context length error, attempting reactive retry for ${conversationId}`);
                    try {
                      const retryResult = await handleReactiveRetry(
                        streamErr,
                        segmentMessages as unknown as ModelMessage[],
                        undefined, // 使用默认 compaction config
                        {
                          model: model!,
                          modelName: chatModelConfig.modelName || '',
                          conversationId,
                          dataStore: store,
                          contextLimit: chatModelConfig.contextLimit,
                        },
                      );
                      console.log(`[Chat API] Reactive retry: compressed ${segmentMessages.length} → ${retryResult.messages.length} messages`);
                      agentStream = await createAgentUIStream({
                        agent,
                        uiMessages: retryResult.messages,
                        abortSignal: abortController.signal,
                        sendReasoning: true,
                        onError: agentStreamOnError,
                        onEnd: createOnEnd(
                          retryResult.messages.length,
                          inputContinuation,
                          outcome,
                          resolveDone,
                          controller,
                          defaultAnchorId,
                        ),
                        onStepEnd: pushContextUsage,
                      });
                    } catch (retryErr) {
                      console.error('[Chat API] Reactive retry failed:', retryErr);
                      resolveDone();
                      throw streamErr; // 重试也失败，抛出原始错误
                    }
                  } else {
                    resolveDone();
                    throw streamErr; // 非 context_length_error，直接抛出
                  }
                }

                // 读取代理流并序列化为 JSON 字符串后发送到控制器
                const reader = agentStream.getReader();
                let agentChunkCount = 0;
                // 用户 /stop 会先关闭 controller;后续 enqueue 抛 ERR_INVALID_STATE
                // 属预期竞态,标记后静默收尾,不能再走 controller.error(二次抛错)
                let controllerClosed = false;
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const serialized = JSON.stringify(value);
                    try {
                      controller.enqueue(serialized);
                    } catch (enqueueErr) {
                      if ((enqueueErr as { code?: string })?.code === 'ERR_INVALID_STATE') {
                        controllerClosed = true;
                        console.log(`[Chat API] Controller closed by stop after ${agentChunkCount} chunks, draining agent stream`);
                        break;
                      }
                      throw enqueueErr;
                    }
                    agentChunkCount++;

                    // 每步完成后推送任务清单
                    if (value.type === 'finish-step' && conversationId) {
                      try {
                        const todos = store.todoStore.getTodosByConversation(conversationId);
                        controller.enqueue(JSON.stringify({
                          type: 'data-todo-update',
                          id: `todo-step-${agentChunkCount}`,
                          data: { todos },
                        }));
                      } catch {
                        // 不影响主流程
                      }
                    }
                  }
                } catch (agentErr) {
                  console.error('[Chat API] Agent stream read error after', agentChunkCount, 'chunks:', agentErr);
                }

                // 等 onEnd 完成落库（finishReason 只在 onEnd 里可靠拿到）
                await done;
                return { ...outcome, controllerClosed };
              };

              // 设置压缩状态回调，将压缩开始/结束推送到前端（跨续写段全程生效）
              compactionCallbackRef.current = (compactionEvent) => {
                try {
                  controller.enqueue(JSON.stringify({
                    type: 'data-compaction-status',
                    id: `compaction-${compactionEvent.status}-${Date.now()}`,
                    data: compactionEvent,
                  }));
                } catch {
                  // 不影响主流程
                }
              };

              // ── 手动续写：一段即止 ──
              // 不再自动续写。截断时 onEnd 标记 output_truncated + 推 data-truncated，
              // 前端显示"继续"按钮；用户点继续 = 发一条"继续"消息 → 新的一轮回复。
              let segmentMessages = finalMessages;
              let inputContinuation: UIMessage | undefined = isAssistantContinuation ? finalMessages.at(-1) : undefined;
              let defaultAnchorId = headMessageId;
              let anyControllerClosed = false;

              // 每 5s 推一次 keep-alive ping，防止代理/负载均衡因空闲超时切断 SSE 连接
              const keepAliveTimer = setInterval(() => {
                try {
                  controller.enqueue(JSON.stringify({ type: 'data-ping', id: `ping-${Date.now()}`, data: {} }));
                } catch {
                  // controller 已关闭，忽略
                }
              }, 5_000);

              const outcome = await runStreamSegment(segmentMessages, inputContinuation, defaultAnchorId);
              anyControllerClosed = outcome.controllerClosed;

              clearInterval(keepAliveTimer);
              console.log(`[Chat API] Agent stream complete (truncated=${outcome.truncated})`);
              // 清理压缩状态回调
              compactionCallbackRef.current = null;
              if (!anyControllerClosed) {
                try {
                  controller.close();
                } catch {
                  // stop 竞态下可能刚被关闭,忽略
                }
              }
            } catch (error) {
              // 记录错误详情，便于排查
              const errStr = String(error);
              const isCtxErr = isContextLengthError(error);
              console.error(
                `[Chat API] Stream creation failed for ${conversationId}:\n` +
                `  Type: ${isCtxErr ? 'context_length_exceeded' : 'unknown'}\n` +
                `  Error: ${errStr.slice(0, 200)}\n` +
                `  Messages: ${finalMessages.length}`,
              );
              // 失败路径不会走 onEnd：必须在此收尾运行记录，
              // 否则 conversation_runs/agent_runs 永远停在 'running'（已观测到泄漏）。
              // 经统一收尾器，CONTEXT_BUDGET_EXCEEDED → exhausted(budget_exception)，
              // 其余异常 → failed(error)——两条路径都 settle todo + 落 agent_runs 终态。
              unregisterAbortController(conversationId, runId);
              const isBudgetException = errStr.startsWith('CONTEXT_BUDGET_EXCEEDED:');
              try {
                await finalizeRun({
                  dataStore: store,
                  conversationId,
                  sessionState,
                  maxSteps: context.behavior?.maxStepsPerSession ?? 50,
                  forcedReason: isBudgetException ? 'budget_exception' : 'error',
                  errorMessage: errStr.slice(0, 500),
                });
              } catch (e) {
                console.warn('[Chat API] finalizeRun (stream error) error:', e);
              }
              endConversationRun(store, runId, {
                status: abortController.signal.aborted ? 'aborted' : 'failed',
                error: errStr.slice(0, 500),
              });
              controller.error(error);
            }
          },
        });

        return stream;
      }
    );

    if (!resumableStream) {
      return NextResponse.json({ error: 'Failed to create stream' }, { status: 500 });
    }

    // 包装成 UI 消息流
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // 包装 writer：透传所有 chunk，同时替换式缓冲 data-sub 事件供 onEnd 持久化
        writerRef.current = {
          write: (chunk: Record<string, unknown>) => {
            const type = chunk.type;
            const id = chunk.id;
            if (typeof type === 'string' && type.startsWith('data-sub-') && typeof id === 'string') {
              subEventBuffer.set(`${type}|${id}`, { type, id, data: chunk.data });
            }
            (writer as unknown as SubAgentStreamWriter).write(chunk);
          },
        };

        // 读取可恢复流（JSON 字符串）并解析为 UIMessageChunk 后写入 UI 流
        const reader = resumableStream.getReader();
        let chunkCount = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            try {
              writer.write(JSON.parse(value));
              chunkCount++;
            } catch (parseErr) {
              console.error('[Chat API] Failed to parse stream chunk:', parseErr, 'raw:', value?.slice(0, 100));
            }
          }
        } catch (readErr) {
          console.error('[Chat API] Stream read error after', chunkCount, 'chunks:', readErr);
        }
        console.log('[Chat API] Stream complete, total chunks:', chunkCount);
      },
      onError: (err) => {
        console.error('[Chat API] UI stream error:', err);
        return String(err);
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        'X-Conversation-Id': conversationId,
        'X-Stream-Id': conversationId, // 使用 conversationId 作为 streamId
        'X-Accel-Buffering': 'no',     // 禁止 Nginx 缓冲 SSE 响应
      },
    });
  } catch (error) {
    console.error('[Chat API] POST error:', error);
    if (error instanceof Error && error.message.startsWith('CONTEXT_BUDGET_EXCEEDED:')) {
      return NextResponse.json({
        error: error.message.slice('CONTEXT_BUDGET_EXCEEDED: '.length),
        code: 'CONTEXT_BUDGET_EXCEEDED',
      }, { status: 413 });
    }
    return NextResponse.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}

