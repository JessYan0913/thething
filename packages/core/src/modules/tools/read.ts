import { tool } from 'ai';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { checkPermissionRules, validatePath } from '../../modules/permissions';
import type { PermissionRule } from '../../modules/permissions/types';
import type { PathValidationOptions } from '../../modules/permissions';

export interface FileToolOptions {
  cwd?: string;
  extraSensitivePaths?: readonly string[];
  permissionRules?: readonly PermissionRule[];
}

// 智能截断配置
const TRUNCATION_CONFIG = {
  MAX_LINES: 500,           // 最大行数
  MAX_BYTES: 50 * 1024,     // 最大字节数 (50KB)
  LINE_BYTE_LIMIT: 1000,    // 单行字节限制
};

/**
 * 截断结果信息
 */
interface TruncationResult {
  truncated: boolean;
  reason?: 'lines' | 'bytes' | 'single_line';
  originalLines?: number;
  shownLines?: number;
  originalBytes?: number;
  shownBytes?: number;
}

/**
 * 智能截断文本
 */
function truncateContent(
  content: string,
  startLine: number,
  totalLines: number,
  userLimit?: number,
): { text: string; truncation: TruncationResult } {
  const lines = content.split('\n');
  const truncation: TruncationResult = { truncated: false };

  // 应用用户限制
  let selectedLines: string[];
  if (userLimit !== undefined) {
    selectedLines = lines.slice(0, userLimit);
    truncation.originalLines = totalLines;
    truncation.shownLines = selectedLines.length;
  } else {
    selectedLines = lines;
  }

  // 检查单行是否过长
  for (let i = 0; i < selectedLines.length; i++) {
    const lineBytes = Buffer.byteLength(selectedLines[i]!, 'utf-8');
    if (lineBytes > TRUNCATION_CONFIG.LINE_BYTE_LIMIT) {
      truncation.truncated = true;
      truncation.reason = 'single_line';
      // 截断该行
      selectedLines[i] = selectedLines[i]!.slice(0, TRUNCATION_CONFIG.LINE_BYTE_LIMIT) + '... [truncated]';
    }
  }

  // 检查行数限制
  if (selectedLines.length > TRUNCATION_CONFIG.MAX_LINES) {
    truncation.truncated = true;
    truncation.reason = 'lines';
    truncation.originalLines = truncation.originalLines ?? totalLines;
    truncation.shownLines = TRUNCATION_CONFIG.MAX_LINES;
    selectedLines = selectedLines.slice(0, TRUNCATION_CONFIG.MAX_LINES);
  }

  // 检查字节限制
  let contentText = selectedLines.join('\n');
  const contentBytes = Buffer.byteLength(contentText, 'utf-8');
  if (contentBytes > TRUNCATION_CONFIG.MAX_BYTES) {
    truncation.truncated = true;
    truncation.reason = 'bytes';
    truncation.originalBytes = contentBytes;

    // 逐行截断直到低于限制
    let bytes = 0;
    let lineIndex = 0;
    for (let i = 0; i < selectedLines.length; i++) {
      const lineBytes = Buffer.byteLength(selectedLines[i]!, 'utf-8') + 1; // +1 for newline
      if (bytes + lineBytes > TRUNCATION_CONFIG.MAX_BYTES) {
        break;
      }
      bytes += lineBytes;
      lineIndex = i + 1;
    }
    selectedLines = selectedLines.slice(0, lineIndex);
    truncation.shownLines = selectedLines.length;
    truncation.shownBytes = bytes;
    contentText = selectedLines.join('\n');
  }

  // 添加行号
  const numberedLines = selectedLines
    .map((line, i) => `${startLine + i + 1}: ${line}`)
    .join('\n');

  return { text: numberedLines, truncation };
}

/**
 * 格式化截断提示
 */
function formatTruncationHint(
  truncation: TruncationResult,
  startLine: number,
  totalLines: number,
  filePath: string,
): string {
  if (!truncation.truncated) return '';

  const endLine = startLine + (truncation.shownLines ?? 0);
  const nextOffset = endLine + 1;

  const hints: string[] = [];

  if (truncation.reason === 'single_line') {
    hints.push(`[注意：某行内容过长已被截断]`);
  }

  if (truncation.reason === 'lines' || truncation.reason === 'bytes') {
    const shown = truncation.shownLines ?? 0;
    const total = truncation.originalLines ?? totalLines;
    hints.push(`[显示第 ${startLine + 1}-${endLine} 行，共 ${total} 行]`);
    hints.push(`[使用 offset=${nextOffset} 继续读取]`);
  }

  // 用户限制的情况
  if (truncation.shownLines !== undefined && truncation.shownLines < totalLines - startLine) {
    const remaining = totalLines - endLine;
    if (remaining > 0) {
      hints.push(`[文件还有 ${remaining} 行未显示，使用 offset=${nextOffset} 继续]`);
    }
  }

  return hints.length > 0 ? '\n\n' + hints.join('\n') : '';
}

export function createReadFileTool(options: FileToolOptions = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  return tool({
  description: `读取文件内容并返回带行号的文本。支持以下特性：
- 智能截断：大文件自动截断到 ${TRUNCATION_CONFIG.MAX_LINES} 行或 ${TRUNCATION_CONFIG.MAX_BYTES / 1024}KB
- 精确读取：使用 offset 和 limit 参数读取特定行范围
- 继续读取：截断时提示使用 offset 继续`,
  inputSchema: z.object({
    filePath: z.string().describe('要读取的文件路径（相对于工作目录）'),
    offset: z.number().optional().describe('起始行号（从 1 开始，默认从文件开头读取）'),
    limit: z.number().optional().describe('最大读取行数（默认无限制，受智能截断约束）'),
  }),
  needsApproval: async ({ filePath }) => {
    // Step 1: 检查持久化规则（Always allow）
    const matchedRule = checkPermissionRules('read_file', { filePath }, options.permissionRules);
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
  execute: async ({ filePath, offset, limit }) => {
    // Step 1: 路径安全检查（移到 execute 中，返回错误结果而非抛出错误）
    const pathCheck = validatePath(filePath, pathValidationOptions);
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
      };
    }

    // Step 2: 检查 deny 规则
    const matchedRule = checkPermissionRules('read_file', { filePath }, options.permissionRules);
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        path: filePath,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    const absolutePath = pathCheck.resolvedPath;

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`路径不是一个文件: ${filePath}`);
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    // 处理 offset（从 1-indexed 转换为 0-indexed）
    const startLine = offset ? Math.max(0, offset - 1) : 0;

    // 检查 offset 是否超出文件范围
    if (startLine >= totalLines) {
      throw new Error(`Offset ${offset} 超出文件范围（文件共 ${totalLines} 行）`);
    }

    // 获取指定范围的内容
    let selectedContent: string;
    if (limit !== undefined) {
      const endLine = Math.min(startLine + limit, totalLines);
      selectedContent = allLines.slice(startLine, endLine).join('\n');
    } else {
      selectedContent = allLines.slice(startLine).join('\n');
    }

    // 智能截断
    const { text: numberedContent, truncation } = truncateContent(
      selectedContent,
      startLine,
      totalLines,
      limit,
    );

    // 构建结果
    const result: Record<string, unknown> = {
      path: filePath,
      content: numberedContent + formatTruncationHint(truncation, startLine, totalLines, filePath),
      totalLines,
      startLine: startLine + 1,
      shownLines: truncation.shownLines ?? Math.min(totalLines - startLine, limit ?? totalLines),
      encoding: 'utf-8',
      truncated: truncation.truncated,
    };

    // 添加截断详情
    if (truncation.truncated) {
      result.truncationInfo = {
        reason: truncation.reason,
        ...(truncation.originalLines && { originalLines: truncation.originalLines }),
        ...(truncation.shownLines && { shownLines: truncation.shownLines }),
        ...(truncation.originalBytes && { originalBytes: truncation.originalBytes }),
        ...(truncation.shownBytes && { shownBytes: truncation.shownBytes }),
      };
    }

    // 添加继续读取提示
    const endLine = startLine + (truncation.shownLines ?? allLines.length - startLine);
    if (endLine < totalLines) {
      result.nextOffset = endLine + 1;
      result.hasMore = true;
    }

    return result;
  },
  });
}
