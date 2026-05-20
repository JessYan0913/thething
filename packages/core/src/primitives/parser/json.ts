// ============================================================
// Parser - JSON 文件解析
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import type { z } from 'zod';
import { ParseError, type ParseResult } from './frontmatter';

/**
 * 解析 JSON 文件
 *
 * @param filePath 文件绝对路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parseJsonFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new ParseError(absolutePath, undefined, e as Error);
  }

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new ParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    body: '',  // JSON 文件没有 body
    filePath: absolutePath,
  };
}