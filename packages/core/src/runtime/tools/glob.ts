import { tool } from 'ai';
import fg from 'fast-glob';
import * as path from 'path';
import { z } from 'zod';

export function createGlobTool(options: { cwd: string }) {
  return tool({
    description: '使用 glob 模式匹配文件路径。用于查找项目中的文件，支持通配符 **、*、? 和排除规则。',
    inputSchema: z.object({
      pattern: z.string().describe('glob 模式，如 "**/*.ts" 匹配所有 TypeScript 文件'),
      cwd: z.string().optional().describe('搜索的起始目录（默认为当前工作目录）'),
      ignore: z.array(z.string()).optional().describe('要排除的 glob 模式列表'),
    }),
    execute: async ({ pattern, cwd, ignore }) => {
      const searchDir = cwd ? path.resolve(cwd) : options.cwd;

      const files = await fg(pattern, {
        cwd: searchDir,
        ignore: ignore || ['node_modules/**', '.git/**', '.next/**', '.turbo/**', 'dist/**', 'build/**', '.cache/**'],
        absolute: false,
        dot: false,
        onlyFiles: true,
        followSymbolicLinks: true,
      });

      const result = {
        pattern,
        searchDir,
        files: files.sort(),
        count: files.length,
      };

      return JSON.stringify(result, null, 2);
    },
  });
}
