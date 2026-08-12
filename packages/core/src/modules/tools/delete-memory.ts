// ============================================================
// Delete Memory Tool - Agent 删除不再准确的记忆
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { deleteMemory } from '../memory/memory-io'

export interface DeleteMemoryToolConfig {
  memoryBaseDir: string
}

export function createDeleteMemoryTool(config: DeleteMemoryToolConfig) {
  return tool({
    description: '删除一条不再准确或已过时的用户记忆。需要提供记忆的 id（格式如 [abc123]）。',
    inputSchema: z.object({
      id: z.string().min(1).describe('要删除的记忆 id，来自记忆列表中的 [id] 标记'),
    }),
    execute: async (input) => {
      await deleteMemory(config.memoryBaseDir, input.id)
      return { deleted: true, id: input.id }
    },
  })
}
