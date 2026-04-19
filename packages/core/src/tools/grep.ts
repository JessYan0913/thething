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
}

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  ignoreCase: boolean,
  includePattern?: string,
): Promise<GrepMatch[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const args = ['--json', '--no-heading'];
  if (ignoreCase) args.push('-i');
  if (includePattern) args.push('--glob', includePattern);
  args.push(pattern, searchPath);

  const { stdout } = await execAsync(`rg ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
    encoding: 'utf-8',
    maxBuffer: 50_000_000,
  });

  const matches: GrepMatch[] = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'match') {
        for (const sub of parsed.data.submatches) {
          matches.push({
            file: parsed.data.path.text,
            line: parsed.data.line_number,
            content: parsed.data.lines.text.trim(),
          });
        }
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
              matches.push({
                file: fullPath,
                line: i + 1,
                content: lines[i].trim(),
              });
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

export const grepTool = tool({
  description:
    '在代码库中搜索文本。支持正则表达式、忽略大小写、按文件类型过滤。自动使用 ripgrep（如果可用）以获得最佳性能。',
  inputSchema: z.object({
    pattern: z.string().describe('搜索的正则表达式或文本'),
    path: z.string().optional().describe('搜索目录（默认为当前工作目录）'),
    ignoreCase: z.boolean().optional().default(true).describe('是否忽略大小写'),
    include: z.string().optional().describe('文件类型过滤，如 "*.ts"、"*.py"'),
  }),
  execute: async ({ pattern, path: searchPath, ignoreCase = true, include }) => {
    const absolutePath = searchPath ? path.resolve(searchPath) : process.cwd();

    try {
      await fs.stat(absolutePath);
    } catch {
      throw new Error(`搜索路径不存在: ${absolutePath}`);
    }

    const useRg = await checkRgAvailable();
    const matches = useRg
      ? await searchWithRipgrep(pattern, absolutePath, ignoreCase, include)
      : await searchWithNode(pattern, absolutePath, ignoreCase, include);

    const searchEngine = useRg ? 'ripgrep' : 'node.js';
    const maxDisplay = 200;

    return {
      pattern,
      searchPath: absolutePath,
      totalMatches: matches.length,
      matches: matches.slice(0, maxDisplay),
      truncated: matches.length > maxDisplay,
      searchEngine,
      flags: { ignoreCase, include },
    };
  },
});