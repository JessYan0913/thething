import { getServerContext, getServerDataStore, getServerRuntime, reloadServerContext } from '@/lib/runtime';
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
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const WORKBENCH_PREAMBLE = `<system-reminder>
你是一个 Skill 开发助手，运行在 Skill 工作台中。

核心原则：在用户明确表达需求之前，不要调用任何工具，不要创建任何文件。

行为准则：
- 如果用户只是打招呼或闲聊，正常回应即可，不要主动提起创建 Skill
- 只有当用户明确描述了想要创建什么样的 Skill 时，才开始工作
- 开始工作前，先与用户确认需求理解是否正确
- 确认后，使用 skill-creator 技能（通过 Skill 工具调用）来指导创建流程
- 创建完成后告知用户可以请求测试
- 测试时直接调用新创建的 skill（通过 Skill 工具），验证其行为
- 每轮对话结束后系统会自动重新加载 skills，修改后的 skill 在下一轮即可测试
</system-reminder>
`;

const EDIT_PREAMBLE = `<system-reminder>
你是一个 Skill 开发助手，运行在 Skill 编辑工作台中。

你正在编辑一个已有的 Skill，用户希望你帮助修改和完善它。

核心原则：在用户明确表达修改需求之前，不要调用任何工具，不要修改任何文件。

行为准则：
- 下方会提供当前 Skill 的文件内容，请先理解它的功能和结构
- 如果用户只是打招呼或闲聊，正常回应即可
- 当用户描述了修改需求时，先确认理解是否正确
- 使用 skill-creator 技能（通过 Skill 工具调用）来执行修改
- 修改时保持现有 Skill 的整体结构，只修改用户要求的部分
- 修改完成后告知用户可以请求测试
- 每轮对话结束后系统会自动重新加载 skills，修改后的 skill 在下一轮即可测试
</system-reminder>
`;

async function readSkillContent(skillsDir: string, skillName: string): Promise<string | null> {
  const folderPath = path.join(skillsDir, skillName);
  try {
    await fs.access(folderPath);
  } catch {
    return null;
  }

  const parts: string[] = [];

  async function collectFiles(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await collectFiles(fullPath, relativePath);
      } else {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          parts.push(`--- ${relativePath} ---\n${content}`);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await collectFiles(folderPath, '');
  return parts.length > 0 ? parts.join('\n\n') : null;
}

// POST /chat — workbench chat streaming
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      message: UIMessage;
      conversationId: string;
      userId?: string;
      editSkillName?: string;
    };

    const { message, conversationId, userId: messageUserId, editSkillName } = body;

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

    if (isFirstMessage && messages.length > 0) {
      const rt = await getServerRuntime();
      const skillsDirs = rt.layout.resources.skills;
      const skillsDir = skillsDirs[skillsDirs.length - 1];

      const firstMsg = messages[0];
      const originalText = firstMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      let preamble: string;
      if (editSkillName) {
        const skillContent = await readSkillContent(skillsDir, editSkillName);
        preamble = EDIT_PREAMBLE
          + `\nSkills 目录路径: ${skillsDir}\n`
          + `\n当前编辑的 Skill: ${editSkillName}\n`
          + (skillContent ? `\n当前 Skill 文件内容:\n${skillContent}\n` : '');
      } else {
        preamble = WORKBENCH_PREAMBLE + `\nSkills 目录路径: ${skillsDir}\n`;
      }

      messages[0] = {
        ...firstMsg,
        parts: [
          { type: 'text' as const, text: preamble + originalText },
          ...firstMsg.parts.filter((p) => p.type !== 'text'),
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
      memoryBaseDir,
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
      `[Skill Workbench] ${messagesWithAttachments.length} messages, conversationId=${conversationId}`,
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
                `[Skill Workbench] Cost: $${costSummary.totalCostUsd.toFixed(6)} | Input: ${costSummary.inputTokens} | Output: ${costSummary.outputTokens}`,
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
                memoryBaseDir,
              });

              await reloadServerContext();
              console.log('[Skill Workbench] Context reloaded after agent turn');
            } catch (err) {
              console.error('[Skill Workbench] onFinish error:', err);
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
    console.error('[Skill Workbench] POST error:', error);
    return NextResponse.json({ error: 'Failed to process workbench request' }, { status: 500 });
  }
}

// GET — load messages or detect changes
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'detect') {
      const since = Number(searchParams.get('since') || '0');
      const rt = await getServerRuntime();
      const skillsDirs = rt.layout.resources.skills;
      const skillsDir = skillsDirs[skillsDirs.length - 1];

      try {
        await fs.access(skillsDir);
      } catch {
        return NextResponse.json({ skillName: null });
      }

      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      let latestName: string | null = null;
      let latestTime = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(skillsDir, entry.name);
        const stat = await fs.stat(dirPath);
        if (stat.mtimeMs > since && stat.mtimeMs > latestTime) {
          latestTime = stat.mtimeMs;
          latestName = entry.name;
        }
      }

      return NextResponse.json({ skillName: latestName });
    }

    // Default: load messages
    const conversationId = searchParams.get('conversationId');
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const store = await getServerDataStore();
    const messages = store.messageStore.getMessagesByConversation(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('[Skill Workbench] GET error:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// PATCH — save messages
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { conversationId: string; messages: UIMessage[] };
    if (!body.conversationId || !body.messages) {
      return NextResponse.json({ error: 'Missing conversationId or messages' }, { status: 400 });
    }

    const store = await getServerDataStore();
    store.messageStore.saveMessages(body.conversationId, body.messages);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skill Workbench] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save messages' }, { status: 500 });
  }
}
