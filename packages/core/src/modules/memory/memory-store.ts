// ============================================================
// Memory Store - 纯文件 IO 操作
// ============================================================
// 从 extractor.ts 中提取的文件读写逻辑，不包含任何 LLM 调用或决策逻辑
// 支持分层存储（identity/pattern/state）

import fs from 'fs/promises';
import path from 'path';
import type { MemoryFileData } from './types';
import { formatMemoryFrontmatter } from './frontmatter';
import { appendToEntrypoint, rebuildEntrypoint, deleteMemoryFile as deleteMemoryFileInternal, type EntrypointLimits } from './memdir';
import { removeMemoryUsage } from './usage-tracker';
import { isTieredStorage, writeMemoryToTier, deleteMemoryFromTier, determineTier } from './tiered-storage';
import { logger } from '../../primitives/logger';

/**
 * 写入新的记忆文件
 * 自动检测是否使用分层存储，写入正确的目录
 */
export async function writeMemoryFile(
  userDir: string,
  memoryData: MemoryFileData,
  content: string,
  entrypointLimits?: EntrypointLimits,
): Promise<string> {
  const fileName = `${memoryData.type}_${memoryData.name.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_').toLowerCase()}.md`;

  // 检查是否使用分层存储
  const tiered = await isTieredStorage(userDir);

  if (tiered) {
    // 写入分层目录
    await writeMemoryToTier(userDir, memoryData, content);
    return fileName;
  }

  // 扁平目录（兼容旧格式）
  const filePath = path.join(userDir, fileName);
  const fileContent = formatMemoryFrontmatter(memoryData) + '\n\n' + content;
  await fs.writeFile(filePath, fileContent, 'utf-8');

  await appendToEntrypoint(userDir, {
    filename: fileName,
    name: memoryData.name,
    description: memoryData.description,
    type: memoryData.type,
  }, entrypointLimits);

  return fileName;
}

/**
 * 更新现有记忆文件（删除旧文件 + 写入新文件 + 重建索引）
 */
export async function updateMemoryFile(
  userDir: string,
  oldFilename: string,
  newMemoryData: MemoryFileData,
  content: string,
  entrypointLimits?: EntrypointLimits,
): Promise<string> {
  // 删除旧文件
  const oldFilePath = path.join(userDir, oldFilename);
  await fs.unlink(oldFilePath).catch(() => {});
  await removeMemoryUsage(userDir, oldFilename);

  // 写入新文件
  const newFileName = `${newMemoryData.type}_${newMemoryData.name.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_').toLowerCase()}.md`;
  const newFilePath = path.join(userDir, newFileName);

  const fileContent = formatMemoryFrontmatter(newMemoryData) + '\n\n' + content;
  await fs.writeFile(newFilePath, fileContent, 'utf-8');

  // 重建索引
  await rebuildEntrypoint(userDir, entrypointLimits);

  return newFileName;
}

/**
 * 标记记忆为已过期
 */
export async function invalidateMemoryFile(
  userDir: string,
  filename: string,
  reason: string,
  entrypointLimits?: EntrypointLimits,
): Promise<void> {
  const filePath = path.join(userDir, filename);
  try {
    const existingContent = await fs.readFile(filePath, 'utf-8');
    const invalidatedContent = existingContent.replace(
      /^---\n/,
      '---\nstatus: invalidated\ninvalidated_reason: ',
    ) + `\n\n[此记忆已过期，原因: ${reason}]`;
    await fs.writeFile(filePath, invalidatedContent, 'utf-8');
    await rebuildEntrypoint(userDir, entrypointLimits);
  } catch {
    // 文件不存在，跳过
  }
}

/**
 * 删除记忆文件并清理相关数据
 * 自动检测是否使用分层存储
 */
export async function deleteMemoryWithCleanup(
  userDir: string,
  filename: string,
  entrypointLimits?: EntrypointLimits,
): Promise<void> {
  await removeMemoryUsage(userDir, filename);

  // 检查是否使用分层存储
  const tiered = await isTieredStorage(userDir);

  if (tiered) {
    await deleteMemoryFromTier(userDir, filename);
    return;
  }

  // 扁平目录（兼容旧格式）
  await deleteMemoryFileInternal(userDir, filename, entrypointLimits);
}

/**
 * 生成记忆文件名
 */
export function getMemoryFileName(type: string, name: string): string {
  return `${type}_${name.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_').toLowerCase()}.md`;
}
