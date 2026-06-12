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
 * 更新 YAML 文本中的 variables 区域，只做字符串级替换，保留注释和格式。
 *
 * 遍历行，找到 `variables:` 块后，匹配块内的 `key: value` 行并用新值替换。
 * 值会被设为双引号字符串，行尾注释被保留。
 *
 * @param content YAML 原文
 * @param newVars 要更新的变量映射
 * @returns 替换后的 YAML 文本
 */
export function updateVariablesInYaml(content: string, newVars: Record<string, string>): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inVariables = false;
  let varBlockIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 variables 块开头
    if (!inVariables) {
      const varMatch = line.match(/^(\s*)variables:\s*$/);
      if (varMatch) {
        inVariables = true;
        varBlockIndent = varMatch[1].length;
      }
      result.push(line);
      continue;
    }

    // 空行和注释行属于块内
    if (trimmed === '' || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    // 缩进回到 variables 同级 → 块结束
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent <= varBlockIndent) {
      inVariables = false;
      result.push(line);
      continue;
    }

    // 块内 key: value 行 — 匹配替换
    const keyMatch = line.match(/^(\s*)([\w-]+):\s*/);
    if (keyMatch) {
      const key = keyMatch[2];
      if (key in newVars) {
        const afterKey = line.slice(keyMatch[0].length);
        const commentMatch = afterKey.match(/(\s*#.*)$/);
        const comment = commentMatch ? commentMatch[1] : '';

        const escapedValue = newVars[key]
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');

        result.push(`${keyMatch[1]}${key}: "${escapedValue}"${comment}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
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