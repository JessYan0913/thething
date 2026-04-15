import fs from "fs/promises";
import path from "path";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { getUserMemoryDir, ensureMemoryDirExists } from "./paths";
import { formatMemoryFrontmatter, type MemoryType } from "./memory-types";
import { appendToEntrypoint } from "./memdir";
import { createMemoryRecord } from "./store";
import type { UIMessage } from "ai";

const dashscope = createOpenAICompatible({
  name: "dashscope",
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: process.env.DASHSCOPE_BASE_URL!,
});

const memoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        name: z.string().describe("记忆名称（简洁描述性）"),
        description: z.string().describe("一行描述"),
        type: z
          .enum(["user", "feedback", "project", "reference"])
          .describe("记忆类型"),
        content: z
          .string()
          .describe("记忆内容（只存储无法从项目状态推导的信息）"),
        shouldSave: z
          .boolean()
          .describe("是否应该保存（如果信息可从代码推导则为 false）"),
      }),
    )
    .describe("提取的记忆列表"),
});

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `你是一个记忆提取助手。请从对话中提取值得持久化的记忆。

## 记忆类型

### user（用户记忆）
用户表达了个人偏好、技术背景、角色信息。

### feedback（反馈记忆）
用户纠正了 AI 的行为，或认可了 AI 的做法。

### project（项目记忆）
用户提到非代码可推导的项目约束、决策或流程。

### reference（参考记忆）
用户提到外部工具、服务、流程。

## 什么 NOT 要保存
- 代码模式（可以从代码推导）
- 文件结构（可以实时查看）
- Git 历史（可以 git log 查看）
- 临时性任务信息

## 输出格式
请按照 json 格式输出，包含 memories 数组。每个记忆包含：
- name: 简洁描述性名称
- description: 一行描述
- type: 记忆类型 (user/feedback/project/reference)
- content: 详细记忆内容
- shouldSave: 是否应该保存（如果信息可从代码推导则为 false）

示例输出格式：
{"memories": [{"name": "偏好", "description": "用户偏好", "type": "user", "content": "内容", "shouldSave": true}]}

只提取真正有价值的记忆。如果没有值得保存的记忆，返回空数组：{"memories": []}`;

export interface MemoryExtractionResult {
  memories: Array<{
    name: string;
    description: string;
    type: MemoryType;
    content: string;
  }>;
  count: number;
}

function formatConversationForPrompt(messages: UIMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const textParts = m.parts
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) =>
          p.type === "text" || p.type === "reasoning" ? p.text : "",
        )
        .filter(Boolean)
        .join("\n");

      const roleLabel = m.role === "assistant" ? "AI" : "用户";
      return `${roleLabel}: ${textParts}`;
    })
    .join("\n\n");
}

export async function extractMemoriesFromConversation(
  messages: UIMessage[],
  userId: string,
  conversationId?: string,
): Promise<MemoryExtractionResult> {
  if (messages.length < 2) {
    return { memories: [], count: 0 };
  }

  try {
    const recentMessages = messages.slice(-20);
    const conversationText = formatConversationForPrompt(recentMessages);

    const result = await generateText({
      model: dashscope("qwen-plus"),
      system: MEMORY_EXTRACTION_SYSTEM_PROMPT,
      prompt: conversationText,
      providerOptions: {
        openai: {
          response_format: { type: "json_object" },
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

    const userDir = getUserMemoryDir(userId);
    await ensureMemoryDirExists(userDir);

    const savedMemories: Array<{
      name: string;
      description: string;
      type: MemoryType;
      content: string;
    }> = [];

    for (const memory of savableMemories.slice(0, 5)) {
      const fileName = `${memory.type}_${memory.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "_").toLowerCase()}.md`;
      const filePath = path.join(userDir, fileName);

      const fileContent =
        formatMemoryFrontmatter({
          name: memory.name,
          description: memory.description,
          type: memory.type,
          content: memory.content,
        }) +
        "\n\n" +
        memory.content;

      try {
        await fs.writeFile(filePath, fileContent, "utf-8");

        await appendToEntrypoint(userDir, {
          filename: fileName,
          name: memory.name,
          description: memory.description,
          type: memory.type,
        });

        createMemoryRecord({
          ownerType: "user",
          ownerId: userId,
          memoryType: memory.type,
          name: memory.name,
          description: memory.description,
          filePath,
        });

        savedMemories.push({
          name: memory.name,
          description: memory.description,
          type: memory.type,
          content: memory.content,
        });
      } catch (err) {
        console.error(
          `[Memory Extractor] Failed to save memory "${memory.name}":`,
          err,
        );
      }
    }

    return {
      memories: savedMemories,
      count: savedMemories.length,
    };
  } catch (err) {
    console.error("[Memory Extraction] Error:", err);
    return { memories: [], count: 0 };
  }
}

export async function extractMemoriesInBackground(
  messages: UIMessage[],
  userId: string,
  conversationId?: string,
): Promise<void> {
  setImmediate(async () => {
    try {
      const result = await extractMemoriesFromConversation(
        messages,
        userId,
        conversationId,
      );
      if (result.count > 0) {
        console.log(
          `[Memory Extraction] Saved ${result.count} memories for user ${userId}`,
        );
      }
    } catch (err) {
      console.error("[Memory Extraction] Background extraction failed:", err);
    }
  });
}
