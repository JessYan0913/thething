// ============================================================
// Agents Loader - 基于 MultiSourceConfigLoader
// ============================================================

import * as fs from 'fs/promises';
import * as path from 'path';
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
    instructions: body,
    model: mergedData.model as 'inherit' | 'fast' | 'smart' | string | undefined,
    tools: parseToolsList(mergedData.tools as string[] | undefined),
    connectors: mergedData.connectors as boolean | undefined,
    skills: mergedData.skills as boolean | undefined,
    mcp: mergedData.mcp as boolean | undefined,
    permission: mergedData.permission as 'smart' | 'auto-review' | 'full-trust' | undefined,
    metadata: mergedData.metadata as Record<string, unknown> | undefined,
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

let _subDirCache: Map<string, boolean> | undefined;

/**
 * 检测目录是否使用子目录结构（<name>/agent.md 而非 <name>.md）
 * 通过检查是否存在包含 agent.md 的子目录来判断。
 * 结果缓存在模块级 Map 中，避免每次 reload 重复 I/O。
 */
async function isSubdirectoryAgentDir(dir: string): Promise<boolean> {
  // 检查缓存
  if (_subDirCache?.has(dir)) {
    return _subDirCache.get(dir)!;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const agentMd = path.join(dir, entry.name, 'agent.md');
        try {
          await fs.access(agentMd);
          // 初始化缓存并写入
          _subDirCache ??= new Map();
          _subDirCache.set(dir, true);
          return true;
        } catch {
          // agent.md 不存在，继续检查其他子目录
        }
      }
    }
  } catch {
    // 目录不存在或无法读取
  }
  // 初始化缓存并写入 false
  _subDirCache ??= new Map();
  _subDirCache.set(dir, false);
  return false;
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

  // 按目录结构分离：子目录格式（<name>/agent.md）vs 平面格式（<name>.md）
  // 使用 Promise.all 并行探测目录结构，减少 I/O 等待时间
  const dirResults = await Promise.all(
    dirs.map(async (dir) => ({
      dir,
      isSubDir: await isSubdirectoryAgentDir(dir),
    }))
  );

  const subDirs = dirResults.filter(r => r.isSubDir).map(r => r.dir);
  const flatDirs = dirResults.filter(r => !r.isSubDir).map(r => r.dir);

  const results: AgentDefinition[] = [];

  if (flatDirs.length > 0) {
    const flatItems = await agentsLoader.load({
      cwd: options?.cwd,
      configDir: options?.configDir,
      homeDir: options?.homeDir,
      dirs: flatDirs,
    });
    results.push(...flatItems);
  }

  if (subDirs.length > 0) {
    const configDirItems = await agentsDotAgentsLoader.load({
      cwd: options?.cwd,
      configDir: options?.configDir,
      homeDir: options?.homeDir,
      dirs: subDirs,
    });
    results.push(...configDirItems);
  }

  // 按 agentType 去重
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
    // Dot Agents 协议兼容格式
    frontmatter = {
      id: def.agentType,
      name: def.displayName ?? def.agentType,
      model: def.model ?? 'inherit',
      tools: def.tools ?? [],
      connectors: def.connectors ?? true,
      skills: def.skills ?? true,
      mcp: def.mcp ?? true,
      permission: def.permission,
      source: def.source ?? 'user',
    };
  } else {
    // TheThing 原生格式
    frontmatter = {
      agentType: def.agentType,
      displayName: def.displayName,
      model: def.model ?? 'inherit',
      tools: def.tools ?? [],
      connectors: def.connectors ?? true,
      skills: def.skills ?? true,
      mcp: def.mcp ?? true,
      permission: def.permission,
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
