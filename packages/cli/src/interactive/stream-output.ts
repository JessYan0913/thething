// ============================================================
// Stream Output Renderer - Render AI stream to terminal
// ============================================================

import chalk from 'chalk'
import ora from 'ora'

/**
 * Render text stream to terminal with formatting
 */
export function renderStreamText(text: string): void {
  // Print text directly
  process.stdout.write(text)
}

/**
 * Create a spinner for waiting state
 */
export function createSpinner(text: string): ReturnType<typeof ora> {
  return ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  }).start()
}

/**
 * Format tool call output
 */
export function formatToolCall(toolName: string, input?: Record<string, unknown>): string {
  const inputPreview = input ? JSON.stringify(input).slice(0, 50) : ''
  return chalk.gray(`[Tool: ${toolName}] ${inputPreview}${inputPreview.length >= 50 ? '...' : ''}`)
}

/**
 * Format reasoning output
 */
export function formatReasoning(text: string): string {
  return chalk.magenta(`[Reasoning] ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`)
}

/**
 * Print separator line
 */
export function printSeparator(): void {
  console.log(chalk.gray('─'.repeat(40)))
}

/**
 * Print user message prefix
 */
export function printUserPrefix(): void {
  console.log(chalk.cyan('You: '))
}

/**
 * Print assistant message prefix
 */
export function printAssistantPrefix(): void {
  process.stdout.write(chalk.green('Assistant: '))
}