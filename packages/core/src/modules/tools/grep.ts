import { tool } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

let rgAvailable: boolean | null = null;

async function checkRgAvailable(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;

  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync('rg --version');
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }

  return rgAvailable;
}

interface GrepMatch {
  file: string;
  line: number;
  content: string;
  // context 相关字段
  before?: string[];   // 匹配行之前的 N 行
  after?: string[];    // 匹配行之后的 N 行
}

interface FileLineCache {
  lines: string[];
}

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  ignoreCase: boolean,
  includePattern?: string,
  contextLines?: number,
): Promise<GrepMatch[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const args = ['--json', '--no-heading'];
  if (ignoreCase) args.push('-i');
  if (includePattern) args.push('--glob', includePattern);
  if (contextLines && contextLines > 0) args.push('-C', String(contextLines));
  args.push(pattern, searchPath);

  const { stdout } = await execAsync(`rg ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
    encoding: 'utf-8',
    maxBuffer: 50_000_000,
  });

  const matches: GrepMatch[] = [];
  const fileCaches = new Map<string, FileLineCache>();

  // 获取文件内容的缓存
  const getFileLines = async (filePath: string): Promise<string[]> => {
    let cache = fileCaches.get(filePath);
    if (!cache) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        cache = { lines: content.split('\n') };
      } catch {
        cache = { lines: [] };
      }
      fileCaches.set(filePath, cache);
    }
    return cache.lines;
  };

  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === 'match') {
        const filePath = parsed.data.path.text;
        const lineNumber = parsed.data.line_number;
        const matchContent = parsed.data.lines.text.trim();

        const match: GrepMatch = {
          file: filePath,
          line: lineNumber,
          content: matchContent,
        };

        // 如果需要 context，获取前后行
        if (contextLines && contextLines > 0) {
          const fileLines = await getFileLines(filePath);
          const zeroBasedLine = lineNumber - 1;

          // 获取前面的行
          if (zeroBasedLine > 0) {
            const start = Math.max(0, zeroBasedLine - contextLines);
            match.before = fileLines.slice(start, zeroBasedLine);
          }

          // 获取后面的行
          if (zeroBasedLine < fileLines.length - 1) {
            const end = Math.min(fileLines.length, zeroBasedLine + contextLines + 1);
            match.after = fileLines.slice(zeroBasedLine + 1, end);
          }
        }

        matches.push(match);
      }
    } catch {
      continue;
    }
  }

  return matches;
}

async function searchWithNode(
  pattern: string,
  searchPath: string,
  ignoreCase: boolean,
  includePattern?: string,
  contextLines?: number,
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];
  const regexFlags = ignoreCase ? 'gi' : 'g';
  const regex = new RegExp(pattern, regexFlags);

  async function scanDir(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.local') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.next', '.turbo', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        if (includePattern && !entry.name.endsWith(includePattern.replace('*.', ''))) {
          continue;
        }

        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              regex.lastIndex = 0;

              const match: GrepMatch = {
                file: fullPath,
                line: i + 1,
                content: lines[i].trim(),
              };

              // 如果需要 context，获取前后行
              if (contextLines && contextLines > 0) {
                // 获取前面的行
                if (i > 0) {
                  const start = Math.max(0, i - contextLines);
                  match.before = lines.slice(start, i);
                }

                // 获取后面的行
                if (i < lines.length - 1) {
                  const end = Math.min(lines.length, i + contextLines + 1);
                  match.after = lines.slice(i + 1, end);
                }
              }

              matches.push(match);
            }
            regex.lastIndex = 0;
          }
        } catch {
          continue;
        }
      }
    }
  }

  await scanDir(searchPath);
  return matches;
}

/**
 * 格式化匹配结果为可读文本
 */
function formatMatches(
  matches: GrepMatch[],
  contextLines: number,
): string[] {
  const output: string[] = [];
  let lastFile = '';

  for (const match of matches) {
    // 如果有 context，显示完整上下文
    if (contextLines && contextLines > 0) {
      // 新文件时显示文件头
      if (match.file !== lastFile) {
        output.push(`\n--- ${match.file} ---`);
        lastFile = match.file;
      }

      // 显示前面的行
      if (match.before && match.before.length > 0) {
        for (let i = 0; i < match.before.length; i++) {
          const lineNum = match.line - match.before.length + i;
          output.push(`${lineNum}: ${match.before[i]}`);
        }
      }

      // 显示匹配行（高亮）
      output.push(`${match.line}: ${match.content}`);

      // 显示后面的行
      if (match.after && match.after.length > 0) {
        for (let i = 0; i < match.after.length; i++) {
          const lineNum = match.line + i + 1;
          output.push(`${lineNum}: ${match.after[i]}`);
        }
      }

      output.push('');  // 空行分隔
    } else {
      // 无 context 时的简单格式
      output.push(`${match.file}:${match.line}: ${match.content}`);
    }
  }

  return output;
}

export function createGrepTool(options: { cwd: string }) {
  return tool({
    description:
      '在代码库中搜索文本。支持正则表达式、忽略大小写、按文件类型过滤。自动使用 ripgrep（如果可用）以获得最佳性能。',
    inputSchema: z.object({
      pattern: z.string().describe('搜索的正则表达式或文本'),
      path: z.string().optional().describe('搜索目录（默认为当前工作目录）'),
      ignoreCase: z.boolean().optional().default(true).describe('是否忽略大小写'),
      include: z.string().optional().describe('文件类型过滤，如 "*.ts"、"*.py"'),
      context: z.number().optional().describe('显示匹配行前后 N 行上下文（默认不显示）'),
      limit: z.number().optional().default(100).describe('最大返回匹配数（默认 100）'),
    }),
    execute: async ({ pattern, path: searchPath, ignoreCase = true, include, context: contextLines, limit }) => {
      const absolutePath = searchPath ? path.resolve(searchPath) : options.cwd;

      try {
        await fs.stat(absolutePath);
      } catch {
        throw new Error(`搜索路径不存在: ${absolutePath}`);
      }

      const useRg = await checkRgAvailable();
      const allMatches = useRg
        ? await searchWithRipgrep(pattern, absolutePath, ignoreCase, include, contextLines)
        : await searchWithNode(pattern, absolutePath, ignoreCase, include, contextLines);

      const searchEngine = useRg ? 'ripgrep' : 'node.js';
      const effectiveLimit = Math.max(1, limit ?? 100);

      // 应用 limit 限制
      const matches = allMatches.slice(0, effectiveLimit);
      const truncated = allMatches.length > effectiveLimit;

      // 格式化输出
      const formattedMatches = formatMatches(matches, contextLines ?? 0);

      // 构建结果
      const result: Record<string, unknown> = {
        pattern,
        searchPath: absolutePath,
        totalMatches: allMatches.length,
        matchesReturned: matches.length,
        truncated,
        searchEngine,
        flags: { ignoreCase, include, context: contextLines },
      };

      // 根据是否有 context 选择输出格式
      if (contextLines && contextLines > 0) {
        result.formattedOutput = formattedMatches.join('\n');
      } else {
        result.matches = matches.map(m => ({
          file: m.file,
          line: m.line,
          content: m.content,
        }));
      }

      // 添加截断提示
      if (truncated) {
        result.note = `结果已截断：显示 ${matches.length} / ${allMatches.length} 条匹配。使用更具体的 pattern 或 include 参数缩小范围。`;
      }

      return JSON.stringify(result, null, 2);
    },
  });
}
