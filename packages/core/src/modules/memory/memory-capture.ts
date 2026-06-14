// ============================================================
// Memory Capture - LLM 提取决策逻辑
// ============================================================
// 从 extractor.ts 中提取的 LLM 调用和决策逻辑
// 文件 IO 操作委托给 memory-store.ts

import { generateText, Output } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { z } from 'zod';
import { getUserMemoryDir, ensureMemoryDirExists } from './paths';
import type { MemoryType, MemoryFileData } from './types';
import { scanMemoryFiles } from './memory-scan';
import { writeMemoryFile, updateMemoryFile, deleteMemoryWithCleanup, invalidateMemoryFile, getMemoryFileName } from './memory-store';
import type { EntrypointLimits } from './memdir';
import { logger } from '../../primitives/logger';
import type { UIMessage } from 'ai';

// 检查 model 参数是否提供
function requireModel(model?: LanguageModelV3): LanguageModelV3 {
  if (!model) {
    throw new Error('[MemoryExtractor] Model parameter is required. Application layer must provide a LanguageModelV3 instance.');
  }
  return model;
}

const memoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        content: z
          .string()
          .describe("用第三人称写用户实际说出的事实，不加推断词"),
        type: z
          .enum(["user", "feedback", "project", "reference"])
          .describe("记忆类型: user=用户自身, feedback=AI行为, project=项目约束, reference=外部工具"),
        stability: z
          .enum(["identity", "state", "pattern"])
          .describe("稳定性: identity=极少变化, pattern=跨场景规律, state=当前任务绑定"),
        source: z
          .enum(["explicit", "inferred"])
          .describe("来源: explicit=用户亲口说出, inferred=从行为推断"),
        confidence: z
          .number()
          .min(0.1)
          .max(1.0)
          .describe("置信度: explicit=0.9, inferred=0.3~0.6"),
        action: z
          .enum(["create", "update", "delete", "invalidate"])
          .describe("操作类型: create=新记忆, update=替换现有, delete=删除过时, invalidate=标记过期"),
        targetFilename: z
          .string()
          .optional()
          .describe("update/delete/invalidate 时的目标文件名"),
        shouldSave: z
          .boolean()
          .describe("是否应该保存（confidence < 0.4 设为 false）"),
        retrieval_triggers: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe("用户将来真实会问的句子，用于召回"),
        why_save: z
          .string()
          .describe("这条记忆在什么场景下会被用到"),
      }),
    )
    .max(3)
    .describe("提取的记忆列表，最多 3 条"),
});

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `你是一个记忆提取模块，从对话中识别值得长期保存的事实，输出结构化 JSON。

## 你的唯一任务

判断这段对话里，有哪些关于用户的事实，在未来的对话中会有用。

---

## 先做这个判断：值得提取吗？

以下情况直接返回 {"memories": []}，不要勉强提取：

- 纯技术问答，用户没有透露任何个人信息
- 信息可以从代码或文件实时获取
- 一次性任务，完成后不再有价值
- 用户只是表达了即时情绪，不是稳定偏好

值得提取的信号：
- 用户说出了关于自己的事实（我是谁、我喜欢什么、我的习惯）
- 用户明确纠正或认可了 AI 的某种做法，且应长期保持
- 用户提到了需要跨会话记住的约束或决策

---

## 类型判断

| 主语 | type |
|------|------|
| 用户自身（偏好/身份/习惯） | user |
| AI 的行为（该怎么做） | feedback |
| 项目约束或决策 | project |
| 外部工具或服务 | reference |

---

## 冲突检测

当新信息与现有记忆冲突时：

- **create**: 创建新记忆（无冲突）
- **update**: 新信息替代旧信息（如目的地从 A 改为 B）
- **delete**: 旧信息已完全过时
- **invalidate**: 旧信息可能过期但需保留历史

### 更新规则（重要）

1. **只追加新事实**：将用户新说出的事实追加到已有内容中，不要替换
2. **保留所有已知事实**：更新后的记忆必须包含旧记忆中的所有事实 + 新事实
3. **禁止推断性语言**：content 中不得使用"可能"、"暗示"、"表明"、"推测"等词语

示例：
- 旧记忆：用户喜欢凡人修仙传和灵笼
- 用户新说：凡人修仙传和火影忍者哪个对我更重要
- 正确更新：用户喜欢凡人修仙传和灵笼。用户表示凡人修仙传比火影忍者对他更重要。
- 错误更新：用户可能最喜欢凡人修仙传（❌ 推断 + 丢失灵笼信息）

---

## 提取后填写以下字段

**content**
用第三人称写用户实际说出的事实。不加推断词（"可能""也许""暗示"）。
如果是从行为推断的，在末尾注明：[推断依据：xxx]

**stability**
这条信息多久会失效？

- identity：极少变化（职业、出生地、长期偏好）
- pattern：跨场景的行为规律（学习方式、沟通习惯）
- state：和当前任务绑定（正在做的项目、近期目标）

**source / confidence**
- 用户亲口说出 → explicit，confidence: 0.9
- 从行为推断 → inferred，confidence: 0.3～0.6

confidence < 0.4 时，shouldSave 设为 false。

**retrieval_triggers**
写 2～3 条用户将来真实会问的句子，用于召回这条记忆。
写用户的原话风格，不要写关键词标签。

示例（关于称呼的记忆）：
✓ ["你叫我什么", "我叫什么名字", "怎么称呼我"]
✗ ["称呼", "身份", "角色"]

**why_save**
一句话：这条记忆在什么场景下会被用到？
写不出合理答案 → 不应该保存这条记忆。

---

## 示例

对话："我写东西喜欢先列大纲，把结构想清楚了再动笔。"

\`\`\`json
{
  "memories": [
    {
      "content": "用户写作时习惯先列大纲，结构确定后再动笔。",
      "type": "user",
      "stability": "pattern",
      "source": "explicit",
      "confidence": 0.9,
      "action": "create",
      "shouldSave": true,
      "retrieval_triggers": ["帮我写文章", "我的写作习惯是什么", "起草之前要做什么"],
      "why_save": "在写作类任务开始前，主动建议用户先列大纲，而不是直接开始写。"
    }
  ]
}
\`\`\`

---

## 输出规范

- 只输出 JSON，不输出任何解释
- 每次最多 3 条（只取最有价值的）
- shouldSave: false 的条目仍然输出
- 没有值得保存的内容时：{"memories": []}`;

export interface MemoryExtractionResult {
  memories: Array<{
    type: MemoryType;
    content: string;
    action: string;
    source: 'explicit' | 'inferred';
    confidence: number;
    stability: 'identity' | 'state' | 'pattern';
    retrieval_triggers: string[];
    why_save: string;
  }>;
  count: number;
}

/**
 * 从内容生成简短名称（取前 20 字符）
 */
function deriveName(content: string): string {
  const clean = content.replace(/\[推断依据.*?\]/g, '').trim();
  return clean.length > 20 ? clean.slice(0, 20) + '...' : clean;
}

/**
 * 从内容生成一行描述（取第一句）
 */
function deriveDescription(content: string): string {
  const firstSentence = content.split(/[。！？]/)[0];
  return firstSentence.length > 50 ? firstSentence.slice(0, 50) + '...' : firstSentence;
}

function formatConversationForPrompt(messages: UIMessage[]): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const textParts = m.parts
        .filter((p) => p.type === 'text' || p.type === 'reasoning')
        .map((p) =>
          p.type === 'text' || p.type === 'reasoning' ? p.text : '',
        )
        .filter(Boolean)
        .join('\n');

      const roleLabel = m.role === 'assistant' ? 'AI' : '用户';
      return `${roleLabel}: ${textParts}`;
    })
    .join('\n\n');
}

function formatExistingMemoriesPrompt(memories: Array<{ name: string; description: string; type: string; filename: string }>): string {
  if (memories.length === 0) {
    return '当前没有已保存的记忆。';
  }

  const lines: string[] = ['以下是当前已保存的记忆：', ''];
  for (const m of memories) {
    lines.push(`- [${m.type}] ${m.name} (${m.filename}): ${m.description}`);
  }
  lines.push('');
  lines.push('如果新信息与现有记忆冲突，请使用 update/delete/invalidate action。');
  return lines.join('\n');
}

export async function extractMemoriesFromConversation(
  messages: UIMessage[],
  userId: string,
  conversationId?: string,
  model?: LanguageModelV3,
  memoryBaseDir?: string,
  entrypointLimits?: EntrypointLimits,
): Promise<MemoryExtractionResult> {
  if (messages.length < 2) {
    return { memories: [], count: 0 };
  }

  try {
    const recentMessages = messages.slice(-20);
    const conversationText = formatConversationForPrompt(recentMessages);

    if (!memoryBaseDir) {
      return { memories: [], count: 0 };
    }

    const userDir = getUserMemoryDir(userId, memoryBaseDir);
    await ensureMemoryDirExists(userDir);

    // 获取现有记忆作为上下文
    const existingMemories = await scanMemoryFiles(userDir);
    const existingMemoriesPrompt = formatExistingMemoriesPrompt(
      existingMemories.map((m) => ({
        name: m.name,
        description: m.description,
        type: m.type,
        filename: m.filename,
      })),
    );

    const fullPrompt = `## 现有记忆

${existingMemoriesPrompt}

## 当前对话

${conversationText}`;

    const result = await generateText({
      model: requireModel(model),
      system: MEMORY_EXTRACTION_SYSTEM_PROMPT,
      prompt: fullPrompt,
      providerOptions: {
        openai: {
          response_format: { type: 'json_object' },
        },
      },
      output: Output.object({
        schema: memoryExtractionSchema,
      }),
    });

    const extraction = result.output;

    const savableMemories = extraction.memories.filter((m) => m.shouldSave);

    if (savableMemories.length === 0) {
      return { memories: [], count: 0 };
    }

    // 去重检查：跳过 5 分钟内已由 save_memory 工具保存的相似记忆
    const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 分钟
    const now = Date.now();

    const dedupedMemories = savableMemories.filter((memory) => {
      // 检查是否有同类型的记忆在 5 分钟内已保存
      const memoryName = deriveName(memory.content);
      const existing = existingMemories.find(
        (m) => m.type === memory.type && (m.name.includes(memoryName.slice(0, 10)) || memoryName.includes(m.name.slice(0, 10))),
      );
      if (existing) {
        const ageMs = now - existing.mtimeMs;
        if (ageMs < DEDUP_WINDOW_MS) {
          logger.debug(
            'MemoryCapture',
            `Skipping memory (${memory.type}) - similar memory saved ${Math.round(ageMs / 1000)}s ago`,
          );
          return false;
        }
      }
      return true;
    });

    if (dedupedMemories.length === 0) {
      return { memories: [], count: 0 };
    }

    const savedMemories: MemoryExtractionResult['memories'] = [];

    for (const memory of dedupedMemories.slice(0, 3)) {
      try {
        const name = deriveName(memory.content);
        const description = deriveDescription(memory.content);

        const memoryData: MemoryFileData = {
          name,
          description,
          type: memory.type,
          content: memory.content,
          source: memory.source,
          confidence: memory.confidence,
          stability: memory.stability,
        };

        if (memory.action === 'create') {
          await writeMemoryFile(userDir, memoryData, memory.content, entrypointLimits);
        } else if (memory.action === 'update' && memory.targetFilename) {
          await updateMemoryFile(userDir, memory.targetFilename, memoryData, memory.content, entrypointLimits);
        } else if (memory.action === 'delete' && memory.targetFilename) {
          await deleteMemoryWithCleanup(userDir, memory.targetFilename, entrypointLimits);
        } else if (memory.action === 'invalidate' && memory.targetFilename) {
          await invalidateMemoryFile(userDir, memory.targetFilename, memory.content, entrypointLimits);
        }

        savedMemories.push({
          type: memory.type,
          content: memory.content,
          action: memory.action,
          source: memory.source,
          confidence: memory.confidence,
          stability: memory.stability,
          retrieval_triggers: memory.retrieval_triggers,
          why_save: memory.why_save,
        });
      } catch (err) {
        logger.error(
          'MemoryCapture',
          `Failed to process memory (${memory.type}) (${memory.action}): ${err}`,
        );
      }
    }

    return {
      memories: savedMemories,
      count: savedMemories.length,
    };
  } catch (err) {
    logger.error('MemoryCapture', `Error: ${err}`);
    return { memories: [], count: 0 };
  }
}

export async function extractMemoriesInBackground(
  messages: UIMessage[],
  userId: string,
  conversationId?: string,
  model?: LanguageModelV3,
  memoryBaseDir?: string,
  entrypointLimits?: EntrypointLimits,
): Promise<void> {
  setImmediate(async () => {
    try {
      // 延迟 3 秒再调用 API，避免与主聊天请求和标题生成同时触发限速
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const result = await extractMemoriesFromConversation(
        messages,
        userId,
        conversationId,
        model,
        memoryBaseDir,
        entrypointLimits,
      );
      if (result.count > 0) {
        logger.debug(
          'MemoryCapture',
          `Saved ${result.count} memories for user ${userId}`,
        );
      }
    } catch (err) {
      logger.error('MemoryCapture', `Background extraction failed: ${err}`);
    }
  });
}
