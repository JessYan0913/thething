import path from 'path'
import os from 'os'
import { getServerRuntime, getServerContext, getProjectContext } from '@/lib/runtime';
import { convertFileToText } from '@/lib/file-convert';
import { getStreamManager } from '@/lib/stream-manager';
import {
  createAgent,
  generateConversationTitle,
  finalizeAgentRun,
  loadGlobalConfig,
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
    };

    const { message, conversationId, userId: messageUserId, modelName, agentType, enableConnectors, systemPrompt } = body;

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

    const globalConfigDir = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething');
    const globalConfig = loadGlobalConfig(globalConfigDir);
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
        apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
        baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
        modelName: modelName || process.env.THETHING_MODEL || globalConfig?.modelAliases?.default?.model,
        includeUsage: true,
      },
      modules: enableConnectors === false ? { connectors: false } : undefined,
      customInstructions: finalInstructions,
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

    // 创建可恢复流
    const resumableStream = await streamManager.createNewResumableStream(
      conversationId,
      () => {
        // 创建原始流：将 UIMessageChunk 对象序列化为 JSON 字符串，
        // 因为可恢复流按字符串缓冲/恢复，逐个 chunk 独立传输。
        const stream = new ReadableStream<string>({
          start: async (controller) => {
            try {
              const agentStream = await createAgentUIStream({
                agent,
                uiMessages: llmMessages,
                abortSignal: abortController.signal,
                sendReasoning: true,
                onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
                  try {
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

              // 读取代理流并序列化为 JSON 字符串后发送到控制器
              const reader = agentStream.getReader();
              let agentChunkCount = 0;
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(JSON.stringify(value));
                  agentChunkCount++;
                }
              } catch (agentErr) {
                console.error('[Chat API] Agent stream read error after', agentChunkCount, 'chunks:', agentErr);
              }
              console.log('[Chat API] Agent stream complete, total chunks:', agentChunkCount);
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
