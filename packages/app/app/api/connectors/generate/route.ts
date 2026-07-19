import { getServerContext, reloadServerContext, getModelConfig } from '@/lib/runtime';
import { createAgent, finalizeAgentRun } from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const CONNECTOR_SCHEMA_DESCRIPTION = `连接器 YAML 文件格式说明：

连接器是一个 YAML 文件，用于定义外部 API 的工具集合。格式如下：

\`\`\`yaml
id: my-connector                    # (必填) 连接器唯一标识，kebab-case
name: 我的连接器                      # (必填) 显示名称
version: "1.0.0"                    # 版本号
description: "连接器功能描述"          # (必填) 连接器描述
enabled: true                       # 是否启用

# 认证配置
auth:
  type: none                        # none | api_key | bearer | custom
  config: {}                        # 认证配置

# 基础 URL（所有工具请求的前缀）
base_url: "https://api.example.com"

# 变量定义（支持环境变量替换）
variables:
  API_KEY: "\${MY_API_KEY}"
  SECRET: "\${MY_SECRET}"

# 工具定义
tools:
  - name: get_user                  # 工具名称
    description: "获取用户信息"       # 工具描述
    executor: http                  # http | mock
    timeout_ms: 30000               # 超时时间
    input_schema:                   # JSON Schema 格式的输入参数
      type: object
      properties:
        user_id:
          type: string
          description: "用户 ID"
      required:
        - user_id
    executor_config:                # 执行器配置
      method: GET
      path: "/users/\${user_id}"
      headers:
        Authorization: "Bearer \${API_KEY}"

# 入站配置（Webhook 等）
inbound:
  enabled: false
  protocol: webhook
  webhookPath: "/webhook/my-connector"
\`\`\`

常用 executor_config 字段：
- method: GET | POST | PUT | DELETE | PATCH
- path: 请求路径（支持 \${variable} 变量替换）
- headers: 请求头（支持 \${variable} 变量替换）
- body: 请求体模板（POST/PUT 时使用）
- query: 查询参数模板

注意：
- 始终输出完整的 YAML 文件内容
- id 使用 kebab-case 格式
- 确保 YAML 语法正确
`;

function buildPreamble(description: string): string {
  return `<system-reminder>
你是一个连接器配置助手。你的唯一职责是根据用户的描述生成连接器 YAML 配置文件。

【绝对禁止】
- 禁止调用任何工具（不要 read_file、write_file、edit_file、bash、grep 等任何工具）
- 禁止创建、修改、读取任何文件
- 禁止直接操作文件系统

【你的工作方式】
你只通过纯文本对话工作。当用户描述需求时：
1. 分析需求，理解用户想要连接的 API 或服务
2. 生成完整的连接器 YAML 配置文件

${CONNECTOR_SCHEMA_DESCRIPTION}

【输出格式】
直接输出完整的 YAML 文件内容，用 \`\`\`yaml 代码块包裹。
确保生成的 YAML 是合法的、可直接使用的配置。

用户需求：${description}
</system-reminder>
`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      description: string;
      conversationId: string;
      message: UIMessage;
    };

    const { description, conversationId, message } = body;

    if (!conversationId || !message) {
      return NextResponse.json({ error: 'Missing conversationId or message' }, { status: 400 });
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
      const firstMsg = messages[0];
      const originalText = firstMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      const preamble = buildPreamble(description || originalText);

      messages[0] = {
        ...firstMsg,
        parts: [
          { type: 'text' as const, text: preamble + originalText },
          ...firstMsg.parts.filter((p) => p.type !== 'text'),
        ],
      };
    }

    const {
      agent,
      sessionState,
      mcpRegistry,
      model,
      adjustedMessages,
    } = await createAgent({
      context,
      conversationId,
      messages,
      userId: 'default',
      model: {
        ...getModelConfig(),
        includeUsage: true,
      },
    });

    const messagesWithAttachments = adjustedMessages ?? messages;

    const abortController = new AbortController();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const agentStream = await createAgentUIStream({
          agent,
          uiMessages: messagesWithAttachments,
          abortSignal: abortController.signal,
          sendReasoning: true,
          onEnd: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
            try {
              const newAssistantMessages = completedMessages.slice(messagesWithAttachments.length);
              const messagesToSave = [...messages, ...newAssistantMessages];

              await finalizeAgentRun({
                dataStore: store,
                messages: messagesToSave,
                conversationId,
                costTracker: sessionState.costTracker,
                mcpRegistry,
                model,
                isNewConversation: isFirstMessage,
                userId: 'default',
              });

              await reloadServerContext();
            } catch (err) {
              console.error('[Connector Generate] onFinish error:', err);
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
    console.error('[Connector Generate API] error:', error);
    return NextResponse.json({ error: 'Failed to generate connector' }, { status: 500 });
  }
}
