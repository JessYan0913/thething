/**
 * 文件路径安全验证
 *
 * 敏感路径保护列表（bypass-immune，任何情况下都不可绕过）
 */

import * as path from 'path';
import { PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';
import type { PathValidationResult } from './types';

// 敏感路径列表 - 任何模式下都不可绕过
const SENSITIVE_PATHS = [
  '.git',
  // PROJECT_CONFIG_DIR_NAME,
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

/**
 * 检查路径是否匹配敏感路径
 */
function isSensitivePath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const basename = path.basename(normalized);
  const ext = path.extname(normalized);

  // 检查敏感目录
  for (const dir of SENSITIVE_DIRS) {
    if (normalized.includes(dir)) {
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
    if (normalized.includes(`/${sensitive}/`) || normalized.startsWith(`${sensitive}/`) || normalized.includes(`\\${sensitive}\\`) || normalized.startsWith(`${sensitive}\\`)) {
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

  return false;
}

/**
 * 检查路径是否在工作目录内
 */
function isWithinWorkingDir(filePath: string, workingDir: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedWorkingDir = path.resolve(workingDir);

  // macOS/Linux 和 Windows 的路径比较
  const normalizedPath = resolved.toLowerCase().replace(/\\/g, '/');
  const normalizedWorkingDir = resolvedWorkingDir.toLowerCase().replace(/\\/g, '/');

  return normalizedPath.startsWith(normalizedWorkingDir);
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
  workingDir?: string,
): PathValidationResult {
  const cwd = workingDir || process.cwd();
  const resolved = path.resolve(filePath);

  // 1. 检查 shell 展开（防止注入）
  if (hasShellExpansion(filePath)) {
    return {
      allowed: false,
      reason: '路径包含 shell 展开语法，可能存在安全风险',
      resolvedPath: resolved,
    };
  }

  // 2. 检查敏感路径（bypass-immune）
  if (isSensitivePath(filePath)) {
    return {
      allowed: false,
      reason: '敏感路径被保护，不允许访问',
      resolvedPath: resolved,
    };
  }

  // 3. 检查工作目录越界
  // 注意：对于绝对路径，我们允许访问，但会检查敏感路径
  // 对于相对路径，要求在工作目录内
  if (!filePath.startsWith('/') && !filePath.startsWith('\\') && !filePath.match(/^([A-Za-z]:)/)) {
    // 相对路径，检查是否在工作目录内
    if (!isWithinWorkingDir(filePath, cwd)) {
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
  workingDir?: string,
): PathValidationResult {
  const result = validatePath(filePath, workingDir);

  if (!result.allowed) {
    return result;
  }

  // 写入操作额外检查：不允许写入某些关键配置
  const basename = path.basename(filePath);
  const protectedWriteFiles = [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    `${PROJECT_CONFIG_DIR_NAME}/settings.json`,
    `${PROJECT_CONFIG_DIR_NAME}/settings.local.json`,
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