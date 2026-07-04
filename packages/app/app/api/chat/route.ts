import path from 'path'
import { getServerRuntime, getServerContext, getProjectContext, getModelConfig } from '@/lib/runtime';
import { convertFileToText } from '@/lib/file-convert';
import { getStreamManager } from '@/lib/stream-manager';
import {
  createAgent,
  generateConversationTitle,
  finalizeAgentRun,
  type SubAgentStreamWriter,
  type Todo,
} from '@the-thing/core';
import type { SQLiteDataStore } from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { runWorkflow, SQLiteAgentStateStore } from '@the-thing/workflow';
import type { StreamFactory } from '@the-thing/workflow';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 从持久化的 stream chunks 重建部分回复文本。
 * 提取所有 text-delta chunks 的内容拼接为完整文本。
 */
function reconstructPartialText(chunks: Array<{ chunkData: string }>): string | null {
  const parts: string[] = [];
  for (const chunk of chunks) {
    try {
      const data = JSON.parse(chunk.chunkData);
      if (data.type === 'text-delta' && typeof data.delta === 'string') {
        parts.push(data.delta);
      }
    } catch {
      // skip unparseable chunks
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

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
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// POST: Stream chat response
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      message: UIMessage;
      conversationId: string;
      userId?: string;
      modelName?: string;
      agentType?: string;
      enableConnectors?: boolean;
      systemPrompt?: string;
      approvalMode?: string;
    };

    const { message, conversationId, userId: messageUserId, modelName, agentType, enableConnectors, systemPrompt, approvalMode } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const defaultContext = await getServerContext();
    const store = defaultContext.runtime.dataStore;
    const streamManager = getStreamManager();

    // Resolve project context: if conversation has a project_id, use cached project context
    let context = defaultContext;
    const conversation = store.conversationStore.getConversation(conversationId);
    if (conversation?.projectId) {
      const project = store.projectStore.getProject(conversation.projectId);
      if (project) {
        context = await getProjectContext(conversation.projectId, project.path);
      }
    }

    let existingMessages = store.messageStore.getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;

    const existingMessageIndex = existingMessages.findIndex((m: UIMessage) => m.id === message.id);
    if (existingMessageIndex >= 0) {
      existingMessages = existingMessages.slice(0, existingMessageIndex);
    } else {
      const lastUserMessageIndex = existingMessages.findLastIndex((m: UIMessage) => m.role === 'user');
      if (lastUserMessageIndex >= 0 && existingMessages[lastUserMessageIndex].id === message.id) {
        existingMessages = existingMessages.slice(0, lastUserMessageIndex);
      }
    }

    const messages: UIMessage[] = [...existingMessages, message];

    // 立即持久化用户消息，确保进程崩溃后不丢失
    store.messageStore.saveMessages(conversationId, messages);

    // 检测上次未完成的 agent run（进程重启恢复）
    const existingRun = store.agentRunStore.getRun(conversationId);
    if (existingRun?.status === 'running') {
      console.log(`[Chat API] Detected interrupted run for ${conversationId} (${existingRun.stepCount} steps, ${existingRun.toolsUsed.length} tools used)`);
      // 尝试从 stream chunks 重建部分回复
      const chunks = store.agentRunStore.getChunks(conversationId);
      if (chunks.length > 0) {
        const partialText = reconstructPartialText(chunks);
        if (partialText) {
          const partialAssistantMsg: UIMessage = {
            id: `recovered-${conversationId}`,
            role: 'assistant',
            parts: [{ type: 'text', text: partialText }],
          };
          messages.push(partialAssistantMsg);
          store.messageStore.saveMessages(conversationId, messages);
          console.log(`[Chat API] Recovered partial reply (${partialText.length} chars) from ${chunks.length} chunks`);
        }
      }
      store.agentRunStore.failRun(conversationId, 'Process restarted');
      store.agentRunStore.clearChunks(conversationId);
    }

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
        ...getModelConfig(),
        modelName: modelName || getModelConfig().modelName,
        includeUsage: true,
      },
      modules: enableConnectors === false ? { connectors: false } : undefined,
      customInstructions: finalInstructions,
      approvalMode,
      agentRunStore: store.agentRunStore,
    });

    const messagesWithAttachments = adjustedMessages ?? messages;

    // Convert unsupported file types (e.g. docx, xlsx, pptx) to text for the LLM.
    // We create a new array so original messages (with file parts) are preserved for storage.
    const llmMessages: UIMessage[] = await Promise.all(
      messagesWithAttachments.map(async (msg) => {
        if (msg.role !== 'user') return msg;
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

    console.log(
      `[LLM Input] ${llmMessages.length} messages:\n` +
        llmMessages
          .map((m, i) => {
            const partSummaries = m.parts.map((p) => {
              if (p.type === 'text') return `text(${(p as { text: string }).text.slice(0, 40)})`;
              if (p.type === 'file') {
                const fp = p as { mediaType?: string; filename?: string; url?: string };
                return `file(${fp.mediaType}, ${fp.filename ?? 'unnamed'}, url:${fp.url ? fp.url.slice(0, 30) + '...' : 'none'})`;
              }
              return `[${p.type}]`;
            });
            return `  [${i}] ${m.role}: ${partSummaries.join(' | ')}`;
          })
          .join('\n'),
    );

    const abortController = new AbortController();

    // 创建 StreamFactory 包装 createAgentUIStream
    const agentRef = { agent };
    const createStream: StreamFactory = async ({ messages: streamMessages, abortSignal, onStep }: Parameters<StreamFactory>[0]) => {
      return createAgentUIStream({
        agent: agentRef.agent,
        uiMessages: streamMessages,
        abortSignal,
        sendReasoning: true,
        onStepEnd: onStep as unknown as Parameters<typeof createAgentUIStream>[0]['onStepEnd'],
      });
    };

    // 创建可恢复流
    const resumableStream = await streamManager.createNewResumableStream(
      conversationId,
      () => {
        const stream = new ReadableStream<string>({
          cancel() {
            abortController.abort();
          },
          start: async (controller) => {
            try {
              // 创建 writable 用于收集 chunks
              const collectedChunks: string[] = [];
              let chunkSeq = 0;
              const writable = new WritableStream<UIMessageChunk>({
                write(chunk) {
                  const serialized = JSON.stringify(chunk);
                  collectedChunks.push(serialized);
                  controller.enqueue(serialized);
                  // 持久化 chunk 用于跨重启恢复
                  store.agentRunStore.addChunk(conversationId, chunkSeq, serialized);
                  chunkSeq++;
                },
              });

              // 使用 workflow orchestrator 执行 agent
              const stateStore = new SQLiteAgentStateStore((store as unknown as SQLiteDataStore).db);
              const finalState = await runWorkflow({
                createStream,
                conversationId,
                messages: llmMessages,
                stateStore,
                sliceTimeoutMs: 300_000,
                writable,
                abortSignal: abortController.signal,
              });

              // 处理最终状态
              if (finalState.status === 'finished') {
                store.agentRunStore.completeRun(conversationId);
                store.agentRunStore.clearChunks(conversationId);

                // 从累积消息中提取新的 assistant 消息
                const completedMessages = finalState.accumulatedMessages;
                const newAssistantMessages = completedMessages.slice(llmMessages.length);
                const messagesToSave = [...messages, ...newAssistantMessages];

                console.log(
                  `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
                );

                const costSummary = sessionState.costTracker.getSummary();
                console.log(
                  `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
                );

                await finalizeAgentRun({
                  dataStore: store,
                  messages: messagesToSave,
                  conversationId,
                  costTracker: sessionState.costTracker,
                  mcpRegistry,
                  model,
                  isNewConversation: isFirstMessage,
                  userId,
                  wikiBaseDir,
                });
              } else if (finalState.status === 'timed_out') {
                console.log(`[Chat API] Slice timed out for ${conversationId}, state persisted for resume`);
                store.agentRunStore.failRun(conversationId, 'Slice timed out');
              } else if (finalState.status === 'failed') {
                console.log(`[Chat API] Workflow failed for ${conversationId}: ${finalState.error}`);
                store.agentRunStore.failRun(conversationId, finalState.error || 'Workflow failed');
              }

              console.log('[Chat API] Workflow complete, chunks:', chunkSeq);
              controller.close();
            } catch (error) {
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
        'X-Stream-Id': conversationId,
      },
    });
  } catch (error) {
    console.error('[Chat API] POST error:', error);
    return NextResponse.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}

// PATCH: Save messages
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { conversationId: string; messages: UIMessage[] };
    if (!body.conversationId || !body.messages) {
      return NextResponse.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }
    const rt = await getServerRuntime();
    rt.dataStore.messageStore.saveMessages(body.conversationId, body.messages);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Chat API] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}
