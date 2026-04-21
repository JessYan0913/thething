import { tool } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { checkPermissionRules, validatePath } from '../permissions';

const MAX_CHARS = 50_000;

export const readFileTool = tool({
  description: '读取文件内容并返回带行号的文本。用于查看源代码、配置文件或文本文件。最大返回 50,000 字符。',
  inputSchema: z.object({
    filePath: z.string().describe('要读取的文件路径（相对于工作目录）'),
  }),
  needsApproval: async ({ filePath }) => {
    // Step 1: 检查持久化规则（Always allow）
    const matchedRule = checkPermissionRules('read_file', { filePath });
    if (matchedRule?.behavior === 'allow') {
      return false;  // 自动放行
    }
    if (matchedRule?.behavior === 'deny') {
      // 不抛出错误，返回 true 让审批流程处理，或让 execute 返回错误结果
      return true;
    }

    // Step 2: 其他路径需要审批
    return true;
  },
  execute: async ({ filePath }) => {
    // Step 1: 路径安全检查（移到 execute 中，返回错误结果而非抛出错误）
    const pathCheck = validatePath(filePath);
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
      };
    }

    // Step 2: 检查 deny 规则
    const matchedRule = checkPermissionRules('read_file', { filePath });
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        path: filePath,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    const absolutePath = path.resolve(filePath);

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`路径不是一个文件: ${filePath}`);
    }

    if (stat.size > MAX_CHARS * 2) {
      throw new Error(
        `文件过大 (${(stat.size / 1024).toFixed(1)}KB)，超出 ${MAX_CHARS} 字符限制。请使用 grep 搜索特定内容。`,
      );
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    const maxLines = Math.min(lines.length, Math.floor(MAX_CHARS / 50));
    const truncated = lines.length > maxLines;

    const numberedLines = lines
      .slice(0, maxLines)
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');

    const result = truncated
      ? `${numberedLines}\n\n... (文件共 ${lines.length} 行，仅显示前 ${maxLines} 行) ...`
      : numberedLines;

    return {
      path: filePath,
      content: result,
      totalLines: lines.length,
      encoding: 'utf-8',
    };
  },
});