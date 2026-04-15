import { createAgentPipeline } from '@/lib/agent-control/pipeline';
import { createDefaultStopConditions } from '@/lib/agent-control/stop-conditions';
import {
  generateConversationTitle,
  getMessagesByConversation,
  saveMessages,
  updateConversationTitle,
} from '@/lib/chat-store';
import { compactMessagesIfNeeded, estimateMessagesTokens } from '@/lib/compaction';
import { runCompactInBackground } from '@/lib/compaction/background-queue';
import { costTrackingMiddleware } from '@/lib/middleware/cost-tracking';
import { telemetryMiddleware } from '@/lib/middleware/telemetry';
import { createSessionState } from '@/lib/session-state/state';
import { createResearchAgent } from '@/lib/subagents';
import type { SubAgentStreamWriter } from '@/lib/subagents/agent-tool';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { bashTool, editFileTool, exaSearchTool, globTool, grepTool, readFileTool, writeFileTool } from '@/lib/tools';
import { getGlobalTaskStore } from '@/lib/tasks';
import { createTaskToolsForConversation } from '@/lib/tasks/tools';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  ToolLoopAgent,
  UIMessage,
  wrapLanguageModel,
  type Tool,
} from 'ai';
import {
  determineActiveSkills,
  getAvailableSkillsMetadata,
  loadFullSkill,
  recordSkillUsage,
} from '@/lib/skills';
import { findRelevantMemories, buildMemorySection, getUserMemoryDir, ensureMemoryDirExists } from '@/lib/memory';
import { extractMemoriesInBackground } from '@/lib/memory/extractor';
import { getMcpServerConfigs } from '@/lib/mcp/mcp-config-store';
import { createMcpRegistry, type McpRegistry } from '@/lib/mcp/registry';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
  includeUsage: true,
});

export const maxDuration = 30;

async function resolveActiveSkillsAndBodies(messages: UIMessage[]) {
  const skillsMetadata = await getAvailableSkillsMetadata();

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) return { activeSkillNames: new Set<string>(), activeSkills: [], activeToolsWhitelist: null, activeModelOverride: null };

  const userMessageText = lastUserMessage.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ');

  const activeSkillNames = determineActiveSkills(skillsMetadata, userMessageText);
  if (activeSkillNames.size === 0) return { activeSkillNames, activeSkills: [], activeToolsWhitelist: null, activeModelOverride: null };

  const activeSkills = await Promise.all(
    Array.from(activeSkillNames).map(async (name) => {
      const metadata = skillsMetadata.find((s) => s.name === name);
      if (!metadata) return null;
      return loadFullSkill(metadata);
    })
  );

  const filteredActiveSkills = activeSkills.filter((s): s is NonNullable<typeof s> => s !== null);

  for (const skill of filteredActiveSkills) {
    recordSkillUsage(skill.name);
  }

  const allAllowedTools = new Set<string>();
  let modelOverride: string | null = null;
  for (const skill of filteredActiveSkills) {
    for (const tool of skill.allowedTools) {
      allAllowedTools.add(tool);
    }
    if (skill.model && !modelOverride) {
      modelOverride = skill.model;
    }
  }

  return {
    activeSkillNames,
    activeSkills: filteredActiveSkills,
    activeToolsWhitelist: allAllowedTools.size > 0 ? allAllowedTools : null,
    activeModelOverride: modelOverride,
  };
}

function formatActiveSkillBodies(skillBodies: { name: string; body: string }[]): string {
  if (skillBodies.length === 0) return '';

  const sections = skillBodies
    .map((s) => `<技能指令 name="${s.name}">\n${s.body}\n</技能指令>`)
    .join('\n\n');

  return `## 已激活技能完整指令

以下技能已根据你的需求自动激活，请严格按照指令执行：

${sections}`;
}

async function createChatAgent(
  conversationId: string,
  conversationMeta?: {
    messageCount: number;
    isNewConversation: boolean;
    conversationStartTime: number;
  },
  writerRef?: { current: SubAgentStreamWriter | null },
  messages?: UIMessage[],
  memoryContext?: {
    userId: string;
    teamId?: string;
    recalledMemoriesContent?: string;
  },
  mcpRegistry?: McpRegistry,
) {
  const skillResolution = messages ? await resolveActiveSkillsAndBodies(messages) : null;

  const sessionState = createSessionState(conversationId, {
    maxContextTokens: 128_000,
    compactThreshold: 25_000,
    maxBudgetUsd: 5.0,
    model: process.env.DASHSCOPE_MODEL,
  });

  if (skillResolution?.activeModelOverride) {
    sessionState.model = skillResolution.activeModelOverride;
  }

  if (skillResolution?.activeSkillNames) {
    for (const name of skillResolution.activeSkillNames) {
      sessionState.activeSkills.add(name);
    }
    for (const skill of skillResolution.activeSkills) {
      sessionState.loadedSkills.set(skill.name, skill);
    }
  }

  const { prompt } = await buildSystemPrompt({
    includeProjectContext: true,
    conversationMeta: conversationMeta ?? undefined,
    memoryContext: memoryContext ?? undefined,
  });

  const finalInstructions = skillResolution?.activeSkills && skillResolution.activeSkills.length > 0
    ? `${prompt}\n\n${formatActiveSkillBodies(skillResolution.activeSkills.map((s) => ({ name: s.name, body: s.body })))}`
    : prompt;

  const wrappedModel = wrapLanguageModel({
    model: dashscope(sessionState.model),
    middleware: [telemetryMiddleware(), costTrackingMiddleware(sessionState.costTracker)],
  });

  const allTools: Record<string, Tool> = {
    web_search: exaSearchTool,
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    bash: bashTool,
    grep: grepTool,
    glob: globTool,
    research: createResearchAgent({
      model: wrappedModel,
      tools: {
        web_search: exaSearchTool,
        read_file: readFileTool,
        grep: grepTool,
        glob: globTool,
      },
      maxSteps: 20,
      maxContextMessages: 10,
      writerRef,
    }),
    ...createTaskToolsForConversation(getGlobalTaskStore(), conversationId),
  };

  if (mcpRegistry) {
    const mcpTools = mcpRegistry.getAllTools()
    for (const [toolName, toolDef] of Object.entries(mcpTools)) {
      const prefixedName = `mcp_${toolName}`
      if (!(prefixedName in allTools)) {
        allTools[prefixedName] = toolDef as Tool
      }
    }
    const mcpSnapshot = mcpRegistry.snapshot()
    console.log(`[MCP] ${mcpSnapshot.totalTools} MCP tools available: ${Object.keys(mcpTools).join(', ')}`)
  }

  const tools = allTools;

  const prepareStep = createAgentPipeline<ChatToolsType>({
    sessionState,
    maxSteps: 50,
    maxBudgetUsd: 5.0,
  });

  const stopWhen = createDefaultStopConditions<ChatToolsType>(sessionState.costTracker, {
    maxSteps: 50,
    denialTracker: sessionState.denialTracker,
    sessionState,
  });

  return {
    agent: new ToolLoopAgent({
      model: wrappedModel,
      instructions: finalInstructions,
      tools,
      prepareStep,
      stopWhen,
      toolChoice: 'auto',
    }),
    sessionState,
  };
}

type ChatToolsType = Record<string, Tool>;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const messages = getMessagesByConversation(conversationId);
    return Response.json({ messages });
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return Response.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let mcpRegistry: McpRegistry | undefined
  try {
    const { message, conversationId }: {
      message: UIMessage;
      conversationId: string;
    } = await req.json();

    if (!conversationId) {
      return Response.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    let existingMessages = getMessagesByConversation(conversationId);
    const isFirstMessage = existingMessages.length === 0;

    const existingMessageIndex = existingMessages.findIndex((m) => m.id === message.id);
    if (existingMessageIndex >= 0) {
      existingMessages = existingMessages.slice(0, existingMessageIndex);
    } else {
      const lastUserMessageIndex = existingMessages.findLastIndex((m) => m.role === 'user');
      if (lastUserMessageIndex >= 0 && existingMessages[lastUserMessageIndex].id === message.id) {
        existingMessages = existingMessages.slice(0, lastUserMessageIndex);
      }
    }

    const messages: UIMessage[] = [...existingMessages, message];

    const { messages: compactedMessages, executed: compactionExecuted } = await compactMessagesIfNeeded(
      messages,
      conversationId,
    );

    const preCompactionTokens = estimateMessagesTokens(messages);
    const postCompactionTokens = estimateMessagesTokens(compactedMessages);
    console.log(`[Tokens] Pre: ${preCompactionTokens}, Post: ${postCompactionTokens}`);
    console.log(
      `[LLM Input] ${compactedMessages.length} messages:\n` +
        compactedMessages
          .map((m, i) => {
            const part = m.parts[0];
            const text = part?.type === 'text' ? part.text : `[${part?.type}]`;
            return `  [${i}] ${m.role}: ${text.replace(/\n/g, ' ').slice(0, 60)}${text.length > 60 ? '…' : ''}`;
          })
          .join('\n'),
    );

    const writerRef: { current: SubAgentStreamWriter | null } = { current: null };

    // ========== Memory Recall ==========
    const userId = message.userId || 'default';
    const userMemDir = getUserMemoryDir(userId);
    await ensureMemoryDirExists(userMemDir);

    const lastUserMessage = [...compactedMessages].reverse().find((m) => m.role === 'user');
    const lastUserMessageText = lastUserMessage?.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ') || '';

    let recalledMemoriesContent = '';
    if (lastUserMessageText) {
      const relevantMemories = await findRelevantMemories(lastUserMessageText, userMemDir, {
        maxResults: 5,
      });

      if (relevantMemories.length > 0) {
        recalledMemoriesContent = await buildMemorySection(relevantMemories, userMemDir);
      }
    }

    const mcpConfigs = getMcpServerConfigs()
    if (mcpConfigs.length > 0) {
      mcpRegistry = createMcpRegistry(mcpConfigs)
      try {
        await mcpRegistry.connectAll()
      } catch (mcpError) {
        console.error('[MCP] Connection error:', mcpError)
      }
    }

    const { agent, sessionState } = await createChatAgent(
      conversationId,
      {
        messageCount: compactedMessages.length,
        isNewConversation: isFirstMessage,
        conversationStartTime: Date.now(),
      },
      writerRef,
      compactedMessages,
      {
        userId,
        recalledMemoriesContent,
      },
      mcpRegistry,
    );

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => {
      sessionState.abort();
      abortController.abort();
    });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter;

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: compactedMessages,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(compactedMessages.length);
              const messagesToSave = [...messages, ...newAssistantMessages];

              console.log(
                `[Storage] Saving ${messagesToSave.length} messages (${messages.length} original + ${newAssistantMessages.length} new)`,
              );
              console.log(
                `[Storage] Compaction was ${compactionExecuted ? 'executed' : 'not executed'}, but database receives ORIGINAL messages`,
              );

              await saveMessages(conversationId, messagesToSave);

              const costSummary = sessionState.costTracker.getSummary();
              console.log(
                `[Cost] Total: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
              );
              await sessionState.costTracker.persistToDB();

              // ========== Background Memory Extraction ==========
              extractMemoriesInBackground(
                completedMessages,
                userId,
                conversationId,
              ).catch((err) => console.error('[Memory Extraction] Error:', err));

              if (isFirstMessage) {
                const title = await generateConversationTitle(completedMessages);
                updateConversationTitle(conversationId, title);
                console.log(`[Title Generated] ${conversationId}: ${title}`);
              }

              runCompactInBackground(messagesToSave, conversationId);

              if (mcpRegistry) {
                await mcpRegistry.disconnectAll()
              }
            } catch (err) {
              console.error('[Chat API] onFinish error:', err);
            }
          },
        });

        writer.merge(agentStream);
      },
      onError: (err) => String(err),
    });

    return createUIMessageStreamResponse({
      stream,
      headers: { 'X-Conversation-Id': conversationId },
    });
  } catch (error) {
    if (mcpRegistry) {
      try { await mcpRegistry.disconnectAll() } catch {}
    }
    console.error('[Chat API] POST error:', error);
    return Response.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { conversationId, messages }: { conversationId: string; messages: UIMessage[] } = await req.json();

    if (!conversationId || !messages) {
      return Response.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }

    await saveMessages(conversationId, messages);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[Chat API] PATCH error:', error);
    return Response.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}