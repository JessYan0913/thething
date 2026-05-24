// ============================================================
// @the-thing/cli - CLI Entry Point
// ============================================================

// IMPORTANT: Load environment variables before any other imports
// This must be the first import to ensure env vars are available
// when other modules (like @the-thing/core) initialize
import './lib/env-loader'

import { Command } from 'commander'
import config from './commands/config'
import db from './commands/db'
import serve from './commands/serve'

const program = new Command()

program
  .name('thething')
  .version('0.1.0')
  .description('Multi-form AI Agent - CLI, Web, and Portable')

// Default command: start chat (lazy import to avoid loading Ink/yoga-wasm in server mode)
program
  .action(async () => {
    const { default: chat } = await import('./commands/chat.js')
    chat({})
  })

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

// Serve command: start HTTP server with optional static assets
program
  .command('serve')
  .description('Start the HTTP server')
  .option('-p, --port <port>', 'Port number (0 for auto)', '3456')
  .option('-w, --web-dir <dir>', 'Web assets directory')
  .action((opts) => {
    serve({ port: parseInt(opts.port, 10), webDir: opts.webDir })
  })

// Parse arguments
program.parse()