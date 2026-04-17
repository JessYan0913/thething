import fs from "fs/promises";
import path from "path";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { getUserMemoryDir, ensureMemoryDirExists } from "./paths";
import { formatMemoryFrontmatter, type MemoryType } from "./memory-types";
import { scanMemoryFiles } from "./memory-scan";
import { appendToEntrypoint, rebuildEntrypoint, deleteMemoryFile } from "./memdir";
import { createMemoryRecord, deleteMemoryRecordByPath } from "./store";
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
        action: z
          .enum(["create", "update", "delete", "invalidate"])
          .describe("操作类型: create=新记忆, update=替换现有记忆, delete=删除过时记忆, invalidate=标记过期"),
        targetFilename: z
          .string()
          .optional()
          .describe("要更新/删除的目标文件名（如 user_偏好.md）"),
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

## 冲突检测

当新信息与现有记忆冲突时，请选择合适的 action：

- **create**: 创建新记忆（无冲突）
- **update**: 新信息完全替代旧信息（如目的地从 A 改为 B）
- **delete**: 旧信息已完全过时/不再需要
- **invalidate**: 旧信息可能过期但需要保留历史（标记为已过期）

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
- action: 操作类型 (create/update/delete/invalidate)
- targetFilename: 目标文件名（update/delete/invalidate 时必填）
- shouldSave: 是否应该保存

示例输出格式：
{"memories": [{"name": "偏好", "description": "用户偏好", "type": "user", "content": "内容", "action": "create", "shouldSave": true}]}

只提取真正有价值的记忆。如果没有值得保存的记忆，返回空数组：{"memories": []}`;

export interface MemoryExtractionResult {
  memories: Array<{
    name: string;
    description: string;
    type: MemoryType;
    content: string;
    action: string;
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

function formatExistingMemoriesPrompt(memories: Array<{ name: string; description: string; type: string; filename: string }>): string {
  if (memories.length === 0) {
    return "当前没有已保存的记忆。";
  }

  const lines: string[] = ["以下是当前已保存的记忆：", ""];
  for (const m of memories) {
    lines.push(`- [${m.type}] ${m.name} (${m.filename}): ${m.description}`);
  }
  lines.push("");
  lines.push("如果新信息与现有记忆冲突，请使用 update/delete/invalidate action。");
  return lines.join("\n");
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

    const userDir = getUserMemoryDir(userId);
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
      model: dashscope("qwen-plus"),
      system: MEMORY_EXTRACTION_SYSTEM_PROMPT,
      prompt: fullPrompt,
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

    const savedMemories: Array<{
      name: string;
      description: string;
      type: MemoryType;
      content: string;
      action: string;
    }> = [];

    for (const memory of savableMemories.slice(0, 5)) {
      const fileName = `${memory.type}_${memory.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "_").toLowerCase()}.md`;

      try {
        if (memory.action === "create") {
          // 创建新记忆
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
        } else if (memory.action === "update" && memory.targetFilename) {
          // 更新：删除旧文件，创建新文件，重建索引
          const oldFilePath = path.join(userDir, memory.targetFilename);
          await deleteMemoryRecordByPath(oldFilePath);
          await fs.unlink(oldFilePath).catch(() => {});

          const newFilePath = path.join(userDir, fileName);
          const fileContent =
            formatMemoryFrontmatter({
              name: memory.name,
              description: memory.description,
              type: memory.type,
              content: memory.content,
            }) +
            "\n\n" +
            memory.content;

          await fs.writeFile(newFilePath, fileContent, "utf-8");
          await rebuildEntrypoint(userDir);
          createMemoryRecord({
            ownerType: "user",
            ownerId: userId,
            memoryType: memory.type,
            name: memory.name,
            description: memory.description,
            filePath: newFilePath,
          });
        } else if (memory.action === "delete" && memory.targetFilename) {
          // 删除：删除文件和数据库记录，重建索引
          const filePath = path.join(userDir, memory.targetFilename);
          await deleteMemoryRecordByPath(filePath);
          await deleteMemoryFile(userDir, memory.targetFilename);
        } else if (memory.action === "invalidate" && memory.targetFilename) {
          // 标记过期：在内容前添加过期标记
          const filePath = path.join(userDir, memory.targetFilename);
          try {
            const existingContent = await fs.readFile(filePath, "utf-8");
            const invalidatedContent = existingContent.replace(
              /^---\n/,
              "---\nstatus: invalidated\ninvalidated_reason: ",
            ) + `\n\n[此记忆已过期，原因: ${memory.content}]`;
            await fs.writeFile(filePath, invalidatedContent, "utf-8");
            await rebuildEntrypoint(userDir);
          } catch {
            // 文件不存在，跳过
          }
        }

        savedMemories.push({
          name: memory.name,
          description: memory.description,
          type: memory.type,
          content: memory.content,
          action: memory.action,
        });
      } catch (err) {
        console.error(
          `[Memory Extractor] Failed to process memory "${memory.name}" (${memory.action}):`,
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
