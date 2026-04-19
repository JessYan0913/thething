// ============================================================
// @thething/cli - CLI Entry Point
// ============================================================

// IMPORTANT: Load environment variables before any other imports
// This must be the first import to ensure env vars are available
// when other modules (like @thething/core) initialize
import './lib/env-loader'

import { Command } from 'commander'
import start from './commands/start'
import stop from './commands/stop'
import status from './commands/status'
import chat from './commands/chat'
import config from './commands/config'
import db from './commands/db'

const program = new Command()

program
  .name('thething')
  .version('0.1.0')
  .description('Multi-form AI Agent - CLI, Web, and Portable')

// Default command: start server
program
  .action(() => {
    start({})
  })

// Start command
program
  .command('start')
  .description('Start the HTTP server and open browser')
  .option('--port <port>', 'Port number', '3456')
  .option('--no-open', 'Do not open browser')
  .option('--data-dir <path>', 'Data directory path')
  .action((options) => start(options))

// Stop command
program
  .command('stop')
  .description('Stop the running server')
  .action(() => stop())

// Status command
program
  .command('status')
  .description('Show server status')
  .action(() => status())

// Chat command
program
  .command('chat')
  .description('Start interactive chat session')
  .option('--conversation <id>', 'Conversation ID to continue')
  .option('--model <name>', 'Model name')
  .action((options) => chat(options))

// Config command (with subcommands)
const configCmd = program
  .command('config')
  .description('Configuration management')

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => config.show())

configCmd
  .command('set <key> <value>')
  .description('Set configuration value')
  .action((key, value) => config.set(key, value))

// DB command (with subcommands)
const dbCmd = program
  .command('db')
  .description('Database management')

dbCmd
  .command('path')
  .description('Show database path')
  .action(() => db.path())

dbCmd
  .command('backup <path>')
  .description('Backup database to specified path')
  .action((backupPath) => db.backup(backupPath))

// Parse arguments
program.parse()