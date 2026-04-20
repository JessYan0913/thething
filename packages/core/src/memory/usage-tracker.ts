// ============================================================
// Memory Usage Tracker - File-based Usage Tracking
// ============================================================
// Tracks memory recall counts and timestamps using a JSON file.
// This replaces the database-based memory tracking.

import fs from 'fs/promises';
import path from 'path';

const USAGE_FILE_NAME = 'usage.json';

export interface MemoryUsageEntry {
  recallCount: number;
  lastRecalledAt: string | null;
}

export interface MemoryUsageData {
  [filename: string]: MemoryUsageEntry;
}

/**
 * Get the path to the usage file for a memory directory
 */
export function getUsageFilePath(memoryDir: string): string {
  return path.join(memoryDir, USAGE_FILE_NAME);
}

/**
 * Load usage data from file
 */
export async function loadUsageData(memoryDir: string): Promise<MemoryUsageData> {
  const usagePath = getUsageFilePath(memoryDir);

  try {
    const content = await fs.readFile(usagePath, 'utf-8');
    return JSON.parse(content) as MemoryUsageData;
  } catch {
    return {};
  }
}

/**
 * Save usage data to file
 */
export async function saveUsageData(memoryDir: string, data: MemoryUsageData): Promise<void> {
  const usagePath = getUsageFilePath(memoryDir);
  await fs.writeFile(usagePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Record a memory recall event
 * Increments the recall count and updates the last recalled timestamp.
 */
export async function recordMemoryRecall(
  memoryDir: string,
  filename: string,
  conversationId?: string
): Promise<void> {
  const data = await loadUsageData(memoryDir);

  const existing = data[filename] || { recallCount: 0, lastRecalledAt: null };

  data[filename] = {
    recallCount: existing.recallCount + 1,
    lastRecalledAt: new Date().toISOString(),
  };

  await saveUsageData(memoryDir, data);
}

/**
 * Get usage info for a specific memory file
 */
export async function getMemoryUsage(
  memoryDir: string,
  filename: string
): Promise<MemoryUsageEntry> {
  const data = await loadUsageData(memoryDir);
  return data[filename] || { recallCount: 0, lastRecalledAt: null };
}

/**
 * Get all usage data for a memory directory
 */
export async function getAllMemoryUsage(memoryDir: string): Promise<MemoryUsageData> {
  return loadUsageData(memoryDir);
}

/**
 * Clear usage data for a memory directory
 */
export async function clearUsageData(memoryDir: string): Promise<void> {
  const usagePath = getUsageFilePath(memoryDir);
  try {
    await fs.unlink(usagePath);
  } catch {
    // File may not exist
  }
}

/**
 * Remove usage entry for a deleted memory file
 */
export async function removeMemoryUsage(memoryDir: string, filename: string): Promise<void> {
  const data = await loadUsageData(memoryDir);

  if (data[filename]) {
    delete data[filename];
    await saveUsageData(memoryDir, data);
  }
}