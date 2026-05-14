/**
 * 文件路径安全验证
 *
 * 敏感路径保护列表（bypass-immune，任何情况下都不可绕过）
 */

import * as path from 'path';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';
import type { PathValidationOptions, PathValidationResult } from './types';

// 敏感路径列表 - 任何模式下都不可绕过
const SENSITIVE_PATHS = [
  '.git',
  // DEFAULT_PROJECT_CONFIG_DIR_NAME,
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
];

// 敏感文件扩展名
const SENSITIVE_EXTENSIONS = [
  '.key',
  '.pem',
  '.secret',
  '.private',
  '.password',
];

// 敏感目录
const SENSITIVE_DIRS = [
  'node_modules/.cache',
];

type PathValidationInput = string | PathValidationOptions;

function normalizeForMatch(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
}

function resolveInputPath(filePath: string, workingDir: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDir, filePath);
}

function isSameOrDescendant(filePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, filePath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveValidationOptions(input?: PathValidationInput): Required<PathValidationOptions> {
  if (typeof input === 'string') {
    return {
      workingDir: input,
      extraSensitivePaths: [],
    };
  }

  return {
    workingDir: input?.workingDir ?? process.cwd(),
    extraSensitivePaths: input?.extraSensitivePaths ?? [],
  };
}

/**
 * 检查路径是否匹配敏感路径
 */
function isSensitivePath(
  filePath: string,
  workingDir: string,
  extraSensitivePaths: readonly string[] = [],
): boolean {
  const resolvedPath = resolveInputPath(filePath, workingDir);
  const normalized = normalizeForMatch(filePath);
  const normalizedResolved = normalizeForMatch(resolvedPath);
  const basename = path.basename(resolvedPath);
  const ext = path.extname(resolvedPath);

  // 检查敏感目录
  for (const dir of SENSITIVE_DIRS) {
    const normalizedDir = normalizeForMatch(dir);
    if (normalized.includes(normalizedDir) || normalizedResolved.includes(normalizedDir)) {
      return true;
    }
  }

  // 检查敏感路径（精确匹配或作为目录前缀）
  for (const sensitive of SENSITIVE_PATHS) {
    // 路径是敏感文件本身
    if (basename === sensitive) {
      return true;
    }
    // 路径在敏感目录下
    if (
      normalized.includes(`/${sensitive}/`) ||
      normalized.startsWith(`${sensitive}/`) ||
      normalizedResolved.includes(`/${sensitive}/`) ||
      normalizedResolved.endsWith(`/${sensitive}`)
    ) {
      return true;
    }
  }

  // 检查敏感扩展名
  for (const sensitiveExt of SENSITIVE_EXTENSIONS) {
    if (ext === sensitiveExt) {
      return true;
    }
  }

  // 检查 .env 系列（模糊匹配）
  if (/\.env(\.\w+)?(\.local)?$/.test(basename)) {
    return true;
  }

  for (const sensitive of extraSensitivePaths) {
    if (!sensitive.trim()) continue;
    const sensitivePath = path.isAbsolute(sensitive)
      ? path.resolve(sensitive)
      : path.resolve(workingDir, sensitive);
    if (isSameOrDescendant(resolvedPath, sensitivePath)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查路径是否在工作目录内
 */
function isWithinWorkingDir(resolvedPath: string, workingDir: string): boolean {
  const resolvedWorkingDir = path.resolve(workingDir);

  // macOS/Linux 和 Windows 的路径比较
  const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, '/');
  const normalizedWorkingDir = resolvedWorkingDir.toLowerCase().replace(/\\/g, '/');

  return normalizedPath === normalizedWorkingDir || normalizedPath.startsWith(`${normalizedWorkingDir}/`);
}

/**
 * 检查 shell 展开语法（防止 TOCTOU 攻击）
 */
function hasShellExpansion(filePath: string): boolean {
  // 阻止 shell 变量展开
  if (/\$[\w]+/.test(filePath)) return true;
  // 阻止 Windows 环境变量
  if (/%\w+%/.test(filePath)) return true;
  // 阻止 home 目录展开
  if (filePath.startsWith('~')) return true;
  // 阻止命令替换
  if (/\`.*\`/.test(filePath)) return true;

  return false;
}

/**
 * 验证文件路径安全性
 *
 * @param filePath - 要验证的路径
 * @param workingDir - 工作目录（可选，默认使用 process.cwd）
 * @returns 验证结果
 */
export function validatePath(
  filePath: string,
  options?: PathValidationInput,
): PathValidationResult {
  const { workingDir, extraSensitivePaths } = resolveValidationOptions(options);
  const resolved = resolveInputPath(filePath, workingDir);

  // 1. 检查 shell 展开（防止注入）
  if (hasShellExpansion(filePath)) {
    return {
      allowed: false,
      reason: '路径包含 shell 展开语法，可能存在安全风险',
      resolvedPath: resolved,
    };
  }

  // 2. 检查敏感路径（bypass-immune）
  if (isSensitivePath(filePath, workingDir, extraSensitivePaths)) {
    return {
      allowed: false,
      reason: '敏感路径被保护，不允许访问',
      resolvedPath: resolved,
    };
  }

  // 3. 检查工作目录越界
  // 注意：对于绝对路径，我们允许访问，但会检查敏感路径
  // 对于相对路径，要求在工作目录内
  if (!path.isAbsolute(filePath)) {
    // 相对路径，检查是否在工作目录内
    if (!isWithinWorkingDir(resolved, workingDir)) {
      return {
        allowed: false,
        reason: '路径越界：相对路径必须在工作目录内',
        resolvedPath: resolved,
      };
    }
  }

  return {
    allowed: true,
    resolvedPath: resolved,
  };
}

/**
 * 验证写入路径的安全性
 * 写入操作比读取操作更严格
 */
export function validateWritePath(
  filePath: string,
  options?: PathValidationInput,
): PathValidationResult {
  const result = validatePath(filePath, options);

  if (!result.allowed) {
    return result;
  }

  // 写入操作额外检查：不允许写入某些关键配置
  const basename = path.basename(filePath);
  const protectedWriteFiles = [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    `${DEFAULT_PROJECT_CONFIG_DIR_NAME}/settings.json`,
    `${DEFAULT_PROJECT_CONFIG_DIR_NAME}/settings.local.json`,
  ];

  for (const protectedFile of protectedWriteFiles) {
    if (basename === protectedFile) {
      return {
        allowed: false,
        reason: `写入 ${protectedFile} 需要用户确认`,
        resolvedPath: result.resolvedPath,
      };
    }
  }

  return result;
}

/**
 * 获取敏感路径列表（用于文档/调试）
 */
export function getSensitivePaths(): string[] {
  return [...SENSITIVE_PATHS, ...SENSITIVE_DIRS];
}

/**
 * 获取敏感扩展名列表
 */
export function getSensitiveExtensions(): string[] {
  return [...SENSITIVE_EXTENSIONS];
}
