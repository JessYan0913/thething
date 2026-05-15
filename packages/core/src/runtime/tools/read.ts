import { tool } from 'ai';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { checkPermissionRules, validatePath } from '../../extensions/permissions';
import type { PermissionRule } from '../../extensions/permissions/types';
import type { PathValidationOptions } from '../../extensions/permissions';

export interface FileToolOptions {
  cwd?: string;
  extraSensitivePaths?: readonly string[];
  permissionRules?: readonly PermissionRule[];
}

export function createReadFileTool(options: FileToolOptions = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  return tool({
  description: '读取文件内容并返回带行号的文本。用于查看源代码、配置文件或文本文件。',
  inputSchema: z.object({
    filePath: z.string().describe('要读取的文件路径（相对于工作目录）'),
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
  execute: async ({ filePath }) => {
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
    const lines = content.split('\n');

    const numberedLines = lines
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');

    return {
      path: filePath,
      content: numberedLines,
      totalLines: lines.length,
      encoding: 'utf-8',
    };
  },
  });
}
