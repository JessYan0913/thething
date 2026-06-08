import { tool } from 'ai';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { checkPermissionRules, validateWritePath } from '../../modules/permissions';
import type { PathValidationOptions } from '../../modules/permissions';
import type { FileToolOptions } from './read';

const singleEditSchema = z.object({
  oldText: z.string().describe('要查找并替换的原始文本（必须与文件内容精确匹配）'),
  newText: z.string().describe('替换后的新文本'),
});

export function createEditFileTool(options: FileToolOptions = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  return tool({
  description:
    '使用搜索替换方式编辑文件。通过 edits 数组支持原子性批量编辑，所有编辑基于原始文件内容匹配（非增量）。',
  inputSchema: z.object({
    filePath: z.string().describe('要编辑的文件路径（相对于工作目录）'),
    edits: z.array(singleEditSchema).min(1).describe('替换操作数组。所有编辑基于原始文件内容匹配，支持原子性批量编辑。每个编辑不能与其它编辑重叠。'),
  }),
  needsApproval: async ({ filePath }) => {
    const matchedRule = checkPermissionRules('edit_file', { filePath }, options.permissionRules);
    if (matchedRule?.behavior === 'allow') {
      return false;
    }
    if (matchedRule?.behavior === 'deny') {
      return true;
    }
    return true;
  },
  execute: async ({ filePath, edits }) => {
    const pathCheck = validateWritePath(filePath, pathValidationOptions);
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
      };
    }

    const matchedRule = checkPermissionRules('edit_file', { filePath }, options.permissionRules);
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        path: filePath,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    const absolutePath = pathCheck.resolvedPath;
    const originalContent = await fs.readFile(absolutePath, 'utf-8');

    return executeEdits(absolutePath, filePath, originalContent, edits);
  },
  });
}

/**
 * 执行替换操作（基于原始文件内容）
 * 所有编辑都基于原始文件内容匹配，而不是增量匹配
 */
async function executeEdits(
  absolutePath: string,
  filePath: string,
  originalContent: string,
  edits: Array<{ oldText: string; newText: string }>,
) {
  // 验证所有编辑都基于原始文件内容
  const validationErrors: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (!originalContent.includes(edit.oldText)) {
      validationErrors.push(`Edit ${i + 1} not found: "${truncate(edit.oldText, 50)}"`);
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(
      `以下编辑在文件中未找到匹配项:\n${validationErrors.join('\n')}\n\n请确保所有 oldText 与文件内容完全匹配。`
    );
  }

  // 检查是否有重叠的编辑
  const overlapErrors = detectOverlappingEdits(originalContent, edits);
  if (overlapErrors.length > 0) {
    throw new Error(
      `检测到重叠的编辑:\n${overlapErrors.join('\n')}\n\n请将重叠的编辑合并为一个。`
    );
  }

  // 应用所有编辑（基于原始文件）
  let result = originalContent;
  const appliedEdits: Array<{ old: string; new: string; line?: number }> = [];

  for (const edit of edits) {
    const line = getLineNumber(originalContent, edit.oldText);
    result = result.replace(edit.oldText, edit.newText);
    appliedEdits.push({
      old: edit.oldText,
      new: edit.newText,
      line,
    });
  }

  // 防御性检查
  if (result === originalContent) {
    throw new Error('所有编辑都未改变内容，请检查 oldText 和 newText');
  }

  await fs.writeFile(absolutePath, result, 'utf-8');

  return {
    path: filePath,
    mode: 'multi' as const,
    editsApplied: appliedEdits.length,
    edits: appliedEdits.map(e => ({
      oldText: truncate(e.old, 100),
      newText: truncate(e.new, 100),
      line: e.line,
    })),
  };
}

/**
 * 检测重叠的编辑
 */
function detectOverlappingEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string }>,
): string[] {
  const errors: string[] = [];
  const usedRanges: Array<{ start: number; end: number }> = [];

  for (const edit of edits) {
    let searchStart = 0;
    while (true) {
      const index = content.indexOf(edit.oldText, searchStart);
      if (index === -1) break;

      const start = index;
      const end = index + edit.oldText.length;

      // 检查是否与已使用的范围重叠
      for (const range of usedRanges) {
        if (start < range.end && end > range.start) {
          errors.push(`编辑 "${truncate(edit.oldText, 30)}" 与之前的编辑重叠`);
          break;
        }
      }

      searchStart = end;
    }

    // 记录这个编辑的所有匹配位置
    searchStart = 0;
    while (true) {
      const index = content.indexOf(edit.oldText, searchStart);
      if (index === -1) break;
      usedRanges.push({ start: index, end: index + edit.oldText.length });
      searchStart = index + edit.oldText.length;
    }
  }

  return errors;
}

/**
 * 获取文本在内容中的行号
 */
function getLineNumber(content: string, searchText: string): number | undefined {
  const index = content.indexOf(searchText);
  if (index === -1) return undefined;

  const lines = content.slice(0, index).split('\n');
  return lines.length;
}

/**
 * 截断文本
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

