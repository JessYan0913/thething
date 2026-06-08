import { tool } from 'ai';
import fg from 'fast-glob';
import * as path from 'path';
import { z } from 'zod';

// 默认配置
const DEFAULT_LIMIT = 1000;

export function createGlobTool(options: { cwd: string }) {
  return tool({
    description: `使用 glob 模式匹配文件路径。用于查找项目中的文件，支持通配符 **、*、? 和排除规则。
特性：
- 智能截断：超过限制时自动截断并提示
- 排除常见目录：node_modules、.git、dist 等`,
    inputSchema: z.object({
      pattern: z.string().describe('glob 模式，如 "**/*.ts" 匹配所有 TypeScript 文件'),
      cwd: z.string().optional().describe('搜索的起始目录（默认为当前工作目录）'),
      ignore: z.array(z.string()).optional().describe('要排除的 glob 模式列表'),
      limit: z.number().optional().default(DEFAULT_LIMIT).describe(`最大返回文件数（默认 ${DEFAULT_LIMIT}）`),
    }),
    execute: async ({ pattern, cwd, ignore, limit }) => {
      const searchDir = cwd ? path.resolve(cwd) : options.cwd;
      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

      // 先获取所有匹配文件
      const allFiles = await fg(pattern, {
        cwd: searchDir,
        ignore: ignore || ['node_modules/**', '.git/**', '.next/**', '.turbo/**', 'dist/**', 'build/**', '.cache/**'],
        absolute: false,
        dot: false,
        onlyFiles: true,
        followSymbolicLinks: true,
      });

      // 排序
      const sortedFiles = allFiles.sort();

      // 应用 limit 限制
      const files = sortedFiles.slice(0, effectiveLimit);
      const truncated = sortedFiles.length > effectiveLimit;

      const result: Record<string, unknown> = {
        pattern,
        searchDir,
        files,
        count: files.length,
        totalCount: sortedFiles.length,
        truncated,
      };

      // 添加截断提示
      if (truncated) {
        result.note = `结果已截断：显示 ${files.length} / ${sortedFiles.length} 个文件。使用更具体的 pattern 缩小范围。`;
        result.hasMore = true;
      }

      return JSON.stringify(result, null, 2);
    },
  });
}
