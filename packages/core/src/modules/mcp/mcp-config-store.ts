// ============================================================
// MCP 配置存储 — 符合 Dot Agents 协议
// ============================================================
// 所有 MCP 配置通过 .agents/mcp.json 单文件（mcpServers 格式）管理。
// 用户级：~/.agents/mcp.json
// 项目级：{cwd}/.agents/mcp.json（覆盖用户级）
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { logger } from '../../primitives/logger';
import type { McpServerConfig, McpServerConfigSource } from './types';

// ============================================================
// 路径常量
// ============================================================

/**
 * 获取用户级 mcp.json 路径。
 * 优先使用 configDir（新标准位置），fallback 到 .agents（Dot Agents 兼容）。
 * @param configDir 配置目录（如 ~/.thething），可选
 */
function getUserMcpJsonPath(configDir?: string): string {
  if (configDir) return path.join(configDir, 'mcp.json');
  return path.join(homedir(), '.agents', 'mcp.json');
}

/**
 * 获取项目级 mcp.json 路径。
 * 优先使用 configDirName（新标准），fallback 到 .agents（Dot Agents 兼容）。
 * @param cwd 项目根目录
 * @param configDirName 配置目录名（如 .thething），可选
 */
function getProjectMcpJsonPath(cwd: string, configDirName?: string): string {
  if (configDirName) return path.join(cwd, configDirName, 'mcp.json');
  return path.join(cwd, '.agents', 'mcp.json');
}

// ============================================================
// Dot Agents 格式的扁平 ↔ 结构化转换
// ============================================================

/**
 * 将 TheThing 结构化 transport 转换为 Dot Agents 扁平格式条目
 */
function toDotAgentsEntry(config: McpServerConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  const t = config.transport;

  if (t.type === 'stdio') {
    entry.command = t.command;
    if (t.args) entry.args = t.args;
    if (t.env) entry.env = t.env;
    entry.transport = 'stdio';
  } else {
    entry.url = t.url;
    if (t.headers) entry.headers = t.headers;
    entry.transport = t.type;
  }

  // TheThing-specific extensions
  if (config.enabled === false) entry.enabled = false;
  if (config.autoConnect === false) entry.autoConnect = false;
  if (config.alwaysLoad) entry.alwaysLoad = true;
  if (config.connectionTimeout) entry.connectionTimeout = config.connectionTimeout;
  if (config.tools) entry.tools = config.tools;
  if (config.elicitation) entry.elicitation = config.elicitation;

  return entry;
}

/**
 * 将 Dot Agents 扁平配置解析为结构化 transport，解析失败返回 null
 */
function parseFlatTransport(
  name: string,
  entry: Record<string, unknown>,
): McpServerConfig['transport'] | null {
  const tType = entry.transport as string | undefined;

  if (tType === 'stdio') {
    return {
      type: 'stdio',
      command: entry.command as string,
      args: entry.args as string[] | undefined,
      env: entry.env as Record<string, string> | undefined,
    };
  }

  if (tType === 'sse' || tType === 'http' || tType === 'streamable-http') {
    return {
      type: tType,
      url: entry.url as string,
      headers: entry.headers as Record<string, string> | undefined,
    } as McpServerConfig['transport'];
  }

  logger.warn('McpConfigStore', `Skipping "${name}": unknown transport type "${tType}"`);
  return null;
}

// ============================================================
// 读写 .agents/mcp.json
// ============================================================

async function readDotAgentsFile(filePath: string): Promise<Map<string, McpServerConfig>> {
  const servers = new Map<string, McpServerConfig>();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') return servers;

    for (const [name, config] of Object.entries(parsed.mcpServers)) {
      const entry = config as Record<string, unknown>;
      const transport = parseFlatTransport(name, entry);
      if (!transport) continue;

      servers.set(name, {
        name,
        transport,
        enabled: entry.enabled !== false,
        autoConnect: entry.autoConnect as boolean | undefined,
        alwaysLoad: entry.alwaysLoad as boolean | undefined,
        connectionTimeout: entry.connectionTimeout as number | undefined,
        tools: entry.tools as McpServerConfig['tools'],
        elicitation: entry.elicitation as McpServerConfig['elicitation'],
      });
    }
  } catch {
    // file not found or invalid → empty map
  }
  return servers;
}

async function writeDotAgentsFile(filePath: string, servers: Map<string, McpServerConfig>): Promise<void> {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, config] of servers) {
    mcpServers[name] = toDotAgentsEntry(config);
  }
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ mcpServers }, null, 2), 'utf-8');
}

// ============================================================
// 公共 API
// ============================================================

/**
 * 获取所有 MCP 服务器配置（通过 Loader，不带来源信息）
 */
export async function getMcpServerConfigs(cwd?: string, configDir?: string): Promise<McpServerConfig[]> {
  const { loadMcpServers } = await import('./loader');
  const configDirName = configDir ? configDir.split(/[/\\]/).filter(Boolean).pop() : undefined;
  return loadMcpServers({ cwd, homeDir: homedir(), configDir, configDirName });
}

/**
 * 获取所有 MCP 服务器配置（带来源信息）
 */
export async function getMcpServerConfigsWithSource(cwd?: string, configDir?: string): Promise<McpServerConfigSource[]> {
  const effectiveCwd = cwd ?? process.cwd();
  const configDirName = configDir ? configDir.split(/[/\\]/).filter(Boolean).pop() : undefined;
  const paths: Array<{ source: 'user' | 'project'; filePath: string }> = [
    { source: 'user', filePath: getUserMcpJsonPath(configDir) },
    { source: 'project', filePath: getProjectMcpJsonPath(effectiveCwd, configDirName) },
  ];

  const configs: McpServerConfigSource[] = [];
  for (const { source, filePath } of paths) {
    const servers = await readDotAgentsFile(filePath);
    for (const [, config] of servers) {
      configs.push({ ...config, source, filePath });
    }
  }
  return configs;
}

/**
 * 获取单个 MCP 服务器配置
 */
export async function getMcpServerConfig(name: string, cwd?: string, _configDir?: string): Promise<McpServerConfig | null> {
  const configs = await getMcpServerConfigs(cwd);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * 获取单个 MCP 服务器配置（带来源信息）
 */
export async function getMcpServerConfigWithSource(name: string, cwd?: string, configDir?: string): Promise<McpServerConfigSource | null> {
  const configs = await getMcpServerConfigsWithSource(cwd, configDir);
  return configs.find((c) => c.name === name) ?? null;
}

/**
 * 添加 MCP 服务器配置
 *
 * 写入 .agents/mcp.json（Dot Agents 协议单文件格式）。
 * 默认写入用户级（~/.agents/mcp.json）。
 *
 * @param config MCP 服务器配置
 * @param cwd 当前工作目录（项目级写入时使用）
 * @param configDir 配置目录（如 ~/.thething），可选
 * @param targetDir 目标层级（'user' | 'project'），默认 'user'
 */
export async function addMcpServerConfig(
  config: McpServerConfig,
  cwd?: string,
  configDir?: string,
  targetDir: 'user' | 'project' = 'user',
): Promise<McpServerConfigSource> {
  const configDirName = configDir ? configDir.split(/[/\\]/).filter(Boolean).pop() : undefined;
  const targetPath = targetDir === 'user'
    ? getUserMcpJsonPath(configDir)
    : getProjectMcpJsonPath(cwd ?? process.cwd(), configDirName);

  // 检查是否已存在（跨 user 和 project 检查）
  const existing = await getMcpServerConfig(config.name, cwd);
  if (existing) {
    throw new Error(`MCP server "${config.name}" already exists`);
  }

  const servers = await readDotAgentsFile(targetPath);
  servers.set(config.name, config);
  await writeDotAgentsFile(targetPath, servers);

  return { ...config, source: targetDir, filePath: targetPath };
}

/**
 * 更新 MCP 服务器配置
 *
 * 在 .agents/mcp.json 中找到该服务器并更新。
 * 先在项目级查找，再在用户级查找。
 */
export async function updateMcpServerConfig(
  name: string,
  updates: Partial<McpServerConfig>,
  cwd?: string,
  configDir?: string,
): Promise<McpServerConfigSource | null> {
  const effectiveCwd = cwd ?? process.cwd();
  const configDirName = configDir ? configDir.split(/[/\\]/).filter(Boolean).pop() : undefined;
  const paths: Array<{ source: 'user' | 'project'; filePath: string }> = [
    { source: 'project', filePath: getProjectMcpJsonPath(effectiveCwd, configDirName) },
    { source: 'user', filePath: getUserMcpJsonPath(configDir) },
  ];

  for (const { source, filePath } of paths) {
    const servers = await readDotAgentsFile(filePath);
    const existing = servers.get(name);
    if (!existing) continue;

    const merged: McpServerConfig = { ...existing, ...updates };
    merged.transport = updates.transport ?? existing.transport;

    if (merged.name !== name) {
      servers.delete(name);
    }
    servers.set(merged.name, merged);
    await writeDotAgentsFile(filePath, servers);

    return { ...merged, source, filePath };
  }

  return null;
}

/**
 * 删除 MCP 服务器配置
 *
 * 在 .agents/mcp.json 中找到该服务器并删除。
 * 先在项目级查找，再在用户级查找。
 */
export async function deleteMcpServerConfig(name: string, cwd?: string, configDir?: string): Promise<boolean> {
  const effectiveCwd = cwd ?? process.cwd();
  const configDirName = configDir ? configDir.split(/[/\\]/).filter(Boolean).pop() : undefined;
  const paths = [
    getProjectMcpJsonPath(effectiveCwd, configDirName),
    getUserMcpJsonPath(configDir),
  ];

  for (const filePath of paths) {
    const servers = await readDotAgentsFile(filePath);
    if (!servers.has(name)) continue;

    servers.delete(name);
    await writeDotAgentsFile(filePath, servers);
    return true;
  }

  return false;
}

// ============================================================
// 已废弃：旧 mcps/*.json 子目录路径
// ============================================================

/** @deprecated Dot Agents 协议使用 ~/.agents/mcp.json 单文件 */
export function getUserMcpConfigDir(configDir: string): string {
  return path.join(configDir, 'mcps');
}

/** @deprecated Dot Agents 协议使用 {cwd}/.agents/mcp.json 单文件 */
export function getProjectMcpConfigDir(cwd: string, configDir: string): string {
  return path.join(cwd, path.basename(configDir), 'mcps');
}

/** @deprecated */
export function getDefaultMcpConfigDir(configDir: string): string {
  return getProjectMcpConfigDir(process.cwd(), configDir);
}
