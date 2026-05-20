import { scanMemoryFiles } from "./memory-scan";

export interface FindRelevantOptions {
  maxResults?: number;
  recentTools?: string[];
  alreadySurfaced?: Set<string>;
}

export interface RelevantMemory {
  path: string;
  filename: string;
  mtimeMs: number;
  score: number;
}

function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase();

  const chineseChars = lower.match(/[\u4e00-\u9fff]/g) || [];

  const englishWords = lower.match(/[a-z0-9]+/g) || [];

  return [...chineseChars, ...englishWords].filter((t) => t.length > 0);
}

export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  options: FindRelevantOptions = {},
): Promise<RelevantMemory[]> {
  const { maxResults = 5, alreadySurfaced = new Set<string>() } = options;

  const memories = await scanMemoryFiles(memoryDir);

  const candidateMemories = memories.filter(
    (m) => !alreadySurfaced.has(m.filename),
  );

  if (candidateMemories.length === 0) {
    return [];
  }

  const queryTokens = tokenizeQuery(query);

  const scored = candidateMemories.map((memory) => {
    let score = 0;

    if (memory.description) {
      const descLower = memory.description.toLowerCase();
      for (const token of queryTokens) {
        if (descLower.includes(token)) {
          score += 2;
        }
      }
    }

    const nameLower = memory.name.toLowerCase();
    for (const token of queryTokens) {
      if (nameLower.includes(token)) {
        score += 1;
      }
    }

    const filenameLower = memory.filename.toLowerCase();
    for (const token of queryTokens) {
      if (filenameLower.includes(token)) {
        score += 1;
      }
    }

    if (query.includes("偏好") && memory.type === "user") {
      score += 3;
    }
    if (
      (query.includes("不要") || query.includes("避免")) &&
      memory.type === "feedback"
    ) {
      score += 3;
    }
    if (
      (query.includes("流程") || query.includes("规则")) &&
      memory.type === "project"
    ) {
      score += 3;
    }
    if (
      (query.includes("工具") || query.includes("服务")) &&
      memory.type === "reference"
    ) {
      score += 3;
    }

    return { memory, score };
  });

  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => ({
      path: s.memory.filePath,
      filename: s.memory.filename,
      mtimeMs: s.memory.mtimeMs,
      score: s.score,
    }));

  return results;
}

export async function loadMemoryContent(
  relevantMemories: RelevantMemory[],
): Promise<Map<string, string>> {
  const { readMemoryContent } = await import("./memory-scan");
  const contentMap = new Map<string, string>();

  for (const memory of relevantMemories) {
    const content = await readMemoryContent(memory.path);
    if (content !== null) {
      contentMap.set(memory.path, content);
    }
  }

  return contentMap;
}
