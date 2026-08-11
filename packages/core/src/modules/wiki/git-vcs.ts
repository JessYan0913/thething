// ============================================================
// Git VCS - 用宿主 git 作为 wiki 的底层版本控制
// ============================================================
// git 提供字节级历史、可靠存储与宿主机工具；应用层只保留 log.md
// 作为语义记录（operation/reason）。git 缺失或 commit 失败时
// 静默降级，不阻断 wiki 写入。

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { logger } from '../../primitives/logger'

const execFileAsync = promisify(execFile)

const GITIGNORE_CONTENT = '# 派生数据（revisions/snapshots 可重建），不进版本控制\nsystem/\nraw/\n'

async function runGit(args: string[], cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', args, { cwd, timeout: 15000 })
    return true
  } catch (err) {
    logger.warn('WikiGit', `git ${args[0]} failed in ${cwd}: ${(err as Error).message}`)
    return false
  }
}

/** 判断是否有未提交变更 */
async function hasChanges(wikiDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: wikiDir, timeout: 5000 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * 确保 wiki 目录已初始化 git 仓库（无 .git 时 init + 写 .gitignore + 本地 user 配置）。
 * git 不可用或初始化失败时静默跳过。
 */
export async function ensureWikiGitRepo(wikiDir: string): Promise<void> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000 })
  } catch {
    logger.warn('WikiGit', 'git not available on host, skipping version control')
    return
  }

  try {
    await fs.access(path.join(wikiDir, '.git'))
    return // 已初始化
  } catch {
    // 需要 init
  }

  const ok = await runGit(['init', '-q'], wikiDir)
  if (ok) {
    await fs.writeFile(path.join(wikiDir, '.gitignore'), GITIGNORE_CONTENT, 'utf8')
    // 本地 user 配置：不依赖宿主全局配置，保证 commit 一定可执行
    await runGit(['config', 'user.name', 'TheThing Wiki'], wikiDir)
    await runGit(['config', 'user.email', 'wiki@thething.local'], wikiDir)
    // 首次提交初始状态，后续 commit 才有基线
    await runGit(['add', '-A'], wikiDir)
    await runGit(['commit', '-q', '-m', 'init: wiki baseline'], wikiDir)
  }
}

/**
 * 将当前 wiki 变更提交到 git。无变更或失败时静默/告警，不影响写入主流程。
 */
export async function commitWiki(wikiDir: string, message: string): Promise<void> {
  await ensureWikiGitRepo(wikiDir)
  await runGit(['add', '-A'], wikiDir)
  if (!(await hasChanges(wikiDir))) return // 无变更，不产生空 commit
  await runGit(['commit', '-q', '-m', message], wikiDir)
}
