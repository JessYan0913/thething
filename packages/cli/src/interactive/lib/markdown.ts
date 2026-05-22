import chalk from 'chalk'
import { Lexer, type Token, type Tokens } from 'marked'

const lexer = new Lexer()

export function renderMarkdown(text: string): string {
  const tokens = lexer.lex(text)
  return tokens.map(renderToken).join('')
}

function renderToken(token: Token): string {
  switch (token.type) {
    case 'heading':
      return renderHeading(token as Tokens.Heading)
    case 'paragraph':
      return renderInline((token as Tokens.Paragraph).text) + '\n\n'
    case 'code':
      return renderCodeBlock(token as Tokens.Code)
    case 'list':
      return renderList(token as Tokens.List)
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote)
    case 'hr':
      return chalk.dim('─'.repeat(Math.min(process.stdout.columns || 80, 60))) + '\n\n'
    case 'table':
      return renderTable(token as Tokens.Table)
    case 'space':
      return '\n'
    case 'html':
      return (token as Tokens.HTML).text + '\n'
    default:
      if ('text' in token) return renderInline((token as any).text) + '\n'
      return ''
  }
}

function renderHeading(token: Tokens.Heading): string {
  const text = renderInline(token.text)
  if (token.depth <= 2) return chalk.bold.underline(text) + '\n\n'
  return chalk.bold(text) + '\n\n'
}

function renderCodeBlock(token: Tokens.Code): string {
  const width = Math.min(process.stdout.columns || 80, 80)
  const lang = token.lang || ''
  const lines = token.text.split('\n')

  let highlighted: string
  try {
    const { highlight } = require('cli-highlight') as typeof import('cli-highlight')
    highlighted = highlight(token.text, { language: lang || 'plaintext', ignoreIllegals: true })
  } catch {
    highlighted = token.text
  }

  const highlightedLines = highlighted.split('\n')
  const top = chalk.dim(`┌${'─'.repeat(width - 2)}┐`) + (lang ? ` ${chalk.dim(lang)}` : '')
  const bottom = chalk.dim(`└${'─'.repeat(width - 2)}┘`)
  const body = highlightedLines.map(l => `${chalk.dim('│')} ${l}`).join('\n')

  return `${top}\n${body}\n${bottom}\n\n`
}

function renderList(token: Tokens.List): string {
  return token.items.map((item, i) => {
    const prefix = token.ordered ? chalk.dim(`${i + 1}.`) : chalk.dim('•')
    const text = renderInline(item.text)
    return ` ${prefix} ${text}`
  }).join('\n') + '\n\n'
}

function renderBlockquote(token: Tokens.Blockquote): string {
  const text = token.tokens ? token.tokens.map(renderToken).join('') : ''
  return text.split('\n').filter(Boolean).map(line =>
    `${chalk.dim('│')} ${chalk.italic(line)}`
  ).join('\n') + '\n\n'
}

function renderTable(token: Tokens.Table): string {
  const headers = token.header.map(h => renderInline(h.text))
  const rows = token.rows.map(row => row.map(cell => renderInline(cell.text)))

  const colWidths = headers.map((h, i) => {
    const cellValues = [h, ...rows.map(r => r[i] || '')]
    return Math.max(...cellValues.map(v => stripAnsi(v).length))
  })

  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stripAnsi(s).length))

  const headerLine = headers.map((h, i) => chalk.bold(pad(h, colWidths[i]))).join(chalk.dim(' │ '))
  const separator = colWidths.map(w => '─'.repeat(w)).join(chalk.dim('─┼─'))
  const bodyLines = rows.map(row =>
    row.map((cell, i) => pad(cell, colWidths[i])).join(chalk.dim(' │ '))
  )

  return [headerLine, chalk.dim(separator), ...bodyLines].join('\n') + '\n\n'
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => chalk.bold.italic(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t))
    .replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t))
    .replace(/`([^`]+)`/g, (_, t) => chalk.cyan(t))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => chalk.blue.underline(label) + chalk.dim(` (${url})`))
}

const ANSI_REGEX = /\x1b\[[0-9;]*m/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '')
}
