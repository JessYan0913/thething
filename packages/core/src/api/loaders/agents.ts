// ============================================================
// Agents Loader (Subagents)
// ============================================================
//
// 注意：使用全局单例 getResolvedConfigDirName() 获取 configDirName，
// 该值在 bootstrap() 时通过 setResolvedConfigDirName() 设置。

import { parseFrontmatterFile, parseFrontmatterContent, parseToolsList, ParseError } from '../../foundation/parser';
import { scanDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import type { AgentDefinition, AgentSource } from '../../extensions/subagents/types';
import { AgentFrontmatterSchema } from '../../extensions/subagents/types';
import yaml from 'js-yaml';

// ============================================================
// 扩展类型
// ============================================================

interface AgentWithSource extends AgentDefinition {
  source: 'user' | 'project';
}

// ============================================================
// 缓存
// ============================================================

const agentsCache = new LoadingCache<AgentDefinition[]>();

// ============================================================
// 加载选项
// ============================================================

export interface LoadAgentsOptions {
  cwd?: string;
  sources?: ('user' | 'project')[];
  /** 显式扫描目录（来自 ResolvedLayout.resources.agents） */
  dirs?: readonly string[];
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从 frontmatter 数据中提取 agentType
 * 支持 name 和 agentType 两种字段名
 */
function extractAgentType(data: { name?: string; agentType?: string; displayName?: string }, filePath?: string): string {
  if (data.agentType) return data.agentType;
  if (data.name) return data.name;
  if (data.displayName) {
    // 从 displayName 生成 kebab-case agentType
    const kebab = data.displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (kebab) return kebab;
  }
  // 回退到文件名
  if (filePath) {
    const base = filePath.split('/').pop()?.split('\\').pop() || 'agent';
    return base.replace('.md', '');
  }
  return `agent-${Date.now().toString(36)}`;
}

// ============================================================
// 核心加载函数
// ============================================================

/**
 * 加载 Agents 配置
 *
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 */
export async function loadAgents(options?: LoadAgentsOptions): Promise<AgentDefinition[]> {
  const cwd = options?.cwd ?? process.cwd();
  const sources = options?.sources ?? ['user', 'project'];
  const explicitDirs = options?.dirs;

  // 检查缓存
  const cacheKey = `agents:${cwd}:${explicitDirs ? explicitDirs.join('|') : sources.join(',')}`;
  const cached = agentsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录（使用全局 configDirName）
  const dirs: string[] = explicitDirs ? [...explicitDirs] : [];
  if (!explicitDirs) {
    if (sources.includes('user')) {
      dirs.push(getUserConfigDir('agents'));
    }
    if (sources.includes('project')) {
      dirs.push(getProjectConfigDir(cwd, 'agents'));
    }
  }

  // 扫描文件
  const scanResults = await scanDirs(dirs, { pattern: '*.md' });

  // 加载每个文件
  const agents: AgentWithSource[] = [];
  for (const result of scanResults) {
    try {
      const agent = await loadAgentFile(result.filePath, result.source);
      agents.push(agent);
    } catch (error) {
      console.warn(`[AgentsLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 合并（project > user）
  const merged = mergeByPriority(
    agents,
    ['project', 'user'],
    (a) => a.agentType,
  );

  // 更新缓存
  agentsCache.set(cacheKey, merged);

  return merged;
}

/**
 * 加载单个 Agent 文件
 *
 * @param filePath 文件路径
 * @param source 来源
 * @returns Agent with source
 */
export async function loadAgentFile(
  filePath: string,
  source: 'user' | 'project',
): Promise<AgentWithSource> {
  const result = await parseFrontmatterFile(filePath, AgentFrontmatterSchema);

  return {
    agentType: extractAgentType(result.data, result.filePath),
    displayName: result.data.displayName,
    description: result.data.description,
    tools: parseToolsList(result.data.tools),
    disallowedTools: parseToolsList(result.data.disallowedTools),
    model: result.data.model ?? 'inherit',
    effort: result.data.effort,
    maxTurns: result.data.maxTurns ?? 20,
    permissionMode: result.data.permissionMode,
    background: result.data.background,
    initialPrompt: result.data.initialPrompt,
    isolation: result.data.isolation,
    memory: result.data.memory,
    skills: parseToolsList(result.data.skills),
    instructions: result.body,
    includeParentContext: result.data.includeParentContext ?? false,
    maxParentMessages: result.data.maxParentMessages,
    summarizeOutput: result.data.summarizeOutput ?? true,
    metadata: result.data.metadata,
    filePath: result.filePath,
    source,
  };
}

/**
 * 解析 Agent Markdown 内容
 *
 * 直接从 Markdown 字符串内容转换为 AgentDefinition，不需要文件路径。
 *
 * @param content Markdown 内容字符串（包含 YAML frontmatter）
 * @param source 来源标识（默认 'project'）
 * @returns AgentDefinition
 */
export function parseAgentMarkdown(
  content: string,
  source: AgentSource = 'project',
): AgentDefinition {
  const result = parseFrontmatterContent(content, AgentFrontmatterSchema);

  // Validate that at least one identifier is present (name or agentType)
  if (!result.data.name && !result.data.agentType && !result.data.displayName) {
    throw new ParseError('(inline content)');
  }

  return {
    agentType: extractAgentType(result.data),
    displayName: result.data.displayName,
    description: result.data.description,
    tools: parseToolsList(result.data.tools),
    disallowedTools: parseToolsList(result.data.disallowedTools),
    model: result.data.model ?? 'inherit',
    effort: result.data.effort,
    maxTurns: result.data.maxTurns ?? 20,
    permissionMode: result.data.permissionMode,
    background: result.data.background,
    initialPrompt: result.data.initialPrompt,
    isolation: result.data.isolation,
    memory: result.data.memory,
    skills: parseToolsList(result.data.skills),
    instructions: result.body,
    includeParentContext: result.data.includeParentContext ?? false,
    maxParentMessages: result.data.maxParentMessages,
    summarizeOutput: result.data.summarizeOutput ?? true,
    metadata: result.data.metadata,
    source,
  };
}

/**
 * 将 AgentDefinition 序列化为 Markdown 文件内容
 *
 * @param def Agent 定义
 * @returns Markdown 字符串（包含 YAML frontmatter）
 */
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

/**
 * 清除缓存
 */
export function clearAgentsCache(): void {
  agentsCache.clear();
}

// ============================================================
// 兼容接口（原 extensions/subagents/loader.ts）
// ============================================================

/**
 * Agent 加载配置（保留用于类型兼容）
 */
export interface AgentLoaderConfig {
  sources?: ('user' | 'project')[];
  maxAgents?: number;
  enableCache?: boolean;
}

/**
 * 从 Markdown 文件加载 Agent 定义（兼容接口）
 *
 * @param filePath Markdown 文件路径
 * @returns Agent 定义
 */
export async function loadAgentMarkdown(filePath: string): Promise<AgentDefinition> {
  return loadAgentFile(filePath, 'project');
}

/**
 * 扫描 Agent 目录（兼容接口）
 *
 * @param cwd 当前工作目录
 * @param _config 加载配置（已弃用，保留签名兼容）
 * @returns Agent 定义列表
 */
export async function scanAgentDirs(
  cwd?: string,
  _config?: Partial<AgentLoaderConfig>,
): Promise<AgentDefinition[]> {
  return loadAgents({ cwd });
}

/**
 * 清除 Agent 加载缓存（兼容接口）
 */
export function clearAgentCache(): void {
  clearAgentsCache();
}

/**
 * 获取所有可用 Agent（兼容接口）
 *
 * @param cwd 当前工作目录
 * @param includeBuiltin 是否包含内置 Agent（已弃用，内置 Agent 由 registry 管理）
 * @returns Agent 定义列表
 */
export async function getAvailableAgents(
  cwd?: string,
  includeBuiltin: boolean = true,
): Promise<AgentDefinition[]> {
  return scanAgentDirs(cwd);
}
