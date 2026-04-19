import { tool } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { checkPermissionRules, validateWritePath } from '../permissions';

export const writeFileTool = tool({
  description: '创建或覆盖文件内容。自动创建父目录。如需追加内容请使用 append 模式。',
  inputSchema: z.object({
    filePath: z.string().describe('目标文件路径（相对于工作目录）'),
    content: z.string().describe('要写入的文件内容'),
    mode: z
      .enum(['overwrite', 'create', 'append'])
      .optional()
      .default('overwrite')
      .describe('写入模式: overwrite（覆盖/创建）, create（仅创建，存在则报错）, append（追加到末尾）'),
  }),
  needsApproval: async ({ filePath }) => {
    // Step 1: 检查持久化规则（Always allow）
    const matchedRule = checkPermissionRules('write_file', { filePath });
    if (matchedRule?.behavior === 'allow') {
      return false;  // 自动放行
    }
    if (matchedRule?.behavior === 'deny') {
      throw new Error(`操作被拒绝: ${matchedRule.pattern}`);
    }

    // Step 2: 路径安全检查（写入更严格）
    const pathCheck = validateWritePath(filePath);
    if (!pathCheck.allowed) {
      throw new Error(`路径安全阻止: ${pathCheck.reason}`);
    }

    // Step 3: 写入操作默认需要审批
    return true;
  },
  execute: async ({ filePath, content, mode = 'overwrite' }) => {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    await fs.mkdir(dir, { recursive: true });

    if (mode === 'create') {
      try {
        await fs.access(absolutePath);
        throw new Error(`文件已存在，无法以 create 模式创建: ${filePath}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('文件已存在')) {
          throw error;
        }
      }
    }

    const flag = mode === 'append' ? 'a' : 'w';
    await fs.writeFile(absolutePath, content, { encoding: 'utf-8', flag });

    const bytesWritten = Buffer.byteLength(content, 'utf-8');
    const isNewFile = mode !== 'append';

    return {
      path: filePath,
      bytesWritten,
      mode,
      created: isNewFile,
    };
  },
});