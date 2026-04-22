import fs from 'fs/promises';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { z } from 'zod';
import path from 'path';

// 从统一配置模块导入常量
import {
  DEFAULT_AGENT_SCAN_DIRS,
  DEFAULT_SKILL_SCAN_DIRS,
  DEFAULT_CONNECTORS_DIR,
  DEFAULT_PERMISSIONS_DIR,
  PERMISSIONS_FILENAME,
} from '../config/defaults';

// 重新导出供其他模块使用
export { DEFAULT_AGENT_SCAN_DIRS, DEFAULT_SKILL_SCAN_DIRS, DEFAULT_CONNECTORS_DIR, DEFAULT_PERMISSIONS_DIR, PERMISSIONS_FILENAME };

// ============================================================
// Frontmatter 解析
// ============================================================

/**
 * Frontmatter 解析错误
 */
export class FrontmatterParseError extends Error {
  constructor(
    public filePath: string,
    public zodError: z.ZodError,
  ) {
    const issues = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    super(`Invalid frontmatter in ${filePath}: ${issues}`);
    this.name = 'FrontmatterParseError';
  }
}

/**
 * Frontmatter 解析结果
 */
export interface FrontmatterParseResult<T> {
  /** 解析并验证后的 frontmatter 数据 */
  data: T;
  /** Markdown 正文内容（去除 frontmatter 后） */
  body: string;
  /** 文件绝对路径 */
  filePath: string;
}

/**
 * 解析带有 YAML frontmatter 的 Markdown 文件
 *
 * @param filePath 文件路径
 * @param schema Zod schema 用于验证 frontmatter
 * @returns 解析结果
 * @throws FrontmatterParseError 如果验证失败
 */
export async function parseFrontmatterFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<FrontmatterParseResult<T>> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  const { data, content: body } = matter(content);

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new FrontmatterParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    body: body.trim(),
    filePath: absolutePath,
  };
}

/**
 * 解析 YAML 文件（无 body）
 *
 * @param filePath 文件路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parseYamlFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<{ data: T; filePath: string }> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  const { data } = matter(content);

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new FrontmatterParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    filePath: absolutePath,
  };
}

/**
 * 解析 JSON 文件
 *
 * @param filePath 文件路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parseJsonFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<{ data: T; filePath: string }> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON in ${absolutePath}: ${(e as Error).message}`);
  }

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new FrontmatterParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
    filePath: absolutePath,
  };
}

/**
 * 解析纯 YAML 文件（无 frontmatter）
 *
 * @param filePath 文件路径
 * @param schema Zod schema 用于验证
 * @returns 解析结果
 */
export async function parsePlainYamlFile<T>(
  filePath: string,
  schema: z.ZodSchema<T>,
): Promise<{ data: T; filePath: string }> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (e) {
    throw new Error(`Invalid YAML in ${absolutePath}: ${(e as Error).message}`);
  }

  const validated = schema.safeParse(data);

  if (!validated.success) {
    throw new FrontmatterParseError(absolutePath, validated.error);
  }

  return {
    data: validated.data,
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
// 配置目录路径
// ============================================================

/**
 * 获取用户全局配置目录
 *
 * @param subdir 子目录名（如 'agents', 'skills', 'connectors'）
 * @returns 目录绝对路径
 */
export function getUserConfigDir(subdir: string): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(homeDir, '.thething', subdir);
}

/**
 * 获取项目级配置目录
 *
 * @param cwd 项目根目录
 * @param subdir 子目录名
 * @returns 目录绝对路径
 */
export function getProjectConfigDir(cwd: string, subdir: string): string {
  return path.join(cwd, '.thething', subdir);
}