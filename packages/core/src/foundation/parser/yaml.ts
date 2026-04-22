// ============================================================
// Parser - YAML 文件解析
// ============================================================

import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';
import type { z } from 'zod';
import { ParseError, type ParseResult } from './frontmatter';

/**
 * 解析纯 YAML 文件（无 frontmatter）
 *
 * @param filePath 文件绝对路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parsePlainYamlFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (e) {
    throw new ParseError(absolutePath, undefined, e as Error);
  }

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new ParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    body: '',  // YAML 文件没有 body
    filePath: absolutePath,
  };
}

/**
 * 解析 YAML 文件（使用 gray-matter，支持 frontmatter）
 *
 * @param filePath 文件绝对路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parseYamlFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<ParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  // 使用 gray-matter 解析（支持 frontmatter）
  const matter = await import('gray-matter');
  const { data } = matter.default(content);

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new ParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    body: '',  // YAML 文件没有 body
    filePath: absolutePath,
  };
}