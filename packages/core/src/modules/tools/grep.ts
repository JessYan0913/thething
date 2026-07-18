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
 * per-file 上限:单个文件命中过多时(如搜常用符号),避免 100 条 limit
 * 全被一个文件吃掉。每文件最多保留 N 条,其余记入 omitted 提示,
 * 总量分给更多文件。见 docs/built-in-tools-compaction-analysis.md 三.D。
 */
function applyPerFileLimit(
  matches: GrepMatch[],
  perFileLimit: number,
): { limited: GrepMatch[]; omittedByFile: Map<string, number> } {
  const perFileCount = new Map<string, number>();
  const omittedByFile = new Map<string, number>();
  const limited: GrepMatch[] = [];

  for (const m of matches) {
    const count = perFileCount.get(m.file) ?? 0;
    if (count < perFileLimit) {
      limited.push(m);
      perFileCount.set(m.file, count + 1);
    } else {
      omittedByFile.set(m.file, (omittedByFile.get(m.file) ?? 0) + 1);
    }
  }

  return { limited, omittedByFile };
}

/**
 * 默认紧凑文本格式:`file:line: content`,按文件分组去重路径前缀。
 * 相比 pretty-print JSON(2 空格缩进 + 每条重复 file/line/content 键 +
 * 绝对路径全量重复),信息密度高得多。
 */
function formatCompact(
  matches: GrepMatch[],
  omittedByFile: Map<string, number>,
): string {
  const output: string[] = [];
  let lastFile = '';

  for (const match of matches) {
    if (match.file !== lastFile) {
      output.push(`${match.file}:`);
      lastFile = match.file;
      // 文件切换时,若上一文件有省略,提示会在文件块末尾统一加(见下)
    }
    output.push(`  ${match.line}: ${match.content}`);
    // 该文件的最后一条之后追加省略提示
    const omitted = omittedByFile.get(match.file);
    if (omitted && isLastMatchOfFile(matches, match)) {
      output.push(`  … ${omitted} more matches in this file`);
    }
  }

  return output.join('\n');
}

/** 判断某条匹配是否是其所在文件在列表中的最后一条 */
function isLastMatchOfFile(matches: GrepMatch[], target: GrepMatch): boolean {
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].file === target.file) {
      return matches[i] === target;
    }
  }
  return false;
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
      perFileLimit: z.number().optional().default(10).describe('单个文件最多返回的匹配数（默认 10，超出记为 more matches）'),
    }),
    execute: async ({ pattern, path: searchPath, ignoreCase = true, include, context: contextLines, limit, perFileLimit }) => {
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
      const effectivePerFileLimit = Math.max(1, perFileLimit ?? 10);

      // 先按 per-file 上限裁剪,让总量分给更多文件,再应用全局 limit
      const { limited, omittedByFile } = applyPerFileLimit(allMatches, effectivePerFileLimit);
      const matches = limited.slice(0, effectiveLimit);
      const truncated = limited.length > effectiveLimit;

      // 构建结果元信息
      const result: Record<string, unknown> = {
        pattern,
        searchPath: absolutePath,
        totalMatches: allMatches.length,
        matchesReturned: matches.length,
        truncated,
        searchEngine,
        flags: { ignoreCase, include, context: contextLines },
      };

      // 有 context 时保留原多行上下文格式;否则默认用紧凑文本(file:line: content),
      // 信息密度远高于 pretty-print JSON。见 docs/built-in-tools-compaction-analysis.md 三.B。
      if (contextLines && contextLines > 0) {
        result.formattedOutput = formatMatches(matches, contextLines).join('\n');
      } else {
        result.formattedOutput = formatCompact(matches, omittedByFile);
      }

      // 添加截断提示
      if (truncated) {
        result.note = `结果已截断：显示 ${matches.length} / ${limited.length} 条匹配（per-file 上限 ${effectivePerFileLimit}）。使用更具体的 pattern 或 include 参数缩小范围。`;
      }

      return JSON.stringify(result, null, 2);
    },
  });
}
