import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from './wiki-config'

export interface WikiLintStatus {
  changesSinceLastLint: number
  due: boolean
}

export async function getWikiLintStatus(
  wikiDir: string,
  config: WikiConfig = DEFAULT_WIKI_CONFIG,
): Promise<WikiLintStatus> {
  let log = ''
  try {
    log = await fs.readFile(path.join(wikiDir, config.logFile), 'utf8')
  } catch {
    return { changesSinceLastLint: 0, due: false }
  }

  const operations = log
    .split('\n')
    .flatMap(line => {
      const match = line.match(/^## \[[^\]]+\]\s+([^|\s]+)\s*\|/)
      return match ? [match[1]] : []
    })

  const lastLint = operations.lastIndexOf('lint')
  const changesSinceLastLint = operations
    .slice(lastLint + 1)
    .filter(operation => operation === 'ingest' || operation === 'query' || operation === 'maintenance')
    .length

  return {
    changesSinceLastLint,
    due: config.lintInterval > 0 && changesSinceLastLint >= config.lintInterval,
  }
}
