// ============================================================
// Wiki Ingest - 知识编译流程
// ============================================================
// 对话结束后，从对话中编译知识并写入 wiki。
// LLM 做编译判断，代码只做 IO。

import { generateText } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { UIMessage } from 'ai'
import fs from 'fs/promises'
import path from 'path'
import { getUserWikiDir, ensureWikiDirExists } from './wiki-paths'
import { writePage, updatePage, mergePages, replacePage, invalidatePage, rebuildIndex, appendLog, type WikiPageData } from './wiki-io'
import { WIKI_MAINTAINER_PROMPT, wikiIngestSchema, type WikiAction } from './wiki-prompt'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'
import { logger } from '../../primitives/logger'

// ============================================================
// 类型定义
// ============================================================

export interface WikiIngestResult {
  actions: number
  created: string[]
  updated: string[]
  merged: string[]
  replaced: string[]
  invalidated: string[]
}

// ============================================================
// 辅助函数
// ============================================================

function requireModel(model?: LanguageModelV3): LanguageModelV3 {
  if (!model) {
    throw new Error('[WikiIngest] Model parameter is required.')
  }
  return model
}

/**
 * 格式化对话为 prompt 文本
 */
function formatConversationForPrompt(messages: UIMessage[]): string {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const textParts = m.parts
        .filter(p => p.type === 'text' || p.type === 'reasoning')
        .map(p => p.type === 'text' || p.type === 'reasoning' ? p.text : '')
        .filter(Boolean)
        .join('\n')

      const roleLabel = m.role === 'assistant' ? 'AI' : '用户'
      return `${roleLabel}: ${textParts}`
    })
    .join('\n\n')
}

/**
 * 格式化索引为 prompt 上下文（只注入索引，不注入页面内容）
 */
function formatWikiContext(
  indexContent: string,
): string {
  const parts: string[] = []

  parts.push('## 现有知识库索引')
  parts.push(indexContent || '（知识库为空）')
  parts.push('')

  return parts.join('\n')
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 从对话中编译知识并写入 wiki
 * 这是 Ingest 操作的核心函数
 */
export async function ingestWikiFromConversation(
  messages: UIMessage[],
  userId: string,
  model?: LanguageModelV3,
  wikiBaseDir?: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<WikiIngestResult> {
  const emptyResult: WikiIngestResult = {
    actions: 0,
    created: [],
    updated: [],
    merged: [],
    replaced: [],
    invalidated: [],
  }

  if (messages.length < 2) return emptyResult
  if (!wikiBaseDir) return emptyResult

  try {
    const wikiDir = getUserWikiDir(userId, wikiBaseDir)
    await ensureWikiDirExists(wikiDir)

    // 1. 格式化最近对话
    const recentMessages = messages.slice(-20)
    const conversationText = formatConversationForPrompt(recentMessages)
    logger.debug('WikiIngest', `Processing ${recentMessages.length} messages for user ${userId}`)

    // 2. 读取原始 index.md
    let indexRaw = ''
    try {
      indexRaw = await fs.readFile(path.join(wikiDir, config.indexFile), 'utf-8')
    } catch {
      // 索引文件不存在
    }

    // 3. 调用 LLM（只传入索引，让 LLM 独立判断主题）
    const fullPrompt = formatWikiContext(indexRaw) + '\n\n## 当前对话\n\n' + conversationText

    const result = await generateText({
      model: requireModel(model),
      system: WIKI_MAINTAINER_PROMPT,
      prompt: fullPrompt,
    })

    // 从文本中提取 JSON 并校验
    let extraction: { actions: WikiAction[] } | null = null
    try {
      const text = result.text
      // 提取 JSON 块（兼容 ```json ... ``` 和裸 JSON）
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0])
        const validated = wikiIngestSchema.safeParse(parsed)
        if (validated.success) {
          extraction = validated.data
        }
      }
    } catch {
      // JSON 解析失败，静默处理
    }

    if (!extraction || extraction.actions.length === 0) {
      logger.debug('WikiIngest', 'No actions to process')
      return emptyResult
    }

    logger.debug('WikiIngest', `LLM returned ${extraction.actions.length} actions`)

    // 6. 执行操作
    const now = new Date().toISOString()
    const logDetails: string[] = []

    for (const action of extraction.actions.slice(0, config.maxActionsPerIngest)) {
      try {
        await executeWikiAction(wikiDir, action, now)

        // 记录操作结果
        switch (action.action) {
          case 'create':
            emptyResult.created.push(action.name)
            logDetails.push(`create: [[${action.name}]] — ${action.description}`)
            break
          case 'update':
            emptyResult.updated.push(action.target || action.name)
            logDetails.push(`update: [[${action.target || action.name}]] — ${action.description}`)
            break
          case 'merge':
            emptyResult.merged.push(action.name)
            logDetails.push(`merge: ${(action.mergeTargets || []).join(', ')} → [[${action.name}]]`)
            break
          case 'replace':
            emptyResult.replaced.push(action.target || action.name)
            logDetails.push(`replace: [[${action.target || action.name}]] — ${action.description}`)
            break
          case 'invalidate':
            emptyResult.invalidated.push(action.target || action.name)
            logDetails.push(`invalidate: [[${action.target || action.name}]]`)
            break
        }
      } catch (err) {
        logger.error('WikiIngest', `Failed to execute action (${action.action}): ${err}`)
      }
    }

    // 7. 重建索引
    await rebuildIndex(wikiDir, config)

    // 8. 写入日志
    if (logDetails.length > 0) {
      await appendLog(wikiDir, {
        timestamp: now,
        operation: 'ingest',
        description: `对话编译 (${logDetails.length} 条操作)`,
        details: logDetails,
      }, config)
    }

    emptyResult.actions = logDetails.length

    if (emptyResult.actions > 0) {
      logger.debug('WikiIngest', `Compiled ${emptyResult.actions} knowledge items for user ${userId}`)
    }

    return emptyResult
  } catch (err) {
    logger.error('WikiIngest', `Error: ${err}`)
    return emptyResult
  }
}

/**
 * 执行单个 wiki action
 */
export async function executeWikiAction(
  wikiDir: string,
  action: WikiAction,
  now?: string,
): Promise<void> {
  const timestamp = now || new Date().toISOString()

  const baseData: WikiPageData = {
    name: action.name,
    description: action.description,
    category: action.category,
    created: timestamp,
    updated: timestamp,
  }

  switch (action.action) {
    case 'create':
      await writePage(wikiDir, baseData, action.content)
      break

    case 'update':
      if (action.target) {
        // 默认替换模式：新内容完全替代旧内容
        // 如果 LLM 指定 append 模式，则追加到旧内容
        const mode = action.mode === 'append' ? 'append' : 'replace'
        await updatePage(wikiDir, action.target, action.content, mode)
      }
      break

    case 'merge':
      if (action.target && action.mergeTargets) {
        await mergePages(wikiDir, action.target, action.mergeTargets)
      }
      break

    case 'replace':
      if (action.target) {
        await replacePage(wikiDir, action.target, baseData, action.content)
      }
      break

    case 'invalidate':
      if (action.target) {
        await invalidatePage(wikiDir, action.target, '已过期')
      }
      break
  }
}

/**
 * 后台 ingest（非阻塞）
 */
export async function ingestWikiInBackground(
  messages: UIMessage[],
  userId: string,
  model?: LanguageModelV3,
  wikiBaseDir?: string,
  config?: WikiConfig,
): Promise<void> {
  setImmediate(async () => {
    try {
      // 延迟 3 秒，避免与主聊天请求同时触发限速
      await new Promise(resolve => setTimeout(resolve, 3000))

      const result = await ingestWikiFromConversation(
        messages,
        userId,
        model,
        wikiBaseDir,
        config,
      )
      if (result.actions > 0) {
        logger.debug('WikiIngest', `Background: compiled ${result.actions} items for user ${userId}`)
      }
    } catch (err) {
      logger.error('WikiIngest', `Background ingest failed: ${err}`)
    }
  })
}
