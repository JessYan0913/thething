// ============================================================
// MCP Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parseJsonFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { McpServerConfig } from './types';
import { McpServerConfigSchema } from './types';
import type { ConfigSource } from '../../primitives/constants';

// ============================================================
// 扩展类型
// ============================================================

interface McpConfigWithSource extends McpServerConfig {
  source: ConfigSource;
  filePath: string;
}

// ============================================================
// MultiSource Loader
// ============================================================

const mcpsLoader = createMultiSourceLoader<McpConfigWithSource>({
  subcategory: 'mcps',
  filePattern: '*.json',
  parse: async (filePath, source) => {
    const result = await parseJsonFile(filePath, McpServerConfigSchema);
    return {
      name: result.data.name,
      transport: result.data.transport as McpServerConfig['transport'],
      enabled: result.data.enabled,
      tools: result.data.tools,
      elicitation: result.data.elicitation,
      source,
      filePath: result.filePath,
    };
  },
  getMergeKey: (item) => item.name,
});

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

export async function loadMcpServers(options?: LoadMcpsOptions): Promise<McpServerConfig[]> {
  const items = await mcpsLoader.load({
    cwd: options?.cwd,
    configDir: options?.configDir,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });

  return items.map((m) => ({
    name: m.name,
    transport: m.transport,
    enabled: m.enabled,
    tools: m.tools,
    elicitation: m.elicitation,
    sourcePath: m.filePath,
  }));
}

export async function loadMcpFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<McpConfigWithSource> {
  const result = await parseJsonFile(filePath, McpServerConfigSchema);

  return {
    name: result.data.name,
    transport: result.data.transport as McpServerConfig['transport'],
    enabled: result.data.enabled,
    tools: result.data.tools,
    elicitation: result.data.elicitation,
    source,
    filePath: result.filePath,
  };
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

export const MCP_LOADER_MODULE_VERSION = '1.0.0';
