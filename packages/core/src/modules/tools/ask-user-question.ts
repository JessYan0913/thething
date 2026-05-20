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

export const askUserQuestionTool = tool({
  description: `向用户提问以收集偏好、需求或澄清模糊指令。

【使用原则】
- 先自己调查：能通过搜索代码、读取文件、运行测试等手段得出答案的，不要问用户
- 实在无法判断时才提问，不要把此工具当作遇到摩擦的第一反应
- 对合理的方案主动执行，不必停下来等用户确认

【适用场景】
- 涉及用户个人偏好或主观选择（风格、技术栈、路线等），且当前信息不足以做出合理判断
- 用户明确表达了犹豫（如"不确定"、"帮我选"）
- 存在多种可行方案且选择结果会显著影响最终产出

【注意事项】
- 使用此工具前先检查是否已有相关记忆或上下文信息可以参考
- 问题应该清晰具体，选项简洁明了（2-4个）`,
  inputSchema: z.object({
    questions: z
      .array(questionSchema)
      .min(1)
      .max(4)
      .describe("要问用户的问题列表，最多4个"),
  }),
  needsApproval: async () => true,
  execute: async (_input, options) => {
    const answers = extractAnswers(options);
    return {
      answers,
      timestamp: Date.now(),
    };
  },
});

function extractAnswers(options: {
  messages: Array<{ role: string; content: unknown }>;
}): Record<string, string | string[]> {
  const lastMsg = options.messages.at(-1);
  if (lastMsg?.role !== "tool" || Array.isArray(lastMsg.content) === false)
    return {};
  const approvalResp = (
    lastMsg.content as Array<{ type?: string; reason?: string }>
  ).find((p) => p.type === "tool-approval-response" && p.reason);
  if (!approvalResp?.reason) return {};
  try {
    return JSON.parse(approvalResp.reason).answers ?? {};
  } catch {
    return {};
  }
}

export type AskUserQuestionInput = z.infer<
  typeof askUserQuestionTool.inputSchema
>;
export type AskUserQuestionOutput = {
  questions: Array<z.infer<typeof questionSchema>>;
  answers: Record<string, string | string[]>;
  timestamp: number;
};
