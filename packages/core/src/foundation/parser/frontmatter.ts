// ============================================================
// Parser - Frontmatter 文件解析
// ============================================================

import fs from 'fs/promises';
import matter from 'gray-matter';
import path from 'path';
import type { z } from 'zod';
import type { ParseResult } from './types';

export type { ParseResult };

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
// Frontmatter 解析
// ============================================================

/**
 * 将 frontmatter 数据中的 null 值转换为 undefined
 * gray-matter 会将 YAML 中的 `null` 解析为 JavaScript null，
 * 而 Zod 的 .optional() 只接受 undefined。
 */
function nullToUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      cleaned[key] = undefined;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 递归处理嵌套对象（如 metadata）
      cleaned[key] = nullToUndefined(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

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

  const cleaned = nullToUndefined(data);
  const validated = schema.safeParse(cleaned);

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

// ============================================================
// 内容解析（不需要文件路径）
// ============================================================

/**
 * 解析结果（内容解析，无文件路径）
 */
export interface ContentParseResult<T> {
  /** 解析后的数据 */
  data: T;
  /** Markdown 正文内容 */
  body: string;
}

/**
 * 从字符串内容解析 frontmatter
 *
 * @param content Markdown 内容字符串
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export function parseFrontmatterContent<T>(
  content: string,
  schema: z.ZodSchema<T>,
): ContentParseResult<T> {
  const { data, content: body } = matter(content);

  const cleaned = nullToUndefined(data);
  const validated = schema.safeParse(cleaned);

  if (!validated.success) {
    throw new ParseError('content', validated.error);
  }

  return {
    data: validated.data,
    body: body.trim(),
  };
}