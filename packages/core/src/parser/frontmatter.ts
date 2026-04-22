// ============================================================
// Parser - Frontmatter 文件解析
// ============================================================

import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';
import type { z } from 'zod';

// ============================================================
// 解析错误
// ============================================================

export class ParseError extends Error {
  public filePath: string;
  public zodError?: z.ZodError;
  public rawError?: Error;

  constructor(
    filePath: string,
    zodError?: z.ZodError,
    rawError?: Error,
  ) {
    let message: string;
    if (zodError) {
      const issues = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      message = `Invalid frontmatter in ${filePath}: ${issues}`;
    } else if (rawError) {
      message = `Failed to parse ${filePath}: ${rawError.message}`;
    } else {
      message = `Failed to parse ${filePath}`;
    }
    super(message);
    this.name = 'ParseError';
    this.filePath = filePath;
    this.zodError = zodError;
    this.rawError = rawError;
  }
}

// ============================================================
// 解析结果
// ============================================================

export interface ParseResult<T> {
  data: T;
  body: string;  // 改为必需，因为 trim() 总是返回 string
  filePath: string;
}

// ============================================================
// Frontmatter 解析
// ============================================================

/**
 * 解析带有 YAML frontmatter 的 Markdown 文件
 *
 * @param filePath 文件绝对路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parseFrontmatterFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  const { data, content: body } = matter(content);

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new ParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    body: body.trim(),
    filePath: absolutePath,
  };
}

// ============================================================
// 工具列表解析
// ============================================================

/**
 * 解析工具列表字符串或数组
 *
 * @param value 逗号分隔的字符串或数组
 * @returns 工具名称数组
 */
export function parseToolsList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;

  if (Array.isArray(value)) {
    return value.map((t) => t.trim()).filter((t) => t.length > 0);
  }

  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}