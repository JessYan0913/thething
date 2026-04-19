// ============================================================
// Interactive REPL - Read-Eval-Print Loop for chat
// ============================================================

import * as readline from 'readline'
import chalk from 'chalk'
import { printUserPrefix, printAssistantPrefix, printSeparator, createSpinner } from './stream-output'

export interface ReplOptions {
  onInput: (input: string) => Promise<void>
  onCommand: (command: string) => Promise<boolean>
  onCancel: () => void
}

/**
 * Create interactive REPL
 */
export function createRepl(options: ReplOptions): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('> '),
  })

  let isGenerating = false
  let pendingCancel = false

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    if (isGenerating) {
      // Cancel current generation
      pendingCancel = true
      options.onCancel()
      console.log(chalk.yellow('\nGeneration cancelled.'))
      rl.prompt()
    } else {
      // Exit REPL
      console.log(chalk.yellow('\nGoodbye!'))
      rl.close()
      process.exit(0)
    }
  })

  rl.on('line', async (input) => {
    const trimmed = input.trim()

    if (!trimmed) {
      rl.prompt()
      return
    }

    // Check for slash commands
    if (trimmed.startsWith('/')) {
      const shouldContinue = await options.onCommand(trimmed)
      if (!shouldContinue) {
        rl.close()
        return
      }
      rl.prompt()
      return
    }

    // Process user input
    isGenerating = true
    pendingCancel = false

    printSeparator()
    printAssistantPrefix()

    try {
      await options.onInput(trimmed)
    } catch (error) {
      console.log(chalk.red('\nError:'), error instanceof Error ? error.message : String(error))
    }

    isGenerating = false
    console.log() // New line after response
    printSeparator()
    rl.prompt()
  })

  rl.on('close', () => {
    console.log(chalk.yellow('Goodbye!'))
    process.exit(0)
  })

  return rl
}

/**
 * Start REPL loop
 */
export function startRepl(rl: readline.Interface): void {
  console.log(chalk.dim('Commands: /clear, /exit, Ctrl+C to cancel'))
  printSeparator()
  rl.prompt()
}

/**
 * Close REPL
 */
export function closeRepl(rl: readline.Interface): void {
  rl.close()
}