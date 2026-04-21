import { tool } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { checkPermissionRules, validateWritePath } from '../permissions';

export const editFileTool = tool({
  description:
    '使用搜索替换方式编辑文件。指定要查找的原文字符串和替换后的新字符串。若原文出现多次可设置 replaceFirst 控制替换范围。',
  inputSchema: z.object({
    filePath: z.string().describe('要编辑的文件路径（相对于工作目录）'),
    oldString: z.string().describe('要查找并替换的原始文本（必须与文件内容精确匹配）'),
    newString: z.string().describe('替换后的新文本'),
    replaceAll: z.boolean().optional().default(false).describe('是否替换所有匹配项（默认仅替换第一个）'),
  }),
  needsApproval: async ({ filePath }) => {
    // Step 1: 检查持久化规则（Always allow）
    const matchedRule = checkPermissionRules('edit_file', { filePath });
    if (matchedRule?.behavior === 'allow') {
      return false;  // 自动放行
    }
    if (matchedRule?.behavior === 'deny') {
      // 不抛出错误，返回 true 让审批流程处理，或让 execute 返回错误结果
      return true;
    }

    // Step 2: 编辑操作默认需要审批
    return true;
  },
  execute: async ({ filePath, oldString, newString, replaceAll = false }) => {
    // Step 1: 路径安全检查（移到 execute 中，返回错误结果而非抛出错误）
    const pathCheck = validateWritePath(filePath);
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
      };
    }

    // Step 2: 检查 deny 规则
    const matchedRule = checkPermissionRules('edit_file', { filePath });
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        path: filePath,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    const absolutePath = filePath.startsWith('/') ? filePath : path.resolve(filePath);

    const content = await fs.readFile(absolutePath, 'utf-8');

    const matchCount = (content.match(new RegExp(escapeRegex(oldString), 'g')) || []).length;
    if (matchCount === 0) {
      throw new Error(
        `在文件中未找到要替换的文本: ${filePath}\n\n请确认 oldString 与文件内容完全匹配（包括空格、换行）。`,
      );
    }

    let result: string;
    let replacements: number;

    if (replaceAll) {
      result = content.split(oldString).join(newString);
      replacements = matchCount;
    } else {
      const index = content.indexOf(oldString);
      result = content.slice(0, index) + newString + content.slice(index + oldString.length);
      replacements = 1;
    }

    if (result === content) {
      throw new Error(`替换未改变内容，请检查 oldString 和 newString`);
    }

    await fs.writeFile(absolutePath, result, 'utf-8');

    return {
      path: filePath,
      replacements,
      occurrences: matchCount,
      oldString: oldString.length > 100 ? oldString.slice(0, 100) + '...' : oldString,
      newString: newString.length > 100 ? newString.slice(0, 100) + '...' : newString,
    };
  },
});

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}