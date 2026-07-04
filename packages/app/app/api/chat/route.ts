import path from 'path'
import { getServerRuntime, getServerContext, getProjectContext, getModelConfig } from '@/lib/runtime';
import { convertFileToText } from '@/lib/file-convert';
import { getStreamManager } from '@/lib/stream-manager';
import {
  createAgent,
  generateConversationTitle,
  finalizeAgentRun,
  DurableAgent,
  type SubAgentStreamWriter,
  type Todo,
} from '@the-thing/core';
import {
  convertToModelMessages,
  toUIMessageStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
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
        const parts = ['ID: ' + t.id, '状态: ' + t.status];
        if (t.activeForm) parts.push('进度: ' + t.activeForm);
        if (t.status === 'failed') parts.push('上次失败');
        return '- **' + t.subject + '** (' + parts.join(', ') + ')';
      });
      const todoNote = '\n\n## 未完成任务\n以下是你之前中断后留下的未完成任务，需要继续处理：\n'
        + todoLines.join('\n')
        + '\n\n你可以使用 todo_list 查看详细信息，然后继续执行。';

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
      wrappedModel,
      tools: agentTools,
      instructions: agentInstructions,
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

    // 创建 DurableAgent 替代 ToolLoopAgent
    const durableAgent = new DurableAgent({
      model: wrappedModel!,
      instructions: agentInstructions,
      tools: agentTools,
      onStepEnd: ({ stepNumber, toolCalls }) => {
        console.log(`[DurableAgent] Step ${stepNumber} completed, tools: ${toolCalls.map(t => t.toolName).join(', ')}`);
        store.agentRunStore.updateRun(conversationId, {
          stepCount: stepNumber + 1,
          toolsUsed: toolCalls.map(t => t.toolName),
        });
      },
      onToolExecutionEnd: ({ toolCall }) => {
        const existing = store.agentRunStore.getRun(conversationId);
        store.agentRunStore.updateRun(conversationId, {
          toolsUsed: [...new Set([...(existing?.toolsUsed ?? []), toolCall.toolName])],
        });
      },
    });

    const messagesWithAttachments = adjustedMessages ?? messages;

    // Convert unsupported file types (e.g. docx, xlsx, pptx) to text for the LLM.
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
              // 1. 转换 UI 消息为 Model 消息
              const modelMessages = await convertToModelMessages(
                llmMessages as Array<Omit<UIMessage, 'id'>>,
              );

              // 2. DurableAgent generator 循环 → TextStreamPart 流
              const { stream: textStream } = await durableAgent.stream({
                prompt: modelMessages,
                abortSignal: abortController.signal,
              });

              // 3. toUIMessageStream 转换 TextStreamPart → UIMessageChunk
              const uiStream = toUIMessageStream({
                stream: textStream as unknown as ReadableStream,
                tools: agentTools,
                sendReasoning: true,
                onEnd: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
                  try {
                    store.agentRunStore.completeRun(conversationId);
                    store.agentRunStore.clearChunks(conversationId);

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
                  } catch (err) {
                    console.error('[Chat API] onFinish error:', err);
                  }
                },
              });

              // 4. 消费 UIMessageChunk 流，序列化写入 resumable stream
              const reader = uiStream.getReader();
              let agentChunkCount = 0;
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const serialized = JSON.stringify(value);
                  controller.enqueue(serialized);
                  store.agentRunStore.addChunk(conversationId, agentChunkCount, serialized);
                  agentChunkCount++;
                }
              } catch (agentErr) {
                console.error('[Chat API] Agent stream read error after', agentChunkCount, 'chunks:', agentErr);
              }

              if (abortController.signal.aborted) {
                console.log('[Chat API] Agent aborted, marking run as stopped');
                store.agentRunStore.failRun(conversationId, 'Stopped by user');
              }

              console.log('[Chat API] Agent stream complete, total chunks:', agentChunkCount);
              controller.close();
            } catch (error) {
              console.error('[Chat API] Stream error:', error);
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
