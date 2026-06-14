import { scanMemoryFiles } from "./memory-scan";
import type { ScannedMemory } from "./memory-scan";
import { loadUsageData } from "./usage-tracker";
import { computeDormancy } from "./promotion";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // Layer 2: 信任层（供下游使用）
  source: string;
  confidence: number;
  dormancyStatus: string;
}

// ============================================================
// 分词
// ============================================================

function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase();
  const chineseChars = lower.match(/[一-鿿]/g) || [];
  const englishWords = lower.match(/[a-z0-9]+/g) || [];
  return [...chineseChars, ...englishWords].filter((t) => t.length > 0);
}

// ============================================================
// 匹配评分（纯语义匹配，不掺杂类型偏见）
// ============================================================

function computeMatchScore(queryTokens: string[], memory: ScannedMemory): number {
  let score = 0;

  // description 匹配权重最高（是一行摘要，信息密度大）
  if (memory.description) {
    const descLower = memory.description.toLowerCase();
    for (const token of queryTokens) {
      if (descLower.includes(token)) {
        score += 2;
      }
    }
  }

  // name 匹配（检索锚点）
  const nameLower = memory.name.toLowerCase();
  for (const token of queryTokens) {
    if (nameLower.includes(token)) {
      score += 1;
    }
  }

  // subject 匹配（记忆主体）
  if (memory.subject) {
    const subjectLower = memory.subject.toLowerCase();
    for (const token of queryTokens) {
      if (subjectLower.includes(token)) {
        score += 1.5;
      }
    }
  }

  // aliases 匹配（主体别名，解决代词问题）
  for (const alias of memory.aliases) {
    const aliasLower = alias.toLowerCase();
    for (const token of queryTokens) {
      if (aliasLower.includes(token)) {
        score += 1.5;
      }
    }
  }

  // context 匹配（关联场景）
  for (const ctx of memory.context) {
    const ctxLower = ctx.toLowerCase();
    for (const token of queryTokens) {
      if (ctxLower.includes(token)) {
        score += 1;
      }
    }
  }

  // filename 匹配（弱信号）
  const filenameLower = memory.filename.toLowerCase();
  for (const token of queryTokens) {
    if (filenameLower.includes(token)) {
      score += 0.5;
    }
  }

  return score;
}

// ============================================================
// 时效性权重（基于文件修改时间）
// ============================================================

function computeRecencyWeight(mtimeMs: number): number {
  const ageDays = (Date.now() - mtimeMs) / DAY_MS;
  // 50 天半衰期，下限 0.2（不会完全消失）
  return Math.max(0.2, 1.0 - ageDays * 0.02);
}

// ============================================================
// 主检索函数
// ============================================================

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

  // 加载使用数据（用于休眠判断）
  const usageData = await loadUsageData(memoryDir);

  const scored = candidateMemories.map((memory) => {
    // Stage 1: 语义匹配分数（唯一排名依据）
    const matchScore = computeMatchScore(queryTokens, memory);

    // Stage 2: 时效性加权
    // 新鲜的记忆权重更高，但老记忆不会完全消失
    const recencyWeight = computeRecencyWeight(memory.mtimeMs);

    // Stage 3: 休眠状态加权
    // 长期未召回的记忆降低权重
    const usage = usageData[memory.filename];
    const lastRecalledAt = usage?.lastRecalledAt ?? null;
    const dormancy = computeDormancy(memory.confidence, lastRecalledAt, memory.mtimeMs);
    const dormancyWeight = dormancy.weightMultiplier;

    // 最终分数 = 匹配度 × 时效性 × 休眠权重
    // 注意：confidence 不参与排名，仅作为元数据返回给 Agent 参考
    const finalScore = matchScore * recencyWeight * dormancyWeight;

    return { memory, finalScore, matchScore, dormancyStatus: dormancy.status };
  });

  const results = scored
    .filter((s) => s.matchScore > 0) // 至少要有语义匹配
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, maxResults)
    .map((s) => ({
      path: s.memory.filePath,
      filename: s.memory.filename,
      mtimeMs: s.memory.mtimeMs,
      score: s.finalScore,
      source: s.memory.source,
      confidence: s.memory.confidence,
      dormancyStatus: s.dormancyStatus,
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
