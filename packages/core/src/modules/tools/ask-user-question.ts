import { tool } from "ai";
import { z } from "zod";

const questionSchema = z.object({
  question: z.string().describe("要向用户提出的问题"),
  header: z
    .string()
    .max(12)
    .describe('问题的简短标签，显示为标签/芯片（如 "Auth method", "Library"）'),
  options: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe("可选的答案列表，至少2个，最多4个"),
  multiSelect: z.boolean().optional().default(false).describe("是否允许多选"),
});

const answerSchema = z.object({
  question: z.string().describe("原问题文本"),
  answer: z
    .union([z.string(), z.array(z.string())])
    .describe("用户的回答；多选为数组，自定义输入为自由文本"),
});

/**
 * 客户端工具（无 execute）：AI SDK 遇到该调用时暂停 agent 循环，
 * 流以 input-available 状态结束；前端答题面板收集答案后调
 * addToolOutput({toolCallId, output}) 回写并自动续跑。
 * 用户取消 → addToolOutput({state: 'output-error', errorText})，
 * 模型看到明确的取消信息而非伪造的空答案。
 */
export const askUserQuestionTool = tool({
  description: `向用户提问以收集偏好、需求或澄清模糊指令。

提问是最后手段：能通过搜索代码、读取文件、运行测试、查阅记忆或上下文得出答案的，不要问用户；对合理的方案主动执行，不必停下来等确认。

适用场景：涉及个人偏好或主观选择且现有信息不足以合理判断、用户明确表达犹豫（如"不确定"、"帮我选"）、多种可行方案且选择会显著影响产出。问题应清晰具体，选项简洁（2-4 个）。`,
  inputSchema: z.object({
    questions: z
      .array(questionSchema)
      .min(1)
      .max(4)
      .describe("要问用户的问题列表，最多4个"),
  }),
  outputSchema: z.object({
    answers: z
      .array(answerSchema)
      .describe("与 questions 顺序对齐的问答对列表"),
  }),
});

export type AskUserQuestionInput = z.infer<
  typeof askUserQuestionTool.inputSchema
>;
export type AskUserQuestionOutput = {
  answers: Array<z.infer<typeof answerSchema>>;
};

/**
 * 修复模型把 questions 数组序列化为 JSON 字符串（甚至截断的字符串）的问题。
 * 注意：experimental_refineToolInput 只在 schema 校验成功后执行，对
 * InvalidToolInputError 无效；校验失败时的修复钩子是 experimental_repairToolCall，
 * 本函数供其使用。入参是模型输出的原始 input JSON 文本。
 * 返回修复后的 input JSON 文本；无法修复时返回 null（保留原错误让模型自我修正）。
 */
export function repairAskUserQuestionRawInput(rawInput: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(rawInput);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const questions = (obj as { questions?: unknown }).questions;
  if (typeof questions !== "string") return null;
  // 实际观测：模型输出的字符串常被截断（缺少收尾括号），依次尝试补全
  for (const suffix of ["", "]", "}]", '"}]']) {
    try {
      const parsed = JSON.parse(questions + suffix);
      if (!Array.isArray(parsed)) return null;
      return JSON.stringify({ ...(obj as object), questions: parsed });
    } catch {
      // 尝试下一个补全
    }
  }
  return null;
}
