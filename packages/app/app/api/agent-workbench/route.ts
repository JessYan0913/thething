import path from 'path'
import os from 'os'
import { getServerContext, getServerDataStore, reloadServerContext } from '@/lib/runtime';
import {
  createAgent,
  finalizeAgentRun,
  loadGlobalConfig,
  type SubAgentStreamWriter,
} from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function parseMdContent(content: string): { body: string; tools: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content, tools: [] };

  const frontmatterText = match[1];
  const body = match[2];

  const tools: string[] = [];
  const toolsMatch = frontmatterText.match(/^tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (toolsMatch) {
    const lines = toolsMatch[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/^\s+-\s+(.+)/);
      if (itemMatch) tools.push(itemMatch[1].trim());
    }
  }

  return { body, tools };
}

const AGENT_SCHEMA_DESCRIPTION = `Agent .md 文件格式说明：

文件由 YAML frontmatter（配置）和 markdown body（系统指令）两部分组成：

\`\`\`
---
agentType: my-agent          # (必填) 代理唯一标识，kebab-case
displayName: 我的代理          # 显示名称
description: "代理描述"        # (必填) 代理功能描述
tools:                        # 允许使用的工具白名单
  - read_file
  - grep
  - glob
disallowedTools: []           # 禁止使用的工具黑名单
model: inherit                # inherit | fast | smart | 自定义模型 ID
effort: medium                # low | medium | high
maxTurns: 20                  # 最大对话轮次 (1-100)
permissionMode:               # 权限模式: acceptEdits | plan | bypassPermissions
background: false             # 是否后台运行
isolation:                    # 隔离模式: worktree
memory:                       # 记忆范围: user | project | local
skills: []                    # 预加载的技能列表
includeParentContext: false   # 是否继承父级上下文
maxParentMessages:            # 最大父级消息数
summarizeOutput: true         # 是否总结输出
initialPrompt: ""             # 首轮提示前缀
---

# Agent 系统指令（markdown 格式）

这里是 agent 的核心行为指令...
\`\`\`

常用工具名：read_file, edit_file, write_file, bash, grep, glob, search, agent, skill, ask_user_question, web_fetch
`;

function buildConfigChatPreamble(currentContent: string): string {
  return `<system-reminder>
你是一个 Agent 配置助手。你的唯一职责是通过对话帮助用户完善左侧编辑器中的 Agent 配置文档。

【绝对禁止】
- 禁止调用任何工具（不要 read_file、write_file、edit_file、bash、grep 等任何工具）
- 禁止创建、修改、读取任何文件
- 禁止直接操作文件系统

【你的工作方式】
你只通过纯文本对话工作。当用户描述需求时：
1. 分析需求，用自然语言解释你的配置建议和理由
2. 输出完整的 Agent .md 文件内容，用 <agent-config> 标签包裹

输出的内容会被自动填充到左侧编辑器中，用户可以在编辑器中微调后点击保存。

${AGENT_SCHEMA_DESCRIPTION}

当前编辑器内容：
\`\`\`
${currentContent}
\`\`\`

【输出格式】
当需要生成或修改配置时，输出完整的 .md 文件内容（YAML frontmatter + markdown 指令），用 <agent-config> 标签包裹：
<agent-config>
---
agentType: ...
description: ...
...所有 frontmatter 字段
---

# 系统指令标题

指令内容...
</agent-config>

注意：
- 始终输出完整文件内容（不是增量修改）
- instructions（--- 之后的 markdown 部分）要根据代理的用途精心编写
- 如果用户只是打招呼或闲聊，正常回应即可，不要主动生成配置
</system-reminder>
`;
}

function buildDebugPreamble(currentContent: string): string {
  const { body, tools } = parseMdContent(currentContent);
  const instructions = body.trim();
  const toolsNote = tools.length > 0
    ? `\n你应该只使用以下工具: ${tools.join(', ')}。不要使用其他工具。`
    : '';

  return `<system-reminder>
${instructions}
${toolsNote}
</system-reminder>
`;
}

async function handleChat(mode: 'config' | 'debug', request: Request) {
  try {
    const body = await request.json() as {
      message: UIMessage;
      conversationId: string;
      userId?: string;
      currentContent?: string;
    };

    const { message, conversationId, userId: messageUserId } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const context = await getServerContext();
    const store = context.runtime.dataStore;

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
    const currentContent = body.currentContent || '';

    if (isFirstMessage && messages.length > 0) {
      const firstMsg = messages[0];
      const originalText = firstMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      let preamble = '';
      if (mode === 'config') {
        preamble = buildConfigChatPreamble(currentContent);
      } else if (mode === 'debug') {
        preamble = buildDebugPreamble(currentContent);
      }

      messages[0] = {
        ...firstMsg,
        parts: [
          { type: 'text' as const, text: preamble + originalText },
          ...firstMsg.parts.filter((p) => p.type !== 'text'),
        ],
      };
    } else if (mode === 'config' && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const originalText = lastMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      const stateNote = `\n<system-reminder>\n当前编辑器内容：\n\`\`\`\n${currentContent}\n\`\`\`\n</system-reminder>\n`;

      messages[messages.length - 1] = {
        ...lastMsg,
        parts: [
          { type: 'text' as const, text: stateNote + originalText },
          ...lastMsg.parts.filter((p) => p.type !== 'text'),
        ],
      };
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
      model: {
        apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
        baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
        modelName: process.env.THETHING_MODEL || globalConfig?.modelAliases?.default?.model,
        includeUsage: true,
      },
    });

    const messagesWithAttachments = adjustedMessages ?? messages;

    console.log(
      `[Agent Workbench/${mode}] ${messagesWithAttachments.length} messages, conversationId=${conversationId}`,
    );

    const abortController = new AbortController();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writerRef.current = writer as unknown as SubAgentStreamWriter;

        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: messagesWithAttachments,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onFinish: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(messagesWithAttachments.length);
              const messagesToSave = [...messages, ...newAssistantMessages];

              const costSummary = sessionState.costTracker.getSummary();
              console.log(
                `[Agent Workbench/${mode}] Cost: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
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

              await reloadServerContext();
            } catch (err) {
              console.error(`[Agent Workbench/${mode}] onFinish error:`, err);
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
    console.error(`[Agent Workbench/${mode}] POST error:`, error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

async function handleGetMessages(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const store = await getServerDataStore();
    const messages = store.messageStore.getMessagesByConversation(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('[Agent Workbench] GET error:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

async function handlePatchMessages(request: Request) {
  try {
    const body = await request.json() as { conversationId: string; messages: UIMessage[] };
    if (!body.conversationId || !body.messages) {
      return NextResponse.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }

    const store = await getServerDataStore();
    store.messageStore.saveMessages(body.conversationId, body.messages);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agent Workbench] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleGetMessages(request);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') as 'config' | 'debug' || 'config';
  return handleChat(mode, request);
}

export async function PATCH(request: Request) {
  return handlePatchMessages(request);
}
