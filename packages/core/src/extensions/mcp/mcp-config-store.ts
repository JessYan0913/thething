/**
 * MCP 配置存储
 *
 * 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
 * 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。
 */

import fs from 'fs/promises';
import path from 'path';
import { scanMcpDirs, clearMcpCache } from '../../api/loaders/mcps';
import { computeUserConfigDir, computeProjectConfigDir, resolveHomeDir } from '../../foundation/paths';
import type { McpServerConfig, McpServerConfigSource } from './types';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';

// ============================================================
// MCP 配置目录
// ============================================================

/**
 * 获取用户级 MCP 配置目录
 *
 * 注意：configDirName 从全局单例获取
 */
export function getUserMcpConfigDir(configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME): string {
  return computeUserConfigDir(resolveHomeDir(), 'mcps', configDirName);
}

/**
 * 获取项目级 MCP 配置目录
 *
 * @param cwd 项目目录
 *
 * 注意：configDirName 从全局单例获取
 */
export function getProjectMcpConfigDir(
  cwd: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME,
): string {
  return computeProjectConfigDir(cwd, 'mcps', configDirName);
}

/**
 * 获取默认 MCP 配置目录（项目级）
 */
export function getDefaultMcpConfigDir(configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME): string {
  return getProjectMcpConfigDir(process.cwd(), configDirName);
}

// ============================================================
// MCP 配置 CRUD
// ============================================================

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * 配置文件路径
 */
function configFilePath(dir: string, name: string): string {
  return path.join(dir, `${encodeURIComponent(name)}.json`);
}

/**
 * 序列化配置
 */
function toSerializable(config: McpServerConfig): Record<string, unknown> {
  return {
    name: config.name,
    transport: config.transport,
    enabled: config.enabled ?? true,
    tools: config.tools,
    elicitation: config.elicitation,
  };
}

/**
 * 反序列化配置（带来源信息）
 *
 * @param data 配置数据
 * @param filePath 文件路径
 */
function fromSerializable(
  data: Record<string, unknown>,
  filePath: string,
  configDirName: string = DEFAULT_PROJECT_CONFIG_DIR_NAME,
): McpServerConfigSource {
  // 使用全局 configDirName 判断来源
  const userConfigDir = getUserMcpConfigDir(configDirName);
  const source = filePath.startsWith(userConfigDir) ? 'user' : 'project';

  return {
    name: data.name as string,
    transport: data.transport as McpServerConfig['transport'],
    enabled: (data.enabled ?? true) as boolean,
    tools: data.tools as McpServerConfig['tools'],
    elicitation: data.elicitation as McpServerConfig['elicitation'],
    source,
    filePath,
  };
}

/**
 * 获取所有 MCP 服务器配置（使用新加载器）
 *
 * @param cwd 项目目录
 */
export async function getMcpServerConfigs(cwd?: string): Promise<McpServerConfig[]> {
  return scanMcpDirs(cwd);
}

/**
 * 获取所有 MCP 服务器配置（带来源信息）
 *
 * @param cwd 项目目录
 */
export async function getMcpServerConfigsWithSource(cwd?: string): Promise<McpServerConfigSource[]> {
  const effectiveCwd = cwd ?? process.cwd();
  const configs: McpServerConfigSource[] = [];
  const dirs: string[] = [
    getUserMcpConfigDir(DEFAULT_PROJECT_CONFIG_DIR_NAME),
    getProjectMcpConfigDir(effectiveCwd, DEFAULT_PROJECT_CONFIG_DIR_NAME),
  ];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const filePath = path.join(dir, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as Record<string, unknown>;
          configs.push(fromSerializable(data, filePath, DEFAULT_PROJECT_CONFIG_DIR_NAME));
        } catch {
          // skip corrupted files
        }
      }
    } catch {
      // directory not exists, skip
    }
  }

  return configs;
}

/**
 * 获取单个 MCP 服务器配置
 *
 * @param name MCP 服务器名称
 * @param cwd 项目目录
 */
export async function getMcpServerConfig(name: string, cwd?: string): Promise<McpServerConfig | null> {
  const configs = await getMcpServerConfigsWithSource(cwd);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * 获取单个 MCP 服务器配置（带来源信息）
 *
 * @param name MCP 服务器名称
 * @param cwd 项目目录
 */
export async function getMcpServerConfigWithSource(name: string, cwd?: string): Promise<McpServerConfigSource | null> {
  const configs = await getMcpServerConfigsWithSource(cwd);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * 添加 MCP 服务器配置
 *
 * @param config MCP 服务器配置
 * @param cwd 当前工作目录
 * @param targetDir 目标目录类型（'project' 或 'user'）
 */
export async function addMcpServerConfig(
  config: McpServerConfig,
  cwd?: string,
  targetDir: 'project' | 'user' = 'project',
): Promise<McpServerConfigSource> {
  const dir = targetDir === 'user'
    ? getUserMcpConfigDir()
    : getProjectMcpConfigDir(cwd ?? process.cwd());

  await ensureDir(dir);

  const existing = await getMcpServerConfigWithSource(config.name, cwd);
  if (existing) {
    throw new Error(`MCP server "${config.name}" already exists at ${existing.filePath}`);
  }

  const filePath = configFilePath(dir, config.name);
  await fs.writeFile(filePath, JSON.stringify(toSerializable(config), null, 2), 'utf-8');

  clearMcpCache();

  return fromSerializable(toSerializable(config), filePath);
}

/**
 * 更新 MCP 服务器配置
 */
export async function updateMcpServerConfig(
  name: string,
  updates: Partial<McpServerConfig>,
  cwd?: string,
): Promise<McpServerConfigSource | null> {
  const existing = await getMcpServerConfigWithSource(name, cwd);
  if (!existing) return null;

  const merged: McpServerConfig = {
    ...existing,
    ...updates,
    transport: updates.transport ?? existing.transport,
  };

  // 如果名称改变，需要删除旧文件
  if (merged.name !== name) {
    await fs.unlink(existing.filePath);
    const newFilePath = configFilePath(path.dirname(existing.filePath), merged.name);
    await fs.writeFile(newFilePath, JSON.stringify(toSerializable(merged), null, 2), 'utf-8');
    clearMcpCache();
    return fromSerializable(toSerializable(merged), newFilePath);
  }

  await fs.writeFile(existing.filePath, JSON.stringify(toSerializable(merged), null, 2), 'utf-8');
  clearMcpCache();

  return fromSerializable(toSerializable(merged), existing.filePath);
}

/**
 * 删除 MCP 服务器配置
 */
export async function deleteMcpServerConfig(name: string, cwd?: string): Promise<boolean> {
  const existing = await getMcpServerConfigWithSource(name, cwd);
  if (!existing) return false;

  try {
    await fs.unlink(existing.filePath);
    clearMcpCache();
    return true;
  } catch {
    return false;
  }
}
