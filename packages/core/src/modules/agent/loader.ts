// ============================================================
// Agents Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parseFrontmatterFile, parseFrontmatterContent, parseToolsList, ParseError } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { AgentDefinition, AgentSource } from './types';
import { AgentFrontmatterSchema } from './types';
import yaml from 'js-yaml';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从原始数据构建 AgentDefinition，消除多处重复映射
 */
function buildAgentDefinitionFromData(
  data: Record<string, unknown>,
  body: string,
  source: AgentSource,
  filePath?: string,
  configJson?: Record<string, unknown>,
): AgentDefinition {
  // 如果提供了 config.json（Dot Agents 协议），用它覆盖 frontmatter 中的字段
  const mergedData = configJson
    ? { ...data, ...mergeAgentConfig(data, configJson) }
    : data;

  return {
    agentType: extractAgentType(mergedData as { name?: string; agentType?: string; displayName?: string }, filePath),
    displayName: mergedData.displayName as string | undefined,
    description: mergedData.description as string,
    tools: parseToolsList(mergedData.tools as string[] | undefined),
    disallowedTools: parseToolsList(mergedData.disallowedTools as string[] | undefined),
    model: (mergedData.model as string) ?? 'inherit',
    effort: mergedData.effort as 'low' | 'medium' | 'high' | number | undefined,
    maxTurns: (mergedData.maxTurns as number) ?? 20,
    permissionMode: mergedData.permissionMode as 'acceptEdits' | 'plan' | 'bypassPermissions' | undefined,
    background: mergedData.background as boolean | undefined,
    initialPrompt: mergedData.initialPrompt as string | undefined,
    isolation: mergedData.isolation as 'worktree' | undefined,
    memory: mergedData.memory as 'user' | 'project' | 'local' | undefined,
    skills: parseToolsList(mergedData.skills as string[] | undefined),
    instructions: body,
    includeParentContext: (mergedData.includeParentContext as boolean) ?? false,
    maxParentMessages: mergedData.maxParentMessages as number | undefined,
    summarizeOutput: (mergedData.summarizeOutput as boolean) ?? true,
    metadata: {
      ...(mergedData.metadata as Record<string, unknown> | undefined),
      // Dot Agents 协议字段，原生存储
      ...(mergedData.role ? { role: mergedData.role } : {}),
      ...(mergedData.enabled !== undefined ? { enabled: mergedData.enabled } : {}),
      ...(mergedData['connection-type'] ? { 'connection-type': mergedData['connection-type'] } : {}),
    } as Record<string, unknown> | undefined,
    source,
    filePath,
  };
}

/**
 * 将 Dot Agents 协议 config.json 的字段合并到 agent frontmatter 数据中
 */
function mergeAgentConfig(
  data: Record<string, unknown>,
  configJson: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // modelConfig.mcpToolsProviderId → model
  const modelConfig = configJson.modelConfig as Record<string, unknown> | undefined;
  if (modelConfig?.mcpToolsProviderId && !data.model) {
    result.model = modelConfig.mcpToolsProviderId;
  }

  // connection → isolation/background
  const connection = configJson.connection as Record<string, unknown> | undefined;
  if (connection?.type === 'stdio') {
    result.connectionType = 'stdio';
    result.isolation = 'worktree';
  }

  return result;
}

/**
 * 从 frontmatter 提取 agent 标识符。
 *
 * Dot Agents 协议使用 `id` 字段作为标识符，TheThing 使用 `agentType`。
 * fallback 链（优先级从高到低）：
 *   agentType > id > name > displayName > filename > 随机
 */
function extractAgentType(data: { id?: string; name?: string; agentType?: string; displayName?: string }, filePath?: string): string {
  if (data.agentType) return data.agentType;
  if (data.id) return data.id;
  if (data.name) return data.name;
  if (data.displayName) {
    const kebab = data.displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (kebab) return kebab;
  }
  if (filePath) {
    const base = filePath.split('/').pop()?.split('\\').pop() || 'agent';
    return base.replace('.md', '');
  }
  return `agent-${Date.now().toString(36)}`;
}

// ============================================================
// MultiSource Loader
// ============================================================

const agentsLoader = createMultiSourceLoader<AgentDefinition>({
  subcategory: 'agents',
  filePattern: '*.md',
  parse: async (filePath, source) => {
    const result = await parseFrontmatterFile(filePath, AgentFrontmatterSchema);
    return buildAgentDefinitionFromData(result.data, result.body, source, result.filePath);
  },
  getMergeKey: (item) => item.agentType,
});

/**
 * 判断一个目录路径是否为 .agents 协议目录
 * .agents 协议使用子目录结构（<name>/agent.md）
 * .thething 使用平面文件（<name>.md）
 */
function isDotAgentsDir(dir: string): boolean {
  // 检查路径中是否包含 /.agents/ 作为目录组件
  return dir.includes('/.agents/');
}

// ============================================================
// Dot Agents 兼容 Loader（configDir 模式，用于 .agents/agents/<name>/agent.md）
// ============================================================

const agentsDotAgentsLoader = createMultiSourceLoader<AgentDefinition>({
  subcategory: 'agents-dotagents',
  filePattern: 'agent.md',
  scanMode: 'configDir',
  dirPattern: '*',
  parse: async (filePath, source) => {
    const result = await parseFrontmatterFile(filePath, AgentFrontmatterSchema);

    // 尝试读取同目录下的 config.json（Dot Agents 协议标准）
    let configJson: Record<string, unknown> | undefined;
    const _path2 = 'path';
    const _fs2 = 'fs/promises';
    const { default: fs2 } = await import(/* webpackIgnore: true */ _fs2).catch(() => ({ default: null as any }));
    const { default: path2 } = await import(/* webpackIgnore: true */ _path2).catch(() => ({ default: null as any }));
    if (fs2 && path2) {
      const configPath = path2.join(path2.dirname(filePath), 'config.json');
      try {
        const stat = await fs2.stat(configPath);
        if (stat.isFile()) {
          const content = await fs2.readFile(configPath, 'utf-8');
          configJson = JSON.parse(content) as Record<string, unknown>;
        }
      } catch {
        // config.json 不存在，忽略
      }
    }

    return buildAgentDefinitionFromData(result.data, result.body, source, result.filePath, configJson);
  },
  getMergeKey: (item) => item.agentType,
});

// ============================================================
// Public API
// ============================================================

export interface LoadAgentsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
  dirs?: readonly string[];
  configDir?: string;
  homeDir?: string;
}

export async function loadAgents(options?: LoadAgentsOptions): Promise<AgentDefinition[]> {
  const dirs = options?.dirs;
  if (!dirs || dirs.length === 0) {
    return agentsLoader.load({
      cwd: options?.cwd,
      configDir: options?.configDir,
      homeDir: options?.homeDir,
      dirs,
    });
  }

  // 分离 .agents 和 .thething 目录，各自使用对应的扫描模式
  const thethingDirs = dirs.filter(d => !isDotAgentsDir(d));
  const dotAgentsDirs = dirs.filter(d => isDotAgentsDir(d));

  const results: AgentDefinition[] = [];

  if (thethingDirs.length > 0) {
    const flatItems = await agentsLoader.load({
      cwd: options?.cwd,
      configDir: options?.configDir,
      homeDir: options?.homeDir,
      dirs: thethingDirs,
    });
    results.push(...flatItems);
  }

  if (dotAgentsDirs.length > 0) {
    const configDirItems = await agentsDotAgentsLoader.load({
      cwd: options?.cwd,
      configDir: options?.configDir,
      homeDir: options?.homeDir,
      dirs: dotAgentsDirs,
    });
    results.push(...configDirItems);
  }

  // 按 agentType 去重（.agents 覆盖 .thething）
  const merged = new Map<string, AgentDefinition>();
  for (const item of results) {
    merged.set(item.agentType, item);
  }
  return Array.from(merged.values());
}

export async function loadAgentFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<AgentDefinition> {
  const result = await parseFrontmatterFile(filePath, AgentFrontmatterSchema);
  return buildAgentDefinitionFromData(result.data, result.body, source, result.filePath);
}

export function parseAgentMarkdown(
  content: string,
  source: AgentSource = 'project',
): AgentDefinition {
  const result = parseFrontmatterContent(content, AgentFrontmatterSchema);

  if (!result.data.name && !result.data.agentType && !result.data.displayName) {
    throw new ParseError('(inline content)');
  }

  return buildAgentDefinitionFromData(result.data, result.body, source);
}

export function serializeAgentMarkdown(
  def: AgentDefinition,
  format: 'thething' | 'dotagents' = 'thething',
): string {
  let frontmatter: Record<string, unknown>;

  if (format === 'dotagents') {
    // Dot Agents 协议标准格式
    frontmatter = {
      id: def.agentType,
      name: def.displayName ?? def.agentType,
      description: def.description,
      role: 'delegation-target',
      enabled: true,
      'connection-type': 'internal',
      // 以下为 TheThing 扩展字段（保持兼容）
      model: def.model ?? 'inherit',
      effort: def.effort,
      maxTurns: def.maxTurns ?? 20,
      tools: def.tools ?? [],
      skills: def.skills ?? [],
      includeParentContext: def.includeParentContext ?? false,
      summarizeOutput: def.summarizeOutput ?? true,
    };
  } else {
    // TheThing 原生格式
    frontmatter = {
      agentType: def.agentType,
      displayName: def.displayName,
      description: def.description,
      tools: def.tools ?? [],
      disallowedTools: def.disallowedTools ?? [],
      model: def.model ?? 'inherit',
      effort: def.effort,
      maxTurns: def.maxTurns ?? 20,
      permissionMode: def.permissionMode,
      background: def.background ?? false,
      initialPrompt: def.initialPrompt,
      isolation: def.isolation,
      memory: def.memory,
      skills: def.skills ?? [],
      includeParentContext: def.includeParentContext ?? false,
      maxParentMessages: def.maxParentMessages,
      summarizeOutput: def.summarizeOutput ?? true,
      source: def.source ?? 'user',
      metadata: def.metadata ?? {},
    };
  }

  const yamlContent = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    skipInvalid: true,
    quotingType: '"',
    forceQuotes: false,
  });

  return `---\n${yamlContent}---\n${def.instructions ?? ''}\n`;
}


// ============================================================
// 兼容接口
// ============================================================

export interface AgentLoaderConfig {
  sources?: ('user' | 'project')[];
  maxAgents?: number;
  enableCache?: boolean;
}

export async function loadAgentMarkdown(filePath: string): Promise<AgentDefinition> {
  return loadAgentFile(filePath, 'project');
}

export async function scanAgentDirs(
  cwd?: string,
  config?: Partial<AgentLoaderConfig> & {
    dirs?: readonly string[];
    configDir?: string;
    homeDir?: string;
  },
): Promise<AgentDefinition[]> {
  return loadAgents({
    cwd,
    sources: config?.sources,
    dirs: config?.dirs,
    configDir: config?.configDir,
    homeDir: config?.homeDir,
  });
}


export async function getAvailableAgents(
  cwd?: string,
  _includeBuiltin: boolean = true,
): Promise<AgentDefinition[]> {
  return scanAgentDirs(cwd);
}
