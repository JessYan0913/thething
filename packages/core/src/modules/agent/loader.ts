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
): AgentDefinition {
  return {
    agentType: extractAgentType(data as { name?: string; agentType?: string; displayName?: string }, filePath),
    displayName: data.displayName as string | undefined,
    description: data.description as string,
    tools: parseToolsList(data.tools as string[] | undefined),
    disallowedTools: parseToolsList(data.disallowedTools as string[] | undefined),
    model: (data.model as string) ?? 'inherit',
    effort: data.effort as 'low' | 'medium' | 'high' | number | undefined,
    maxTurns: (data.maxTurns as number) ?? 20,
    permissionMode: data.permissionMode as 'acceptEdits' | 'plan' | 'bypassPermissions' | undefined,
    background: data.background as boolean | undefined,
    initialPrompt: data.initialPrompt as string | undefined,
    isolation: data.isolation as 'worktree' | undefined,
    memory: data.memory as 'user' | 'project' | 'local' | undefined,
    skills: parseToolsList(data.skills as string[] | undefined),
    instructions: body,
    includeParentContext: (data.includeParentContext as boolean) ?? false,
    maxParentMessages: data.maxParentMessages as number | undefined,
    summarizeOutput: (data.summarizeOutput as boolean) ?? true,
    metadata: data.metadata as Record<string, unknown> | undefined,
    source,
    filePath,
  };
}

function extractAgentType(data: { name?: string; agentType?: string; displayName?: string }, filePath?: string): string {
  if (data.agentType) return data.agentType;
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

// ============================================================
// Public API
// ============================================================

export interface LoadAgentsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
  dirs?: readonly string[];
  configDirName?: string;
  homeDir?: string;
}

export async function loadAgents(options?: LoadAgentsOptions): Promise<AgentDefinition[]> {
  return agentsLoader.load({
    cwd: options?.cwd,
    configDirName: options?.configDirName,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });
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

export function serializeAgentMarkdown(def: AgentDefinition): string {
  const frontmatter: Record<string, unknown> = {
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
    configDirName?: string;
    homeDir?: string;
  },
): Promise<AgentDefinition[]> {
  return loadAgents({
    cwd,
    sources: config?.sources,
    dirs: config?.dirs,
    configDirName: config?.configDirName,
    homeDir: config?.homeDir,
  });
}


export async function getAvailableAgents(
  cwd?: string,
  _includeBuiltin: boolean = true,
): Promise<AgentDefinition[]> {
  return scanAgentDirs(cwd);
}
