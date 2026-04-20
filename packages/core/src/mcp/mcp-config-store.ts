import fs from 'fs/promises';
import path from 'path';
import type { McpServerConfig } from './registry';

const DEFAULT_MCP_CONFIG_DIR = path.join(process.cwd(), '.thething', 'mcps');
// 环境变量: THETHING_MCP_DIR
// 允许用户自定义项目 MCP 配置目录
let mcpConfigDir: string = process.env.THETHING_MCP_DIR || DEFAULT_MCP_CONFIG_DIR;

/**
 * Configure MCP config directory.
 */
export function configureMcpConfigDir(dir: string): void {
  mcpConfigDir = dir;
}

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(mcpConfigDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

function configFilePath(name: string): string {
  return path.join(mcpConfigDir, `${encodeURIComponent(name)}.json`);
}

function toSerializable(config: McpServerConfig): Record<string, unknown> {
  return {
    name: config.name,
    transport: config.transport,
    enabled: config.enabled ?? true,
    tools: config.tools,
    elicitation: config.elicitation,
  };
}

function fromSerializable(data: Record<string, unknown>): McpServerConfig {
  return {
    name: data.name as string,
    transport: data.transport as McpServerConfig['transport'],
    enabled: data.enabled as boolean,
    tools: data.tools as McpServerConfig['tools'],
    elicitation: data.elicitation as McpServerConfig['elicitation'],
  };
}

export async function getMcpServerConfigs(): Promise<McpServerConfig[]> {
  await ensureDir();

  let entries: string[];
  try {
    entries = await fs.readdir(mcpConfigDir);
  } catch {
    return [];
  }

  const configs: McpServerConfig[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(mcpConfigDir, entry), 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;
      configs.push(fromSerializable(data));
    } catch {
      // skip corrupted files
    }
  }

  return configs;
}

export async function getMcpServerConfig(name: string): Promise<McpServerConfig | null> {
  const filePath = configFilePath(name);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return fromSerializable(JSON.parse(content) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function addMcpServerConfig(config: McpServerConfig): Promise<McpServerConfig> {
  await ensureDir();

  const existing = await getMcpServerConfig(config.name);
  if (existing) {
    throw new Error(`MCP server "${config.name}" already exists`);
  }

  const filePath = configFilePath(config.name);
  await fs.writeFile(filePath, JSON.stringify(toSerializable(config), null, 2), 'utf-8');
  return config;
}

export async function updateMcpServerConfig(name: string, updates: Partial<McpServerConfig>): Promise<McpServerConfig | null> {
  const existing = await getMcpServerConfig(name);
  if (!existing) return null;

  const merged: McpServerConfig = {
    ...existing,
    ...updates,
    transport: updates.transport ?? existing.transport,
  };

  const filePath = configFilePath(name);
  if (merged.name !== name) {
    // Name changed — remove old file
    await fs.unlink(configFilePath(name));
  }

  await fs.writeFile(filePath, JSON.stringify(toSerializable(merged), null, 2), 'utf-8');
  return merged;
}

export async function deleteMcpServerConfig(name: string): Promise<boolean> {
  const filePath = configFilePath(name);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
