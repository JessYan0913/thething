import { tool } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { checkPermissionRules, validateWritePath } from '../../modules/permissions';
import type { PathValidationOptions } from '../../modules/permissions';
import type { FileToolOptions } from './read';

// 文件类型到语言的映射（用于代码高亮）
const FILE_TYPE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.dockerfile': 'dockerfile',
  '.docker': 'dockerfile',
};

/**
 * 获取文件的语言类型
 */
function getLanguageFromFile(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // 特殊文件名
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === 'gemfile') return 'ruby';
  if (basename === 'rakefile') return 'ruby';

  return FILE_TYPE_MAP[ext];
}

/**
 * 格式化文件内容预览
 */
function formatContentPreview(content: string, maxLines: number = 5): string {
  const lines = content.split('\n');
  const previewLines = lines.slice(0, maxLines);

  const numbered = previewLines
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  if (lines.length > maxLines) {
    return `${numbered}\n... (${lines.length - maxLines} more lines)`;
  }
  return numbered;
}

/**
 * 分析内容统计
 */
function analyzeContent(content: string): {
  lines: number;
  words: number;
  bytes: number;
  blankLines: number;
  codeLines: number;
} {
  const lines = content.split('\n');
  const words = content.split(/\s+/).filter(w => w.length > 0).length;
  const bytes = Buffer.byteLength(content, 'utf-8');
  const blankLines = lines.filter(l => l.trim().length === 0).length;
  const codeLines = lines.filter(l => l.trim().length > 0 && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;

  return { lines: lines.length, words, bytes, blankLines, codeLines };
}

export function createWriteFileTool(options: FileToolOptions = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  return tool({
  description: '创建或覆盖文件内容。自动创建父目录。支持三种模式：overwrite（覆盖/创建）、create（仅创建）、append（追加）。',
  inputSchema: z.object({
    filePath: z.string().describe('目标文件路径（相对于工作目录）'),
    content: z.string().describe('要写入的文件内容'),
    mode: z
      .enum(['overwrite', 'create', 'append'])
      .optional()
      .default('overwrite')
      .describe('写入模式: overwrite（覆盖/创建）, create（仅创建，存在则报错）, append（追加到末尾）'),
  }),
  execute: async ({ filePath, content, mode = 'overwrite' }) => {
    // Step 1: 路径安全检查（移到 execute 中，返回错误结果而非抛出错误）
    const pathCheck = validateWritePath(filePath, pathValidationOptions);
    if (!pathCheck.allowed) {
      return {
        error: true,
        path: filePath,
        message: `路径安全阻止: ${pathCheck.reason}`,
      };
    }

    // Step 2: 检查 deny 规则
    const matchedRule = checkPermissionRules('write_file', { filePath }, options.permissionRules);
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        path: filePath,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    const absolutePath = pathCheck.resolvedPath;
    const dir = path.dirname(absolutePath);

    // 检查是否是追加模式，如果是，读取现有内容
    let existingContent = '';
    if (mode === 'append') {
      try {
        existingContent = await fs.readFile(absolutePath, 'utf-8');
      } catch {
        // 文件可能不存在，忽略错误
      }
    }

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
    const isNewFile = mode !== 'append' && existingContent.length === 0;

    // 分析内容
    const stats = analyzeContent(content);

    // 检查文件是否已存在
    let fileExists = false;
    try {
      await fs.access(absolutePath);
      fileExists = true;
    } catch {
      // 文件不存在
    }

    // 构建结果
    const result: Record<string, unknown> = {
      path: filePath,
      bytesWritten,
      mode,
      created: isNewFile,
      exists: fileExists,
      stats: {
        lines: stats.lines,
        words: stats.words,
        codeLines: stats.codeLines,
        blankLines: stats.blankLines,
      },
    };

    // 添加语言信息
    const language = getLanguageFromFile(filePath);
    if (language) {
      result.language = language;
    }

    // 添加内容预览（最多 5 行）
    if (content.length > 0) {
      result.preview = formatContentPreview(content, 5);
    }

    // 追加模式时显示原有大小
    if (mode === 'append' && existingContent.length > 0) {
      result.previousSize = Buffer.byteLength(existingContent, 'utf-8');
      result.newTotalSize = Buffer.byteLength(existingContent + content, 'utf-8');
    }

    return result;
  },
  });
}
