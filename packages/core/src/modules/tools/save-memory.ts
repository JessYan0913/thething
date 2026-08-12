// ============================================================
// Save Memory Tool - Agent 主动保存用户记忆
// ============================================================

import { tool } from 'ai'
import { z } from 'zod'
import { writeMemory, readAllMemories } from '../memory/memory-io'

export interface SaveMemoryToolConfig {
  memoryBaseDir: string
}

// ============================================================
// Tool
// ============================================================

export function createSaveMemoryTool(config: SaveMemoryToolConfig) {
  return tool({
    description: `记住关于用户的事实。每条记忆要短、独立、具体。

适合记忆：
- 偏好（"喜欢日环比，不看月同比"）
- 身份（"是公司 CFO"）
- 行为纠正（"不要用表格，用文字"）
- 显式记忆（用户说"记住这个"）

不适合记忆（用对应工具）：
- 知识/分析/研究结论 → save_wiki
- 可量化数据 → Ledger
- 任务/项目状态 → Todos

【敏感信息不写入】密码、证件号、银行卡号、API key、私钥等敏感信息一律不写入记忆。即使"记住密码"也要拒绝——记忆应该只保存可供长期复用的通用事实。
【来源引用】提供 source 字段记录来源（用户原话或上下文），便于归因。
【冲突处理】单值属性（dimension 如 display-format）写入前先看同 dimension 旧条目，若已被更新语义取代，先 delete_memory 再写入；多值属性直接追加。`,
    inputSchema: z.object({
      content: z.string().min(1).max(200).describe('记忆内容，一句话，短且具体。禁止包含密码、证件号、银行卡号、API key 等敏感信息'),
      type: z
        .enum(['preference', 'identity', 'correction', 'explicit'])
        .describe('preference=偏好, identity=身份事实, correction=行为纠正, explicit=显式记忆'),
      dimension: z
        .string()
        .optional()
        .describe('语义域（可选）。单值属性填此字段，如 display-format、language、reply-style；多值属性（food、interests 等）可不填'),
      source: z
        .string()
        .optional()
        .describe('来源引用（可选）。用户原话或此记忆来自哪里，一句话'),
      importance: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('重要性（可选，1-10，默认5）。行为纠正和显式记忆重要性更高，临时偏好更低。用于检索排序'),
    }),
    execute: async (input) => {
      // 同 dimension 冲突检测（不自动删除，返回警告由 Agent 判断）
      let conflicts: Array<{ id: string; content: string }> = []
      if (input.dimension) {
        const existing = await readAllMemories(config.memoryBaseDir)
        conflicts = existing
          .filter(e => e.dimension === input.dimension)
          .map(e => ({ id: e.id, content: e.content }))
      }

      const id = await writeMemory(config.memoryBaseDir, {
        content: input.content,
        type: input.type,
        dimension: input.dimension,
        source: input.source,
        importance: input.importance,
      })

      const result: { saved: boolean; id: string; conflicts?: Array<{ id: string; content: string }> } = { saved: true, id }
      if (conflicts.length > 0) {
        result.conflicts = conflicts
      }
      return result
    },
  })
}
