import * as fs from 'fs/promises';
import * as path from 'path';
import { computeUserConfigDir, getResolvedConfigDirName } from '../../../foundation/paths';
import type { SystemPromptSection } from '../types';

// ============================================================================
// THING.md Context Loading
// ============================================================================

/**
 * Base marker files that indicate project context (always checked).
 */
const BASE_CONTEXT_MARKERS = ['THING.md', 'CONTEXT.md'] as const;

export interface ProjectContextLoadOptions {
  /** 项目上下文文件名列表（来自 ResolvedLayout.contextFileNames） */
  contextFileNames?: readonly string[];
  /** 配置目录名（来自 ResolvedLayout.configDirName） */
  configDirName?: string;
}

/**
 * Get all context marker files.
 *
 * @returns Array of marker file names to check
 */
function getContextMarkers(options?: ProjectContextLoadOptions): string[] {
  if (options?.contextFileNames) {
    return [...options.contextFileNames];
  }
  const configDirName = options?.configDirName ?? getResolvedConfigDirName();
  // 动态生成配置目录名对应的标记文件（如 .thething.md 或 .siact.md）
  const configMarker = `${configDirName}.md`;
  return [...BASE_CONTEXT_MARKERS, configMarker];
}

/**
 * Represents a loaded context file.
 */
export interface LoadedContextFile {
  /** Absolute path to the file */
  path: string;

  /** Relative path from the working directory */
  relativePath: string;

  /** The content of the file */
  content: string;

  /** The marker that matched */
  marker: string;
}

/**
 * Represents the hierarchy of loaded context files.
 */
export interface LoadedProjectContext {
  /** Context files loaded from user home directory */
  userLevel: LoadedContextFile[];

  /** Context files loaded from project directories */
  projectLevel: LoadedContextFile[];

  /** All contexts combined into a single string */
  combinedContent: string | null;
}

// Global cache for project context (keyed by cwd:configDirName)
const contextCache = new Map<string, { context: LoadedProjectContext; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a file exists and is readable.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and parse a context file.
 */
async function loadContextFile(
  filePath: string,
  cwd: string,
  marker: string
): Promise<LoadedContextFile | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      path: filePath,
      relativePath: path.relative(cwd, filePath),
      content: content.trim(),
      marker,
    };
  } catch {
    return null;
  }
}

/**
 * Search for context files in a directory.
 */
async function searchContextFilesInDir(
  dir: string,
  cwd: string,
  options?: ProjectContextLoadOptions,
): Promise<LoadedContextFile[]> {
  const results: LoadedContextFile[] = [];
  const markers = getContextMarkers(options);

  for (const marker of markers) {
    const filePath = path.join(dir, marker);
    const loaded = await loadContextFile(filePath, cwd, marker);
    if (loaded) {
      results.push(loaded);
    }
  }

  return results;
}

/**
 * Load project context by traversing up from the current working directory.
 * Stops at the home directory or filesystem root.
 *
 * Multi-level context merging strategy:
 * - User level: ~/${configDirName}/THING.md (personal preferences)
 * - Project level: /project/THING.md (team shared)
 * - Module level: /project/src/THING.md (module specific)
 *
 * 注意：configDirName 和 contextFileNames 从 ProjectContextLoadOptions 获取，
 * 默认回退到全局单例 getResolvedConfigDirName()
 *
 * @param cwd - Current working directory
 */
export async function loadProjectContext(
  cwd: string = process.cwd(),
  options?: ProjectContextLoadOptions,
): Promise<LoadedProjectContext> {
  const configDirName = options?.configDirName ?? getResolvedConfigDirName();
  const markers = getContextMarkers({ ...options, configDirName });
  const cacheKey = buildCacheKey(cwd, { ...options, configDirName });

  // Check cache first
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.context;
  }

  const userHome = process.env.HOME || process.env.USERPROFILE || '/';
  const userContextDir = computeUserConfigDir(userHome, undefined, configDirName);

  const userLevel: LoadedContextFile[] = [];
  const projectLevel: LoadedContextFile[] = [];

  // Traverse directory tree upward
  let currentDir = cwd;
  let reachedRoot = false;

  while (!reachedRoot && currentDir !== '/') {
    // Check for user-level context (in ~/${configDirName} directory)
    if (currentDir === userHome || currentDir === userContextDir) {
      for (const marker of markers) {
        const userContextPath = path.join(userContextDir, marker);
        const loaded = await loadContextFile(userContextPath, cwd, marker);
        if (loaded) {
          userLevel.push(loaded);
        }
      }
    }

    // Check for project-level context files
    const dirContexts = await searchContextFilesInDir(currentDir, cwd, { ...options, configDirName });
    for (const ctx of dirContexts) {
      // Skip if this is the user-level context we already loaded
      if (ctx.path.startsWith(userContextDir) && userLevel.some((u) => u.path === ctx.path)) {
        continue;
      }
      projectLevel.push(ctx);
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      reachedRoot = true;
    } else {
      currentDir = parentDir;
    }
  }

  // Combine all contexts
  const allContexts = [...userLevel, ...projectLevel];
  const combinedContent =
    allContexts.length > 0
      ? allContexts.map((ctx) => `=== ${ctx.relativePath} ===\n\n${ctx.content}`).join('\n\n---\n\n')
      : null;

  const result = { userLevel, projectLevel, combinedContent };
  contextCache.set(cacheKey, { context: result, timestamp: Date.now() });

  return result;
}

/**
 * Clear the project context cache.
 */
export function clearProjectContextCache(): void {
  contextCache.clear();
}

/**
 * Force reload the project context.
 *
 * @param cwd - Current working directory
 */
export async function reloadProjectContext(
  cwd: string = process.cwd(),
  options?: ProjectContextLoadOptions,
): Promise<LoadedProjectContext> {
  clearProjectContextCache();
  return loadProjectContext(cwd, options);
}

// ============================================================================
// System Prompt Section Factory
// ============================================================================

/**
 * Creates the project context section for the system prompt.
 * Returns null if no project context files are found.
 *
 * @param cwd - Current working directory
 */
export async function createProjectContextSection(
  cwd?: string,
  options?: ProjectContextLoadOptions,
): Promise<SystemPromptSection> {
  const context = await loadProjectContext(cwd, options);

  return {
    name: 'project-context',
    content: context.combinedContent
      ? `【项目上下文】\n\n${context.combinedContent}`
      : null,
    cacheStrategy: 'session', // Changes when project files change
    priority: 10, // Lower priority, comes after more static sections
  };
}

/**
 * Build cache key from cwd and load options.
 * Must match the format used in loadProjectContext().
 */
function buildCacheKey(cwd: string, options?: ProjectContextLoadOptions): string {
  const configDirName = options?.configDirName ?? getResolvedConfigDirName();
  const markers = getContextMarkers(options);
  return `${cwd}:${configDirName}:${markers.join('|')}`;
}

/**
 * Synchronous version that returns the cached context if available.
 * Returns null if no context is cached.
 */
export function getCachedProjectContext(cwd?: string, options?: ProjectContextLoadOptions): string | null {
  const effectiveCwd = cwd ?? process.cwd();
  const cacheKey = buildCacheKey(effectiveCwd, options);

  const cached = contextCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  return cached.context.combinedContent;
}
