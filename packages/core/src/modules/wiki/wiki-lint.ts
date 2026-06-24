// ============================================================
// Wiki Lint - 知识库健康检查
// ============================================================
// 确定性检查（零 LLM 开销）+ 语义检查（需要 LLM）

import fs from 'fs/promises'
import path from 'path'
import { generateText, Output } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { getUserWikiDir, ensureWikiDirExists, pageNameToFilename } from './wiki-paths'
import { readAllPages, readPage, rebuildIndex, appendLog, replacePage, type WikiPage } from './wiki-io'
import { LINT_PROMPT, lintOutputSchema, type LintIssue } from './wiki-prompt'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'
import { logger } from '../../primitives/logger'

// ============================================================
// 类型定义
// ============================================================

export interface LintReport {
  checked: number
  issues: LintIssue[]
  fixed: number
  timestamp: string
}

// ============================================================
// 确定性检查（零 LLM 开销）
// ============================================================

/**
 * 索引同步检查：检查 index.md 是否与实际文件一致
 */
async function checkIndexSync(
  wikiDir: string,
  config: WikiConfig,
): Promise<{ missing: string[]; extra: string[] }> {
  // 获取实际文件列表
  let actualFiles: string[] = []
  try {
    const files = await fs.readdir(wikiDir)
    actualFiles = files.filter(f =>
      f.endsWith('.md') && f !== config.indexFile && f !== config.logFile
    )
  } catch {
    return { missing: [], extra: [] }
  }

  // 获取索引中的文件列表
  let indexContent = ''
  try {
    indexContent = await fs.readFile(path.join(wikiDir, config.indexFile), 'utf-8')
  } catch {
    return { missing: actualFiles, extra: [] }
  }

  const indexFiles = new Set<string>()
  const lines = indexContent.split('\n')
  for (const line of lines) {
    const match = line.match(/^- \[\[(.+?)\]\]/)
    if (match) {
      const filename = pageNameToFilename(match[1])
      indexFiles.add(filename)
    }
  }

  const actualSet = new Set(actualFiles)
  const missing = actualFiles.filter(f => !indexFiles.has(f))
  const extra = Array.from(indexFiles).filter(f => !actualSet.has(f))

  return { missing, extra }
}

/**
 * 过期检测：检查 updated 超过阈值的页面
 */
async function checkStale(
  wikiDir: string,
  config: WikiConfig,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const pages = await readAllPages(wikiDir, config)
  const now = Date.now()
  const thresholdMs = config.staleThresholdDays * 24 * 60 * 60 * 1000

  for (const page of pages) {
    const updatedTime = new Date(page.data.updated).getTime()
    if (now - updatedTime > thresholdMs) {
      issues.push({
        type: 'stale',
        severity: 'low',
        pages: [page.filename],
        description: `页面 "${page.data.name}" 已超过 ${config.staleThresholdDays} 天未更新`,
        suggestion: '检查信息是否仍然有效，如已过时则 invalidate',
      })
    }
  }

  return issues
}

/**
 * 孤儿检测：检查从未被其他页面引用的页面
 */
async function checkOrphans(
  wikiDir: string,
  config: WikiConfig,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const pages = await readAllPages(wikiDir, config)

  // 收集所有页面中的 [[wiki-link]]
  const allLinks = new Set<string>()
  for (const page of pages) {
    const links = page.content.match(/\[\[(.+?)\]\]/g) || []
    for (const link of links) {
      const name = link.replace(/\[\[|\]\]/g, '')
      allLinks.add(pageNameToFilename(name))
    }
  }

  // 检查哪些页面从未被引用
  for (const page of pages) {
    if (!allLinks.has(page.filename)) {
      issues.push({
        type: 'orphan',
        severity: 'low',
        pages: [page.filename],
        description: `页面 "${page.data.name}" 从未被其他页面引用`,
        suggestion: '考虑在相关页面中添加 [[wiki-link]] 或合并到其他页面',
      })
    }
  }

  return issues
}

/**
 * 一致性检测：检查 name/description/content 是否一致
 */
async function checkConsistency(
  wikiDir: string,
  config: WikiConfig,
): Promise<{ issues: LintIssue[]; fixed: number }> {
  const issues: LintIssue[] = []
  let fixed = 0
  const pages = await readAllPages(wikiDir, config)

  for (const page of pages) {
    // 检查 description 是否与 content 第一句一致
    const firstSentence = page.content.split(/[。！？\n]/)[0]?.trim()
    if (firstSentence && firstSentence.length > 5) {
      const descLower = page.data.description.toLowerCase()
      const firstLower = firstSentence.toLowerCase()

      // 如果 description 与 content 第一句差异较大，更新 description
      if (!descLower.includes(firstLower.slice(0, 10)) && !firstLower.includes(descLower.slice(0, 10))) {
        issues.push({
          type: 'inconsistent',
          severity: 'low',
          pages: [page.filename],
          description: `页面 "${page.data.name}" 的 description 与 content 第一句不一致`,
          suggestion: '自动修复：更新 description',
        })

        // 自动修复
        const newDesc = firstSentence.length > 80 ? firstSentence.slice(0, 80) + '...' : firstSentence
        const filePath = path.join(wikiDir, page.filename)
        const raw = await fs.readFile(filePath, 'utf-8')
        const updated = raw.replace(
          `description: ${page.data.description}`,
          `description: ${newDesc}`,
        )
        await fs.writeFile(filePath, updated, 'utf-8')
        fixed++
      }
    }
  }

  return { issues, fixed }
}

// ============================================================
// 语义检查（需要 LLM）
// ============================================================

/**
 * 矛盾检测 + 交叉引用缺失 + 缺失检测
 */
async function checkSemantic(
  wikiDir: string,
  model: LanguageModelV3,
  config: WikiConfig,
  scope?: string[],
): Promise<LintIssue[]> {
  const pages = await readAllPages(wikiDir, config)
  if (pages.length < 2) return []

  // 限定范围：如果指定了 scope，只检查这些页面
  const pagesToCheck = scope
    ? pages.filter(p => scope.includes(p.filename))
    : pages

  if (pagesToCheck.length < 2) return []

  // 格式化页面内容供 LLM 检查
  const pagesText = pagesToCheck
    .map(p => `### ${p.filename}\n${p.content}`)
    .join('\n\n')

  try {
    const result = await generateText({
      model,
      system: LINT_PROMPT,
      prompt: `## 知识库页面\n\n${pagesText}`,
      providerOptions: {
        openai: {
          response_format: { type: 'json_object' },
        },
      },
      output: Output.object({
        schema: lintOutputSchema,
      }),
    })

    return result.output?.issues || []
  } catch (err) {
    logger.error('WikiLint', `Semantic check failed: ${err}`)
    return []
  }
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 执行确定性检查（零 LLM 开销）
 */
export async function lintDeterministic(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<LintIssue[]> {
  const issues: LintIssue[] = []

  // 索引同步
  const { missing } = await checkIndexSync(wikiDir, config)
  for (const file of missing) {
    issues.push({
      type: 'orphan',
      severity: 'low',
      pages: [file],
      description: `文件 "${file}" 存在但不在索引中`,
      suggestion: '自动修复：补到索引',
    })
  }

  // 过期检测
  issues.push(...await checkStale(wikiDir, config))

  // 孤儿检测
  issues.push(...await checkOrphans(wikiDir, config))

  // 一致性检测（含自动修复）
  const { issues: consistencyIssues } = await checkConsistency(wikiDir, config)
  issues.push(...consistencyIssues)

  return issues
}

/**
 * 执行完整 Lint
 */
export async function lintWiki(
  wikiDir: string,
  model?: LanguageModelV3,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<LintReport> {
  await ensureWikiDirExists(wikiDir)

  const now = new Date().toISOString()
  const allIssues: LintIssue[] = []
  let fixed = 0

  // 1. 确定性检查
  const deterministicIssues = await lintDeterministic(wikiDir, config)
  allIssues.push(...deterministicIssues)

  // 2. 索引同步修复
  const { missing } = await checkIndexSync(wikiDir, config)
  if (missing.length > 0) {
    await rebuildIndex(wikiDir, config)
    fixed += missing.length
  }

  // 3. 一致性修复
  const { fixed: consistencyFixed } = await checkConsistency(wikiDir, config)
  fixed += consistencyFixed

  // 4. 语义检查（需要 LLM）
  if (model) {
    const semanticIssues = await checkSemantic(wikiDir, model, config)
    allIssues.push(...semanticIssues)

    // 修复可自动修复的语义问题
    for (const issue of semanticIssues) {
      if (issue.type === 'contradiction' && issue.suggestion?.includes('replace')) {
        // 找到需要 replace 的页面
        const targetFile = issue.pages[0]
        const page = await readPage(wikiDir, targetFile)
        if (page) {
          // 使用更新的信息替换
          const newerFile = issue.pages[1]
          const newerPage = await readPage(wikiDir, newerFile)
          if (newerPage) {
            await replacePage(wikiDir, targetFile, page.data, newerPage.content)
            fixed++
          }
        }
      }
    }
  }

  // 5. 写入日志
  const report: LintReport = {
    checked: (await readAllPages(wikiDir, config)).length,
    issues: allIssues,
    fixed,
    timestamp: now,
  }

  await appendLog(wikiDir, {
    timestamp: now,
    operation: 'lint',
    description: `检查 ${report.checked} 个页面，发现 ${allIssues.length} 个问题，修复 ${fixed} 个`,
    details: allIssues.map(i => `${i.type}: ${i.description}`),
  }, config)

  if (allIssues.length > 0) {
    logger.debug('WikiLint', `Found ${allIssues.length} issues, fixed ${fixed}`)
  }

  return report
}
