import path from 'path'
import { nanoid } from 'nanoid';
import { getServerRuntime, getServerContext, getProjectContext, getModelConfig } from '@/lib/runtime';
import { convertFileToText } from '@/lib/file-convert';
import { getStreamManager, registerAbortController, unregisterAbortController, abortChat } from '@/lib/stream-manager';
import {
  createAgent,
  generateConversationTitle,
  finalizeAgentRun,
  handleReactiveRetry,
  isContextLengthError,
  applyCheckpointOnLoad,
  fingerprintMessage,
  type SubAgentStreamWriter,
  type Todo,
} from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';

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
    return NextResponse.json({ messages, branches, headChildId });
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
    };

    const { message, conversationId, userId: messageUserId, modelName, agentType, enableConnectors, systemPrompt, approvalMode, trigger } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
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

    // ── 用户消息落库（不可变消息树，见 message-store.ts）──
    // 必须先落库：agent 运行中刷新/切页/停止时，恢复流只回放 assistant chunks，
    // GET 加载不到未保存的用户消息。
    // commitUserMessage 内部区分三种语义：
    //   新 id → 普通发送（head 下追加）；
    //   已知 id + 内容未变 → regenerate（head 移回该消息，旧回答成为孤儿分支）；
    //   已知 id + 内容变化 → 编辑重发（同 parent 插入新节点，旧版本保留）。
    const headMessageId = store.messageStore.commitUserMessage(conversationId, message);

    // 模型输入基线 = 落库后的活跃路径（截断/编辑已由 head 移动体现）
    const activeMessages = store.messageStore.getMessagesByConversation(conversationId);
    const existingMessages = activeMessages.slice(0, -1);

    // compaction checkpoint:有可用 checkpoint 时从锚点之后加载,否则回退全量。
    // 仅用于模型输入——落库路径是往树上追加节点,结构上不会触碰锚点前的历史。
    // (见 docs/context-compaction-analysis.md E)
    const checkpointResult = applyCheckpointOnLoad(existingMessages, conversationId, store);
    const historyForModel = checkpointResult.messages;
    const messages: UIMessage[] = [...historyForModel, activeMessages[activeMessages.length - 1]];

    // 检测未完成的 todo，让 Agent 感知到之前中断的任务
    const conversationTodos: Todo[] = store.todoStore.getTodosByConversation(conversationId);
    const unfinishedTodos = conversationTodos.filter(
      (t: Todo) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed'
    );

    let finalInstructions = systemPrompt;
    if (unfinishedTodos.length > 0) {
      const todoLines = unfinishedTodos.map((t: Todo) => {
        const parts = ['ID: ' + t.id, '\u72b6\u6001: ' + t.status];
        if (t.activeForm) parts.push('\u8fdb\u5ea6: ' + t.activeForm);
        if (t.status === 'failed') parts.push('\u4e0a\u6b21\u5931\u8d25');
        return '- **' + t.subject + '** (' + parts.join(', ') + ')';
      });
      const todoNote = '\n\n## \u672a\u5b8c\u6210\u4efb\u52a1\n\u4ee5\u4e0b\u662f\u4f60\u4e4b\u524d\u4e2d\u65ad\u540e\u7559\u4e0b\u7684\u672a\u5b8c\u6210\u4efb\u52a1\uff0c\u9700\u8981\u7ee7\u7eed\u5904\u7406\uff1a\n'
        + todoLines.join('\n')
        + '\n\n\u4f60\u53ef\u4ee5\u4f7f\u7528 todo_list \u67e5\u770b\u8be6\u7ec6\u4fe1\u606f\uff0c\u7136\u540e\u7ee7\u7eed\u6267\u884c\u3002';

      finalInstructions = systemPrompt
        ? systemPrompt + '\n\n' + todoNote
        : todoNote;
    }

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null };
    const userId = messageUserId || 'default';

    console.log(`[Chat API] createAgent start: ${Date.now() - startTime}ms`);

    const {
      agent,
      sessionState,
      mcpRegistry,
      model,
      adjustedMessages,
      wikiBaseDir,
    } = await createAgent({
      context,
      conversationId,
      messages,
      userId,
      agentType,
      model: {
        ...getModelConfig(modelName),
        includeUsage: true,
      },
      modules: enableConnectors === false ? { connectors: false } : undefined,
      customInstructions: finalInstructions,
      approvalMode,
      writerRef,
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
      const anchorMsg = existingMessages[checkpointResult.anchorIndex];
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
    const createOnEnd = (inputMessageCount: number) => async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
      try {
        unregisterAbortController(conversationId, runId);
        store.agentRunStore.completeRun(conversationId);

        const newAssistantMessages = completedMessages
          .slice(inputMessageCount)
          .filter((m) => m.role === 'assistant' && m.parts && m.parts.length > 0);

        if (newAssistantMessages.length === 0) {
          console.warn(
            `[Chat API] Stream produced no valid assistant messages, skipping save.\n` +
            `  Conversation: ${conversationId}\n` +
            `  Messages sent to LLM: ${finalMessages.length}\n` +
            `  Message roles: ${finalMessages.map((m) => m.role).join(' → ')}`,
          );
          return;
        }

        // 锚定在本轮用户消息上追加；head 已移走则成为孤儿分支（headMoved=false）
        const headMoved = store.messageStore.appendMessages(
          conversationId, newAssistantMessages, headMessageId,
        );
        console.log(
          `[Storage] Appended ${newAssistantMessages.length} assistant messages after ${headMessageId} (headMoved=${headMoved})`,
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
          mcpRegistry,
          model,
          isNewConversation: isFirstMessage,
          userId,
          wikiBaseDir,
          checkpoint: {
            modelName: sessionState.model,
            fallbackModels: sessionState.fallbackModels,
          },
        });
      } catch (err) {
        console.error('[Chat API] onFinish error:', err);
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
              let agentStream;
              try {
                agentStream = await createAgentUIStream({
                  agent,
                  uiMessages: finalMessages,
                  abortSignal: abortController.signal,
                  sendReasoning: true,
                  onEnd: createOnEnd(finalMessages.length),
                });
              } catch (streamErr) {
                // context_length_error：压缩消息后重试
                if (isContextLengthError(streamErr)) {
                  console.warn(`[Chat API] Context length error, attempting reactive retry for ${conversationId}`);
                  try {
                    const retryResult = await handleReactiveRetry(
                      streamErr,
                      finalMessages,
                      undefined, // 使用默认 compaction config
                      {
                        model: model!,
                        modelName: getModelConfig(modelName).modelName || '',
                        conversationId,
                        dataStore: store,
                      },
                    );
                    console.log(`[Chat API] Reactive retry: compressed ${finalMessages.length} → ${retryResult.messages.length} messages`);
                    agentStream = await createAgentUIStream({
                      agent,
                      uiMessages: retryResult.messages,
                      abortSignal: abortController.signal,
                      sendReasoning: true,
                      onEnd: createOnEnd(retryResult.messages.length),
                    });
                  } catch (retryErr) {
                    console.error('[Chat API] Reactive retry failed:', retryErr);
                    throw streamErr; // 重试也失败，抛出原始错误
                  }
                } else {
                  throw streamErr; // 非 context_length_error，直接抛出
                }
              }

              // 读取代理流并序列化为 JSON 字符串后发送到控制器
              const reader = agentStream.getReader();
              let agentChunkCount = 0;
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const serialized = JSON.stringify(value);
                  controller.enqueue(serialized);
                  agentChunkCount++;
                }
              } catch (agentErr) {
                console.error('[Chat API] Agent stream read error after', agentChunkCount, 'chunks:', agentErr);
              }
              console.log('[Chat API] Agent stream complete, total chunks:', agentChunkCount);
              controller.close();
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
        writerRef.current = writer as unknown as SubAgentStreamWriter;

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

