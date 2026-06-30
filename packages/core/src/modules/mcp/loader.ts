// ============================================================
// MCP Loader — 符合 Dot Agents 协议：仅从 .agents/mcp.json 读取
// ============================================================
// TheThing 不再扫描 mcps/*.json 子目录，所有 MCP 配置
// 通过 .agents/mcp.json 单文件（mcpServers 格式）管理。
// ============================================================

import type { McpServerConfig } from './types';
import { logger } from '../../primitives/logger';

// ============================================================
// Public API
// ============================================================

export interface LoadMcpsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
  dirs?: readonly string[];
  configDir?: string;
  homeDir?: string;
}

/**
 * 从 .agents/mcp.json 读取 MCP 服务器配置（Dot Agents 协议的单文件格式）
 * 此文件位于 .agents/ 根目录。
 * 先读取项目级（./.agents/mcp.json），再读取用户级（~/.agents/mcp.json），
 * 项目级覆盖用户级（符合 protocol 的合并顺序：defaults ← ~/.agents ← ./.agents）
 */
async function loadDotAgentsMcpJson(homeDir?: string, cwd?: string): Promise<McpServerConfig[]> {
  if (!homeDir && !cwd) return [];

  const _path = 'path';
  const _fs = 'fs/promises';
  const { default: fs } = await import(/* webpackIgnore: true */ _fs);
  const { default: path } = await import(/* webpackIgnore: true */ _path);

  const dirsToCheck: string[] = [];
  if (cwd) dirsToCheck.push(path.join(cwd, '.agents'));
  if (homeDir) dirsToCheck.push(path.join(homeDir, '.agents'));

  const merged = new Map<string, McpServerConfig>();

  for (const agentsDir of dirsToCheck) {
    const mcpJsonPath = path.join(agentsDir, 'mcp.json');
    try {
      const stat = await fs.stat(mcpJsonPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    try {
      const content = await fs.readFile(mcpJsonPath, 'utf-8');
      const parsed = JSON.parse(content);

      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') continue;

      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        const serverConfig = config as Record<string, unknown>;

        // 标准化 Dot Agents 扁平格式 → TheThing 结构化 transport
        // Dot Agents: { command, args, env, transport: "stdio" }
        // TheThing:  { transport: { type: "stdio", command, args, env } }
        let transport: McpServerConfig['transport'];
        if (typeof serverConfig.transport === 'string') {
          const tType = serverConfig.transport as string;
          if (tType === 'stdio') {
            transport = {
              type: 'stdio',
              command: serverConfig.command as string,
              args: serverConfig.args as string[] | undefined,
              env: serverConfig.env as Record<string, string> | undefined,
            };
          } else if (tType === 'sse' || tType === 'http') {
            transport = {
              type: tType,
              url: serverConfig.url as string,
              headers: serverConfig.headers as Record<string, string> | undefined,
            };
          } else {
            logger.warn('McpLoader', `Skipping "${name}": unknown transport type "${tType}"`);
            continue;
          }
        } else {
          // 已经是结构化格式
          transport = serverConfig as McpServerConfig['transport'];
        }

        merged.set(name, {
          name,
          transport,
          enabled: serverConfig?.enabled !== false,
          sourcePath: mcpJsonPath,
        });
      }
    } catch (error) {
      logger.warn('McpLoader', `Failed to parse ${mcpJsonPath}: ${(error as Error).message}`);
    }
  }

  return Array.from(merged.values());
}

export async function loadMcpServers(options?: LoadMcpsOptions): Promise<McpServerConfig[]> {
  // 仅从 .agents/mcp.json 读取（Dot Agents 协议标准，项目级优先）
  return loadDotAgentsMcpJson(options?.homeDir, options?.cwd);
}

/**
 * 从单个 .agents/mcp.json 格式文件加载 MCP 服务器
 * 用于兼容接口
 */
export async function loadMcpFile(
  _filePath: string,
  _source: 'user' | 'project',
): Promise<McpServerConfig[]> {
  // 协议标准不再使用单文件加载模式，返回空
  return [];
}


// ============================================================
// 兼容接口
// ============================================================

export interface McpLoaderConfig {
  sources?: ('user' | 'project')[];
}

export async function scanMcpDirs(
  cwd?: string,
  config?: Partial<McpLoaderConfig> & {
    configDir?: string;
    homeDir?: string;
    dirs?: readonly string[];
  },
): Promise<McpServerConfig[]> {
  return loadMcpServers({
    cwd,
    sources: config?.sources as ('user' | 'project')[] | undefined,
    configDir: config?.configDir,
    homeDir: config?.homeDir,
    dirs: config?.dirs,
  });
}

export async function getAvailableMcpServers(cwd?: string): Promise<McpServerConfig[]> {
  return loadMcpServers({ cwd });
}

export const MCP_LOADER_MODULE_VERSION = '2.0.0';
