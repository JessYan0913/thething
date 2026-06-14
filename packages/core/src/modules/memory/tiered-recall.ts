// ============================================================
// Tiered Recall - 分层召回
// ============================================================
// 按层级分配 token 预算，动态组装上下文

import { scanMemoryFiles, type ScannedMemory } from './memory-scan'
import { loadUsageData } from './usage-tracker'
import { computeDormancy } from './promotion'
import { readMemoryContent } from './memory-scan'
import type { MemoryTier } from './tiered-storage'

const DAY_MS = 24 * 60 * 60 * 1000

// ============================================================
// 类型定义
// ============================================================

export interface TieredRecallOptions {
  maxTokens?: number
  maxResults?: number
  /** 各层级的 token 预算比例，默认 identity:pattern:state = 30:30:40 */
  tierBudget?: Record<MemoryTier, number>
}

export interface TieredMemorySection {
  tier: MemoryTier
  label: string
  memories: TieredMemory[]
  tokenEstimate: number
}

export interface TieredMemory {
  filename: string
  name: string
  description: string
  type: string
  content: string
  score: number
  source: string
  confidence: number
}

export interface AssembledContext {
  sections: TieredMemorySection[]
  totalTokens: number
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_TIER_BUDGET: Record<MemoryTier, number> = {
  identity: 0.3,
  pattern: 0.3,
  state: 0.4,
}

const TIER_LABELS: Record<MemoryTier, string> = {
  identity: '身份信息（极少变化）',
  pattern: '行为规律（跨场景）',
  state: '当前状态（经常变化）',
}

// 粗略的 token 估算：中文约 1.5 字/token，英文约 4 字符/token
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

// ============================================================
// 分词与评分（复用 find-relevant.ts 的逻辑）
// ============================================================

function tokenizeQuery(query: string): string[] {
  const lower = query.toLowerCase()
  const chineseChars = lower.match(/[一-鿿]/g) || []
  const englishWords = lower.match(/[a-z0-9]+/g) || []
  return [...chineseChars, ...englishWords].filter((t) => t.length > 0)
}

function computeMatchScore(queryTokens: string[], memory: ScannedMemory): number {
  let score = 0

  if (memory.description) {
    const descLower = memory.description.toLowerCase()
    for (const token of queryTokens) {
      if (descLower.includes(token)) score += 2
    }
  }

  const nameLower = memory.name.toLowerCase()
  for (const token of queryTokens) {
    if (nameLower.includes(token)) score += 1
  }

  if (memory.subject) {
    const subjectLower = memory.subject.toLowerCase()
    for (const token of queryTokens) {
      if (subjectLower.includes(token)) score += 1.5
    }
  }

  for (const alias of memory.aliases) {
    const aliasLower = alias.toLowerCase()
    for (const token of queryTokens) {
      if (aliasLower.includes(token)) score += 1.5
    }
  }

  for (const ctx of memory.context) {
    const ctxLower = ctx.toLowerCase()
    for (const token of queryTokens) {
      if (ctxLower.includes(token)) score += 1
    }
  }

  const filenameLower = memory.filename.toLowerCase()
  for (const token of queryTokens) {
    if (filenameLower.includes(token)) score += 0.5
  }

  return score
}

function computeRecencyWeight(mtimeMs: number): number {
  const ageDays = (Date.now() - mtimeMs) / DAY_MS
  return Math.max(0.2, 1.0 - ageDays * 0.02)
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 分层组装记忆上下文
 *
 * 策略：
 * - identity 层：始终包含（用户身份信息）
 * - pattern 层：相关性 > 阈值时包含
 * - state 层：按相关性 + 新鲜度加权
 */
export async function assembleMemoryContext(
  query: string,
  memoryDir: string,
  options: TieredRecallOptions = {},
): Promise<AssembledContext> {
  const {
    maxTokens = 2000,
    maxResults = 10,
    tierBudget = DEFAULT_TIER_BUDGET,
  } = options

  const memories = await scanMemoryFiles(memoryDir)
  if (memories.length === 0) {
    return { sections: [], totalTokens: 0 }
  }

  const queryTokens = tokenizeQuery(query)
  const usageData = await loadUsageData(memoryDir)

  // 按层级分组
  const tierGroups: Record<MemoryTier, ScannedMemory[]> = {
    identity: [],
    pattern: [],
    state: [],
  }

  for (const memory of memories) {
    const tier = memory.tier || 'state'
    tierGroups[tier].push(memory)
  }

  // 计算每个层级的 token 预算
  const tierTokenBudgets: Record<MemoryTier, number> = {
    identity: Math.floor(maxTokens * tierBudget.identity),
    pattern: Math.floor(maxTokens * tierBudget.pattern),
    state: Math.floor(maxTokens * tierBudget.state),
  }

  const sections: TieredMemorySection[] = []
  let totalTokens = 0

  // 按层级处理
  for (const tier of ['identity', 'pattern', 'state'] as MemoryTier[]) {
    const tierMemories = tierGroups[tier]
    const budget = tierTokenBudgets[tier]

    // 评分和排序
    const scored = tierMemories.map((memory) => {
      const matchScore = computeMatchScore(queryTokens, memory)
      const recencyWeight = computeRecencyWeight(memory.mtimeMs)
      const usage = usageData[memory.filename]
      const lastRecalledAt = usage?.lastRecalledAt ?? null
      const dormancy = computeDormancy(memory.confidence, lastRecalledAt, memory.mtimeMs)
      const finalScore = matchScore * recencyWeight * dormancy.weightMultiplier
      return { memory, finalScore, matchScore }
    })

    // identity 层：始终包含所有记忆（通常是少量核心信息）
    // pattern/state 层：只包含有匹配的记忆
    const filtered = tier === 'identity'
      ? scored
      : scored.filter((s) => s.matchScore > 0)

    filtered.sort((a, b) => b.finalScore - a.finalScore)

    // 按 token 预算选取
    const selected: TieredMemory[] = []
    let usedTokens = 0

    for (const { memory } of filtered) {
      const content = memory.content
      const tokens = estimateTokens(content)

      if (usedTokens + tokens > budget && selected.length > 0) {
        break
      }

      selected.push({
        filename: memory.filename,
        name: memory.name,
        description: memory.description,
        type: memory.type,
        content,
        score: 0, // will be set below
        source: memory.source,
        confidence: memory.confidence,
      })

      usedTokens += tokens
    }

    if (selected.length > 0) {
      sections.push({
        tier,
        label: TIER_LABELS[tier],
        memories: selected,
        tokenEstimate: usedTokens,
      })
      totalTokens += usedTokens
    }
  }

  return { sections, totalTokens }
}

/**
 * 格式化为系统提示词
 */
export function formatAssembledContext(context: AssembledContext): string {
  if (context.sections.length === 0) {
    return ''
  }

  const lines: string[] = []

  for (const section of context.sections) {
    lines.push(`### ${section.label}`)
    lines.push('')

    for (const memory of section.memories) {
      lines.push(`- **${memory.name}**: ${memory.content}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
