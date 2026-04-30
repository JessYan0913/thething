import * as fs from 'fs/promises';
import * as path from 'path';
import { computeUserConfigDir, getResolvedConfigDirName } from '../../../foundation/paths';
import type { SystemPromptSection } from '../types';

// ============================================================================
// THING.md Context Loading
// ============================================================================

/**
 * Marker files that indicate project context.
 */
const CONTEXT_MARKERS = ['THING.md', '.thething.md', 'CONTEXT.md'] as const;

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
async function searchContextFilesInDir(dir: string, cwd: string): Promise<LoadedContextFile[]> {
  const results: LoadedContextFile[] = [];

  for (const marker of CONTEXT_MARKERS) {
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
 * 注意：configDirName 从全局单例 getResolvedConfigDirName() 获取
 *
 * @param cwd - Current working directory
 */
export async function loadProjectContext(
  cwd: string = process.cwd(),
): Promise<LoadedProjectContext> {
  const configDirName = getResolvedConfigDirName();
  const cacheKey = `${cwd}:${configDirName}`;

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
      const userContextPath = path.join(userContextDir, 'THING.md');
      const loaded = await loadContextFile(userContextPath, cwd, 'THING.md');
      if (loaded) {
        userLevel.push(loaded);
      }
    }

    // Check for project-level context files
    const dirContexts = await searchContextFilesInDir(currentDir, cwd);
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
): Promise<LoadedProjectContext> {
  clearProjectContextCache();
  return loadProjectContext(cwd);
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
): Promise<SystemPromptSection> {
  const context = await loadProjectContext(cwd);

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
 * Synchronous version that returns the cached context if available.
 * Returns null if no context is cached.
 *
 * @param cwd - Current working directory
 */
export function getCachedProjectContext(cwd?: string): string | null {
  const effectiveCwd = cwd ?? process.cwd();
  const configDirName = getResolvedConfigDirName();
  const cacheKey = `${effectiveCwd}:${configDirName}`;

  const cached = contextCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  return cached.context.combinedContent;
}
