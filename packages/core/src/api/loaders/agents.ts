// ============================================================
// Agents Loader (Subagents)
// ============================================================

import { parseFrontmatterFile, parseToolsList } from '../../foundation/parser';
import { scanDirs, mergeByPriority, LoadingCache } from '../../foundation/scanner';
import { detectProjectDir, getUserConfigDir, getProjectConfigDir } from '../../foundation/paths';
import type { AgentDefinition } from '../../extensions/subagents/types';
import { AgentFrontmatterSchema } from '../../extensions/subagents/types';

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
}

// ============================================================
// 加载函数
// ============================================================

/**
 * 加载 Agents 配置
 *
 * @param options 加载选项
 * @returns AgentDefinition 列表
 */
export async function loadAgents(options?: LoadAgentsOptions): Promise<AgentDefinition[]> {
  const cwd = options?.cwd ?? detectProjectDir();
  const sources = options?.sources ?? ['user', 'project'];

  // 检查缓存
  const cacheKey = `agents:${cwd}`;
  const cached = agentsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 构建扫描目录
  const dirs: string[] = [];
  if (sources.includes('user')) {
    dirs.push(getUserConfigDir('agents'));
  }
  if (sources.includes('project')) {
    dirs.push(getProjectConfigDir(cwd, 'agents'));
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

  // 去除 source 字段，但 AgentDefinition 需要 source，所以保留
  const result: AgentDefinition[] = merged.map((a) => ({
    agentType: a.agentType,
    description: a.description,
    tools: a.tools,
    disallowedTools: a.disallowedTools,
    model: a.model,
    effort: a.effort,
    maxTurns: a.maxTurns,
    permissionMode: a.permissionMode,
    background: a.background,
    initialPrompt: a.initialPrompt,
    isolation: a.isolation,
    memory: a.memory,
    skills: a.skills,
    instructions: a.instructions,
    includeParentContext: a.includeParentContext,
    summarizeOutput: a.summarizeOutput,
    source: a.source as 'user' | 'project',
    filePath: a.filePath,
  }));

  // 更新缓存
  agentsCache.set(cacheKey, result);

  return result;
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
    agentType: result.data.name,
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
    skills: typeof result.data.skills === 'string'
      ? result.data.skills.split(',').map(s => s.trim())
      : result.data.skills,
    instructions: result.body,
    includeParentContext: false,
    summarizeOutput: true,
    filePath: result.filePath,  // ParseResult.filePath 是 string
    source,
  };
}

/**
 * 清除缓存
 */
export function clearAgentsCache(): void {
  agentsCache.clear();
}