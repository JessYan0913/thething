import type { SystemPromptSection } from '../types';
import { getUserMemoryDir, directoryExists } from '../../memory/paths';
import { buildMemoryPrompt } from '../../memory/memdir';

export async function createMemorySection(
  userId?: string,
  teamId?: string,
  memoryBaseDir?: string,
): Promise<SystemPromptSection | null> {
  if (!userId || !memoryBaseDir) {
    return null;
  }

  const userDir = getUserMemoryDir(userId, memoryBaseDir);

  if (!(await directoryExists(userDir))) {
    return null;
  }

  const content = await buildMemoryPrompt(userDir);

  if (!content) {
    return null;
  }

  return {
    name: 'memory-guidelines',
    content,
    cacheStrategy: 'session',
    priority: 45,
  };
}

export async function createRecalledMemorySection(
  memoriesContent: string,
): Promise<SystemPromptSection | null> {
  if (!memoriesContent) {
    return null;
  }

  return {
    name: 'recalled-memories',
    content: `## 召回的相关记忆\n\n${memoriesContent}`,
    cacheStrategy: 'dynamic',
    priority: 46,
  };
}
