// ============================================================
// MCP Loader — 符合 Dot Agents 协议：仅从 .agents/mcp.json 读取
// ============================================================
// TheThing 不再扫描 mcps/*.json 子目录，所有 MCP 配置
// 通过 .agents/mcp.json 单文件（mcpServers 格式）管理。
// ============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { McpServerConfig } from './types';
import { logger } from '../../primitives/logger';

const execFileAsync = promisify(execFile);

// ============================================================
// PATH Resolution (从 registry.ts 移入，配置加载阶段一次性完成)
// ============================================================

/** 缓存：command → 绝对路径 */
const _resolvedCommandCache = new Map<string, string>();
/** 缓存：完整 PATH 字符串 */
let _resolvedFullPath: string | null | undefined; // undefined=未初始化

/**
 * 通过用户登录 shell 解析完整 PATH。
 * Electron 桌面应用的 process.env.PATH 通常只有系统默认值，
 * 不含 nvm / Homebrew / conda 等通过 shell profile 注入的路径。
 */
async function resolveUserPath(): Promise<string | null> {
  if (_resolvedFullPath !== undefined) return _resolvedFullPath;

  const shell = process.env.SHELL || '/bin/zsh';
  const shellName = shell.split('/').pop() ?? 'zsh';
  const currentPath = process.env.PATH || '';

  logger.debug('MCP', `Resolving user PATH via ${shell}`);

  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'echo "$PATH"'], {
      timeout: 10_000,
      env: process.env as Record<string, string>,
    });

    const resolved = stdout.trim();
    if (resolved && resolved !== currentPath) {
      _resolvedFullPath = resolved;
      logger.debug('MCP', `Resolved user PATH via ${shellName} (${resolved.length} chars)`);
      return resolved;
    }

    logger.debug('MCP', `User PATH same as process PATH, no override needed`);
  } catch (err) {
    logger.error('MCP', `Failed to resolve PATH via ${shellName}: ${err instanceof Error ? err.message : err}`);
  }

  _resolvedFullPath = null;
  return null;
}

/**
 * 解析命令的绝对路径（如 npx → /Users/xxx/.nvm/.../bin/npx）。
 * 优先使用缓存，未缓存时通过用户登录 shell 的 which 命令解析。
 */
async function resolveCommand(command: string): Promise<string> {
  // 已是绝对路径，直接返回
  if (command.startsWith('/')) return command;
  // 已缓存，直接返回
  const cached = _resolvedCommandCache.get(command);
  if (cached) return cached;

  const shell = process.env.SHELL || '/bin/zsh';

  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', `which ${command}`], {
      timeout: 5_000,
      env: process.env as Record<string, string>,
    });

    const fullPath = stdout.trim();
    if (fullPath && fullPath.startsWith('/') && !fullPath.includes('not found')) {
      _resolvedCommandCache.set(command, fullPath);
      logger.debug('MCP', `Resolved command '${command}' → ${fullPath}`);
      return fullPath;
    }
  } catch {}

  // 解析失败，返回原始命令名（让 spawn 按系统 PATH 查找）
  logger.debug('MCP', `Could not resolve '${command}', using as-is`);
  return command;
}

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
          } else if (tType === 'sse' || tType === 'http' || tType === 'streamable-http') {
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
          autoConnect: serverConfig?.autoConnect as boolean | undefined,
          alwaysLoad: serverConfig?.alwaysLoad as boolean | undefined,
          connectionTimeout: serverConfig?.connectionTimeout as number | undefined,
          tools: serverConfig?.tools as { include?: string[]; exclude?: string[] } | undefined,
          elicitation: serverConfig?.elicitation as { enabled: boolean } | undefined,
          sourcePath: mcpJsonPath,
        });
      }
    } catch (error) {
      logger.warn('McpLoader', `Failed to parse ${mcpJsonPath}: ${(error as Error).message}`);
    }
  }

  // 预解析 stdio 命令的绝对路径和用户完整 PATH
  const configs = Array.from(merged.values());
  const userPath = await resolveUserPath();

  for (const config of configs) {
    if (config.transport.type === 'stdio') {
      config.transport.command = await resolveCommand(config.transport.command);
      // 注入用户完整 PATH（如果配置中没有显式设置）
      if (userPath && !config.transport.env?.PATH) {
        config.transport.env = { ...config.transport.env, PATH: userPath };
      }
    }
  }

  return configs;
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
