import fs from 'fs/promises';
import matter from 'gray-matter';
import type { Skill } from './types';

const bodyCache = new Map<string, string>();

export async function loadSkillBody(sourcePath: string): Promise<string> {
  const cached = bodyCache.get(sourcePath);
  if (cached !== undefined) {
    return cached;
  }

  const content = await fs.readFile(sourcePath, 'utf-8');
  const { content: body } = matter(content);
  const trimmedBody = body.trim();

  bodyCache.set(sourcePath, trimmedBody);
  return trimmedBody;
}

export async function loadFullSkill(metadata: import('./types').SkillMetadata): Promise<Skill> {
  const body = await loadSkillBody(metadata.sourcePath);

  return {
    ...metadata,
    body,
  };
}

export function preloadSkillBodies(metadatas: import('./types').SkillMetadata[]): Promise<void[]> {
  return Promise.all(
    metadatas.map(async (m) => {
      try {
        await loadSkillBody(m.sourcePath);
      } catch {
        // Silently ignore preload failures
      }
    })
  );
}

export function evictSkillBody(sourcePath: string): void {
  bodyCache.delete(sourcePath);
}

export function clearAllBodyCache(): void {
  bodyCache.clear();
}

export function getBodyCacheStats(): { size: number; keys: string[] } {
  return {
    size: bodyCache.size,
    keys: Array.from(bodyCache.keys()),
  };
}
