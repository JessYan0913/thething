// ============================================================
// Memory Context - Memory loading for agent creation
// ============================================================

import type { UIMessage } from 'ai'
import {
  findRelevantMemories,
  buildMemorySection,
  getUserMemoryDir,
  ensureMemoryDirExists,
  checkPromotionEligibility,
  loadUsageData,
  scanMemoryFiles,
} from '../../../modules/memory'
import { truncateEntrypointContent } from '../../../modules/memory/memdir'
import { promises as fs } from 'fs'
import path from 'path'
import type { MemoryContext } from '../types'

export interface MemoryLoadOptions {
  entrypointMaxLines?: number
  entrypointMaxBytes?: number
}

/**
 * 非阻塞晋升检查：检查召回的 inferred 记忆是否满足晋升条件
 * 如果满足，自动将 source 改为 promoted，confidence 改为 0.6
 * 不阻塞主流程，失败静默忽略
 */
async function tryAutoPromote(
  relevantMemories: Array<{ filename: string; source: string }>,
  userMemDir: string,
): Promise<void> {
  try {
    const usageData = await loadUsageData(userMemDir)
    const memories = await scanMemoryFiles(userMemDir)

    for (const recalled of relevantMemories) {
      if (recalled.source !== 'inferred') continue

      const memory = memories.find((m) => m.filename === recalled.filename)
      if (!memory) continue

      const usage = usageData[memory.filename] || { recallCount: 0, lastRecalledAt: null }
      const check = checkPromotionEligibility(memory, usage)

      if (check.eligible) {
        // 自动晋升：更新文件 frontmatter
        const filePath = path.join(userMemDir, memory.filename)
        const content = await fs.readFile(filePath, 'utf-8')
        const updated = content
          .replace(/^source:\s*.*$/m, 'source: promoted')
          .replace(/^confidence:\s*.*$/m, 'confidence: 0.6')
        await fs.writeFile(filePath, updated, 'utf-8')
      }
    }
  } catch {
    // 晋升失败不阻塞主流程
  }
}

export async function loadMemoryContext(
  messages: UIMessage[],
  userId: string,
  memoryBaseDir: string,
  options?: MemoryLoadOptions,
): Promise<MemoryContext> {
  const userMemDir = getUserMemoryDir(userId, memoryBaseDir)
  await ensureMemoryDirExists(userMemDir)

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessageText = lastUserMessage?.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ') || ''

  let recalledMemoriesContent = ''
  if (lastUserMessageText) {
    const relevantMemories = await findRelevantMemories(lastUserMessageText, userMemDir, {
      maxResults: 5,
    })

    if (relevantMemories.length > 0) {
      let content = await buildMemorySection(relevantMemories, userMemDir)
      if (options?.entrypointMaxBytes || options?.entrypointMaxLines) {
        content = truncateEntrypointContent(content, options?.entrypointMaxLines, options?.entrypointMaxBytes)
      }
      recalledMemoriesContent = content

      // 非阻塞：检查晋升资格并自动晋升
      tryAutoPromote(relevantMemories, userMemDir)
    }
  }

  return {
    userId,
    recalledMemoriesContent,
  }
}
