import { getServerContext, getServerDataStore, getServerRuntime, reloadServerContext, getModelConfig } from '@/lib/runtime';
import {
  createAgent,
  finalizeAgentRun,
  type SubAgentStreamWriter,
  type Todo,
} from '@the-thing/core';
import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import type { AppContext } from '@the-thing/core';

export const runtime = 'nodejs';

// ============================================================
// 平台能力提取 — 从 AppContext 动态生成
// ============================================================

function buildPlatformCapabilitiesPrompt(context: AppContext): string {
  const sections: string[] = [];
  sections.push('\n\n## 平台能力（创建/编辑 Skill 时必须基于这些能力）');

  // 1. Agent 内置工具
  sections.push(`
### Agent 内置工具

Skill 执行时，Agent 可以使用以下工具：

| 工具名 | 说明 |
|--------|------|
| read_file | 读取文件内容 |
| write_file | 创建或覆盖文件 |
| edit_file | 编辑文件（查找替换） |
| bash | 执行 shell 命令（包括 Python 脚本） |
| glob | 按模式搜索文件 |
| grep | 在文件中搜索文本 |
| web_search | 搜索互联网 |
| save_report | 保存报告到输出目录 |
| use_skill | 调用其他 Skill |
| ask_user_question | 向用户提问 |

在 Skill 的 \`allowedTools\` frontmatter 中可以限制该 Skill 只能使用哪些工具。留空则不限制。`);

  // 2. Connectors（连接器及其工具）
  const enabledConnectors = context.connectors.filter((c) => c.enabled !== false);
  if (enabledConnectors.length > 0) {
    sections.push('\n### 连接器（Connectors）');
    sections.push('平台已配置以下连接器，Skill 可以通过 Agent 工具调用：\n');
    for (const conn of enabledConnectors) {
      sections.push(`**${conn.name}** (id: ${conn.id})${conn.description ? ` — ${conn.description}` : ''}`);
      if (conn.base_url) {
        sections.push(`  - 基础 URL: ${conn.base_url}`);
      }
      if (conn.tools && conn.tools.length > 0) {
        sections.push('  - 提供的工具:');
        for (const tool of conn.tools) {
          const params = tool.input_schema?.properties ? Object.keys(tool.input_schema.properties).join(', ') : '';
          sections.push(`    - \`${tool.name}\`: ${tool.description}${params ? ` (参数: ${params})` : ''}`);
        }
      }
    }
    sections.push('\n在 Skill 指令中可以让 Agent 调用这些连接器工具来访问外部服务。');
  }

  // 3. MCP Servers
  const enabledMcps = context.mcps.filter((m) => m.enabled !== false);
  if (enabledMcps.length > 0) {
    sections.push('\n### MCP 服务器');
    sections.push('平台已连接以下 MCP 服务器，其工具可供 Skill 使用：\n');
    for (const mcp of enabledMcps) {
      sections.push(`- **${mcp.name}** (${mcp.transport.type})`);
    }
  }

  // 4. 已有 Skills
  if (context.skills.length > 0) {
    sections.push('\n### 已有 Skills');
    sections.push('平台中已有以下 Skills，新 Skill 可以通过 `use_skill` 工具调用它们，也可以参考它们的设计：\n');
    for (const skill of context.skills) {
      const tools = skill.allowedTools.length > 0 ? ` [工具: ${skill.allowedTools.join(', ')}]` : '';
      sections.push(`- **${skill.name}**: ${skill.description}${tools}`);
    }
  }

  return sections.join('\n');
}

// ============================================================
// System Prompts for Skill Workbench Agent
// ============================================================

const WORKBENCH_SYSTEM_PROMPT = `你是一个专业的 Skill 开发助手，运行在 Skill 工作台中。

## 核心原则

在用户明确表达需求之前，不要调用任何工具，不要创建任何文件。

## 工作流程

1. **理解意图** — 搞清楚用户想让 Skill 做什么
2. **访谈细化** — 主动追问边界情况、输入输出格式、成功标准
3. **编写 Skill** — 生成 SKILL.md 及辅助资源
4. **Review & 迭代** — 和用户确认，根据反馈修改
5. **测试验证** — 用户请求时，调用新创建的 Skill 验证行为

### 理解意图

先搞清楚：
- 这个 Skill 让 Agent 做什么？
- 什么场景下应该触发？（用户会说什么话/什么上下文）
- 期望的输出格式是什么？
- 是否需要调用特定工具？

### 访谈细化

主动问：
- 边界情况怎么处理？
- 有没有示例输入/输出？
- 有没有必须遵循的约束？
- 需要哪些工具权限？

## Skill 文件结构

\`\`\`
skill-name/
├── SKILL.md        (必须) — 主指令文件
└── references/     (可选) — 参考文档、模板、脚本
    ├── template.md
    └── examples.md
\`\`\`

## SKILL.md 格式规范

\`\`\`markdown
---
name: 技能名称
description: 触发条件和功能描述（一句话，但要具体）
---

[Markdown 正文 — Agent 执行此 Skill 时遵循的指令]
\`\`\`

### Frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| name | ✅ | 显示名称，≤50 字符 |
| description | ✅ | 触发描述。要稍微"主动"一点——宁可多触发也不要漏触发 |
| allowedTools | 可选 | 限制 Skill 只能使用的工具列表。留空则不限制 |
| effort | 可选 | 推理力度：low / medium / high（默认 medium） |

### Body 编写原则

1. **使用祈使句** — 直接告诉 Agent 做什么
2. **具体可执行** — 每一步都要明确到 Agent 能直接执行
3. **结构化** — 用标题、编号列表组织步骤
4. **定义输出格式** — 如果有固定格式，给出模板
5. **包含示例** — 用 Example 展示预期行为
6. **\`$ARGUMENTS\` 占位符** — 运行时被用户参数替换

### description 编写技巧

description 是主要的触发机制。要：
- 既说明 Skill 做什么，又说明什么时候用
- 稍微"主动"些 — 宁可多触发也不要遗漏

❌ "生成周报"
✅ "生成每周工作报告。当用户提到周报、本周总结、weekly report、工作汇报时使用此 skill"

## 文件命名规范

- 文件夹名：英文小写 + 连字符，如 \`data-analysis\`、\`code-review\`
- 不使用中文、空格、特殊字符

## 行为准则

- 如果用户只是打招呼或闲聊，正常回应即可，不要主动提起创建 Skill
- 只有当用户明确描述了想要创建什么样的 Skill 时，才开始工作
- 开始工作前，先与用户确认需求理解是否正确
- 创建完成后告知用户可以请求测试
- 每轮对话结束后系统会自动重新加载 skills，修改后的 skill 在下一轮即可测试
- **生成的 Skill 必须基于平台已有能力**——只能使用下方「平台能力」中列出的工具、连接器
- **禁止写死绝对路径**。引用脚本和资源时使用相对路径，例如 \`.siact/skills/<skill-name>/scripts/run.py\``;

const EDIT_SYSTEM_PROMPT = `你是一个专业的 Skill 开发助手，运行在 Skill 编辑工作台中。

你正在编辑一个已有的 Skill，用户希望你帮助修改和完善它。

## 核心原则

在用户明确表达修改需求之前，不要调用任何工具，不要修改任何文件。

## 行为准则

- 下方会提供当前 Skill 的文件内容，请先理解它的功能和结构
- 如果用户只是打招呼或闲聊，正常回应即可
- 当用户描述了修改需求时，先确认理解是否正确
- 修改时保持现有 Skill 的整体结构，只修改用户要求的部分
- 修改完成后告知用户可以请求测试
- 每轮对话结束后系统会自动重新加载 skills，修改后的 skill 在下一轮即可测试

## Skill 文件格式参考

\`\`\`markdown
---
name: 技能名称
description: 触发条件和功能描述
allowedTools: [tool1, tool2]  # 可选，限制可用工具
effort: medium                # 可选，推理力度
---

[Markdown 正文 — Agent 执行此 Skill 时遵循的指令]
\`\`\`

## 编辑原则

1. 保持现有 Skill 的整体结构和风格
2. 只修改用户要求的部分，不要"顺手"优化无关内容
3. 如果修改涉及 frontmatter（如 description），确保仍然准确描述触发条件
4. 修改后列出所有变更的文件`;

// ============================================================
// 沙箱 Python 依赖（预装在执行环境中）
// ============================================================

const SANDBOX_PYTHON_DEPS = `
## 沙箱 Python 环境（预装依赖）

以下库已在 Python 沙箱中预装，Skill 中的 Python 脚本可以直接 import：

### 数据处理
- **pandas** (2.3.3) — 数据分析、DataFrame 操作
- **openpyxl** (3.1.5) — 读写 .xlsx 文件
- **xlsxwriter** (3.2.9) — 生成 Excel 文件（支持图表）
- **xlrd** (2.0.2) — 读取 .xls 文件
- **scikit-learn** (1.6.1) — 机器学习

### 文件处理
- **pypdf** (6.6.0) — PDF 读写
- **pdfplumber** (0.11.6) — PDF 表格/文本提取
- **PyMuPDF/fitz** (1.25.5) — PDF 渲染、图像提取
- **reportlab** (4.5.0) — PDF 生成
- **python-docx** (1.2.0) — Word 文档读写
- **python-pptx** (1.0.2) — PowerPoint 读写
- **lxml** (6.1.0) — XML/HTML 解析
- **defusedxml** (0.7.1) — 安全 XML 解析

### 可视化
- **matplotlib** (3.7.1) — 图表绑定
- **Pillow** (12.2.0) — 图像处理

### 网络与数据
- **requests** (2.32.5) — HTTP 请求
- **requests-toolbelt** (1.0.0) — 高级 HTTP 工具
- **urllib3** (2.6.3) — HTTP 客户端

### 科学计算
- **scipy** (>=1.11.0) — 科学计算
- **statsmodels** (0.14.5) — 统计分析
- **networkx** (3.6.1) — 图论/网络分析

### 工具库
- **python-dateutil** (2.9.0) — 日期解析
- **pytz** (2025.2) — 时区处理
- **regex** (2026.1.15) — 高级正则表达式

⚠️ 如果 Skill 需要的 Python 库不在上述列表中，请在 Skill 指令中注明需要先用 pip install 安装。
`;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 在所有 skills 目录中查找指定 skill 的实际路径。
 * skills 目录优先级：[用户级, 项目级]，返回第一个存在的。
 * 如果指定 skillName，返回该 skill 所在的目录；否则返回第一个存在的 skills 目录。
 */
async function findSkillDir(skillsDirs: readonly string[], skillName?: string): Promise<string | null> {
  for (const dir of skillsDirs) {
    if (skillName) {
      const skillPath = path.join(dir, skillName);
      try {
        await fs.access(skillPath);
        return dir;
      } catch {
        // 继续搜索下一个目录
      }
    } else {
      try {
        await fs.access(dir);
        return dir;
      } catch {
        // 继续搜索下一个目录
      }
    }
  }
  return null;
}

async function readSkillContent(skillsDirs: readonly string[], skillName: string): Promise<string | null> {
  // 在所有 skills 目录中查找该 skill
  const skillsDir = await findSkillDir(skillsDirs, skillName);
  if (!skillsDir) return null;

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
      message?: UIMessage;
      messages?: UIMessage[];
      conversationId: string;
      userId?: string;
      editSkillName?: string;
    };

    const { conversationId, userId: messageUserId, editSkillName } = body;

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    // 兼容两种格式：单条 message（旧格式）和 messages 数组（Vercel AI SDK 格式）
    const message = body.message ?? body.messages?.at(-1);
    if (!message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
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

    // ============================================================
    // 构建 customInstructions — 首条消息时注入完整系统指令
    // ============================================================
    let customInstructions: string | undefined;

    if (isFirstMessage && messages.length > 0) {
      const rt = await getServerRuntime();
      const skillsDirs = rt.layout.resources.skills;

      // 在所有 skills 目录中查找可用的目录
      const skillsDir = (await findSkillDir(skillsDirs, editSkillName))
        ?? (await findSkillDir(skillsDirs))
        ?? skillsDirs[skillsDirs.length - 1]; // 兜底：使用项目级目录

      // 基础指令
      let instructions = editSkillName ? EDIT_SYSTEM_PROMPT : WORKBENCH_SYSTEM_PROMPT;

      // 工作目录
      instructions += `\n\n## 工作目录\n\nSkills 目录路径: ${skillsDir}`;
      instructions += `\n所有文件操作必须限制在 ${skillsDir} 目录内`;
      instructions += `\nSkill 正文里的脚本执行示例不要写死当前机器的绝对路径；请写成相对项目目录的路径，如: python3 ".siact/skills/<skill-name>/scripts/run.py"。`;

      // 注入平台能力上下文
      instructions += buildPlatformCapabilitiesPrompt(context);
      instructions += SANDBOX_PYTHON_DEPS;

      // 编辑模式：附加当前 skill 信息
      if (editSkillName) {
        const skillContent = await readSkillContent(skillsDirs, editSkillName);
        instructions += `\n\n## 当前编辑的 Skill\n`;
        instructions += `- 文件夹名: ${editSkillName}\n`;
        if (skillContent) {
          instructions += `\n当前 Skill 文件内容:\n${skillContent}\n`;
        }
        instructions += `\n请先理解当前 Skill 的功能和结构，再根据用户要求进行修改。`;
      }

      customInstructions = instructions;

      // 将 preamble 注入首条消息文本
      const firstMsg = messages[0];
      const originalText = firstMsg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      const preamble = editSkillName
        ? `你正在编辑 Skill: ${editSkillName}，Skills 目录: ${skillsDir}`
        : `Skill 工作台已就绪，Skills 目录: ${skillsDir}`;

      messages[0] = {
        ...firstMsg,
        parts: [
          { type: 'text' as const, text: preamble + '\n\n' + originalText },
          ...firstMsg.parts.filter((p) => p.type !== 'text'),
        ],
      };
    }

    // 检测未完成的 todo，让 Agent 感知到之前中断的任务
    const conversationTodos: Todo[] = store.todoStore.getTodosByConversation(conversationId);
    const unfinishedTodos = conversationTodos.filter(
      (t: Todo) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed'
    );

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

      if (customInstructions) {
        customInstructions += todoNote;
      } else {
        customInstructions = '\n\n## \u7cfb\u7edf\u6307\u4ee4\n' + todoNote;
      }
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
      model: {
        ...getModelConfig(),
        includeUsage: true,
      },
      modules: {
        mcps: false,
        connectors: false,
        permissions: false,
      },
      agentType: 'skill-workbench',
      customInstructions,
      writerRef,
      conversationMeta: {
        isNewConversation: isFirstMessage,
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
          onEnd: async ({ messages: completedMessages }: { messages: UIMessage[] }) => {
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
                wikiBaseDir,
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to process workbench request: ${message}` }, { status: 500 });
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

      let latestName: string | null = null;
      let latestTime = 0;

      // 搜索所有 skills 目录
      for (const skillsDir of skillsDirs) {
        try {
          await fs.access(skillsDir);
        } catch {
          continue;
        }

        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const dirPath = path.join(skillsDir, entry.name);
          const stat = await fs.stat(dirPath);
          if (stat.mtimeMs > since && stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestName = entry.name;
          }
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
