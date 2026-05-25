// ============================================================
// Memory Context - Memory loading for agent creation
// ============================================================

import type { UIMessage } from 'ai'
import {
  findRelevantMemories,
  buildMemorySection,
  getUserMemoryDir,
  ensureMemoryDirExists,
} from '../../../modules/memory'
import { truncateEntrypointContent } from '../../../modules/memory/memdir'
import type { MemoryContext } from '../types'

export interface MemoryLoadOptions {
  entrypointMaxLines?: number
  entrypointMaxBytes?: number
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
    }
  }

  return {
    userId,
    recalledMemoriesContent,
  }
}
