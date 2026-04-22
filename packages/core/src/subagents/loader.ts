import path from 'path';
import { parseFrontmatterFile, parseToolsList, scanConfigDirs, getUserConfigDir, getProjectConfigDir, mergeByPriority, LoadingCache } from '../loading';
import type { AgentDefinition, AgentFrontmatter, AgentSource } from './types';
import { AgentFrontmatterSchema } from './types';

// ============================================================
// Agent 加载配置
// ============================================================

export interface AgentLoaderConfig {
  /** 扫描目录（默认 ['user', 'project']） */
  sources?: ('user' | 'project')[];
  /** 最大 Agent 数量 */
  maxAgents?: number;
  /** 是否启用缓存 */
  enableCache?: boolean;
}

const DEFAULT_AGENT_LOADER_CONFIG: AgentLoaderConfig = {
  sources: ['user', 'project'],
  maxAgents: 50,
  enableCache: true,
};

// ============================================================
// Agent 加载缓存
// ============================================================

const agentCache = new LoadingCache<AgentDefinition[]>({
  ttlMs: 60_000,
  maxEntries: 10,
});

// ============================================================
// Agent Markdown 加载
// ============================================================

/**
 * 从 Markdown 文件加载 Agent 定义
 *
 * @param filePath Markdown 文件路径
 * @returns Agent 定义
 */
export async function loadAgentMarkdown(filePath: string): Promise<AgentDefinition> {
  const result = await parseFrontmatterFile<AgentFrontmatter>(filePath, AgentFrontmatterSchema);

  const source = determineSourceFromPath(result.filePath);

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
    source,
    filePath: result.filePath,
  };
}

/**
 * 根据文件路径确定来源
 */
function determineSourceFromPath(filePath: string): AgentSource {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const userConfigDir = path.join(homeDir, '.thething');

  if (filePath.startsWith(userConfigDir)) {
    return 'user';
  }

  // 默认为项目级
  return 'project';
}

// ============================================================
// Agent 目录扫描
// ============================================================

/**
 * 扫描 Agent 目录
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 * @param config 加载配置
 * @returns Agent 定义列表
 */
export async function scanAgentDirs(
  cwd?: string,
  config?: Partial<AgentLoaderConfig>,
): Promise<AgentDefinition[]> {
  const effectiveCwd = cwd ?? process.cwd();
  const resolvedConfig = { ...DEFAULT_AGENT_LOADER_CONFIG, ...config };

  // 检查缓存
  const cacheKey = `agents:${effectiveCwd}`;
  if (resolvedConfig.enableCache) {
    const cached = agentCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const agents: AgentDefinition[] = [];
  const dirs: string[] = [];

  // 用户全局目录
  if (resolvedConfig.sources?.includes('user')) {
    dirs.push(getUserConfigDir('agents'));
  }

  // 项目级目录
  if (resolvedConfig.sources?.includes('project')) {
    dirs.push(getProjectConfigDir(effectiveCwd, 'agents'));
  }

  // 扫描目录
  const scanResults = await scanConfigDirs(effectiveCwd, {
    dirs,
    filePattern: '*.md',
    recursive: false,
  });

  // 加载每个文件
  for (const result of scanResults) {
    try {
      const agent = await loadAgentMarkdown(result.filePath);
      agents.push(agent);

      if (resolvedConfig.maxAgents && agents.length >= resolvedConfig.maxAgents) {
        break;
      }
    } catch (error) {
      console.warn(`[AgentLoader] Failed to load ${result.filePath}: ${(error as Error).message}`);
    }
  }

  // 按优先级合并（project > user）
  const merged = mergeByPriority(
    agents,
    ['project', 'user'],
    (agent) => agent.agentType,
  );

  // 更新缓存
  if (resolvedConfig.enableCache) {
    agentCache.set(cacheKey, merged);
  }

  return merged;
}

/**
 * 清除 Agent 加载缓存
 */
export function clearAgentCache(): void {
  agentCache.clear();
}

/**
 * 获取所有可用 Agent（包括内置）
 *
 * @param cwd 当前工作目录（默认 process.cwd()）
 * @param includeBuiltin 是否包含内置 Agent
 * @returns Agent 定义列表
 */
export async function getAvailableAgents(
  cwd?: string,
  includeBuiltin: boolean = true,
): Promise<AgentDefinition[]> {
  const customAgents = await scanAgentDirs(cwd);

  if (!includeBuiltin) {
    return customAgents;
  }

  // 内置 Agent 需要在运行时从 registry 获取
  // 这里只返回自定义 Agent，内置 Agent 由 registerBuiltinAgents() 注册
  return customAgents;
}

// ============================================================
// 默认导出
// ============================================================

export const AGENT_LOADER_MODULE_VERSION = '1.0.0';