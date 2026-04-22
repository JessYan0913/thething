// ============================================================
// Subagents Loader - 统一加载器代理
// ============================================================
//
// 改造说明：此文件代理到 loaders/agents.ts，保持 API 兼容
// 实际加载逻辑在 loaders/agents.ts 中
//

import {
  loadAgents,
  loadAgentFile,
  clearAgentsCache,
} from '../loaders/agents';
import type { AgentDefinition } from './types';

// ============================================================
// Agent 加载配置（保留用于类型兼容）
// ============================================================

export interface AgentLoaderConfig {
  sources?: ('user' | 'project')[];
  maxAgents?: number;
  enableCache?: boolean;
}

// ============================================================
// 代理函数（保持原有 API）
// ============================================================

/**
 * 从 Markdown 文件加载 Agent 定义
 *
 * @param filePath Markdown 文件路径
 * @returns Agent 定义
 */
export async function loadAgentMarkdown(filePath: string): Promise<AgentDefinition> {
  // 假设是项目级来源（因为路径是直接传入的）
  return loadAgentFile(filePath, 'project');
}

/**
 * 扫描 Agent 目录
 *
 * @param cwd 当前工作目录
 * @param config 加载配置
 * @returns Agent 定义列表
 */
export async function scanAgentDirs(
  cwd?: string,
  _config?: Partial<AgentLoaderConfig>,
): Promise<AgentDefinition[]> {
  return loadAgents({ cwd });
}

/**
 * 清除 Agent 加载缓存
 */
export function clearAgentCache(): void {
  clearAgentsCache();
}

/**
 * 获取所有可用 Agent（包括内置）
 *
 * @param cwd 当前工作目录
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
// Module Version
// ============================================================

export const AGENT_LOADER_MODULE_VERSION = '1.0.0';