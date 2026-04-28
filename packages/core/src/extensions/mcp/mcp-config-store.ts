import fs from 'fs/promises';
import path from 'path';
import { detectProjectDir } from '../../foundation/paths';
import { scanMcpDirs, clearMcpCache } from '../../api/loaders/mcps';
import { DEFAULT_PROJECT_CONFIG_DIR_NAME } from '../../config/defaults';
import type { McpServerConfig, McpServerConfigSource } from './types';

// ============================================================
// MCP 配置目录
// ============================================================

/**
 * 获取用户级 MCP 配置目录
 */
export function getUserMcpConfigDir(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'mcps');
}

/**
 * 获取项目级 MCP 配置目录
 */
export function getProjectMcpConfigDir(cwd: string): string {
  return path.join(cwd, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'mcps');
}

/**
 * 获取默认 MCP 配置目录（项目级）
 */
export function getDefaultMcpConfigDir(): string {
  return getProjectMcpConfigDir(detectProjectDir());
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
 */
function fromSerializable(data: Record<string, unknown>, filePath: string): McpServerConfigSource {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const userConfigDir = path.join(homeDir, DEFAULT_PROJECT_CONFIG_DIR_NAME, 'mcps');

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
 */
export async function getMcpServerConfigs(cwd?: string): Promise<McpServerConfig[]> {
  return scanMcpDirs(cwd);
}

/**
 * 获取所有 MCP 服务器配置（带来源信息）
 */
export async function getMcpServerConfigsWithSource(cwd?: string): Promise<McpServerConfigSource[]> {
  const effectiveCwd = cwd ?? detectProjectDir();
  const configs: McpServerConfigSource[] = [];
  const dirs: string[] = [getUserMcpConfigDir(), getProjectMcpConfigDir(effectiveCwd)];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        try {
          const filePath = path.join(dir, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as Record<string, unknown>;
          configs.push(fromSerializable(data, filePath));
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
 */
export async function getMcpServerConfig(name: string, cwd?: string): Promise<McpServerConfig | null> {
  const configs = await getMcpServerConfigsWithSource(cwd);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * 获取单个 MCP 服务器配置（带来源信息）
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
    : getProjectMcpConfigDir(cwd ?? detectProjectDir());

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