// ============================================================
// Status Command - Show server status
// ============================================================

import chalk from 'chalk'
import { getDataDirConfig } from '../lib/data-dir'
import { readServerLock, isServerRunning } from '../lib/server-manager'

export interface StatusOptions {}

export default async function status(options?: StatusOptions): Promise<void> {
  const dataDirConfig = getDataDirConfig()

  console.log(chalk.blue('Server Status'))
  console.log()

  // Check if server is running
  const running = isServerRunning(dataDirConfig.lockPath)

  if (!running) {
    console.log(chalk.yellow('  Status: Not running'))
    console.log(chalk.gray(`  Data directory: ${dataDirConfig.dataDir}`))
    return
  }

  // Read lock file
  const lock = readServerLock(dataDirConfig.lockPath)

  if (lock) {
    console.log(chalk.green('  Status: Running'))
    console.log(chalk.gray(`  Port: ${lock.port}`))
    console.log(chalk.gray(`  PID: ${lock.pid}`))
    console.log(chalk.gray(`  Started: ${new Date(lock.startedAt).toLocaleString()}`))
    console.log(chalk.gray(`  Data directory: ${lock.dataDir}`))
    console.log(chalk.gray(`  Database: ${dataDirConfig.dbPath}`))

    console.log()
    console.log(chalk.blue('Endpoints:'))
    console.log(chalk.gray(`  http://localhost:${lock.port}/api/chat`))
    console.log(chalk.gray(`  http://localhost:${lock.port}/api/conversations`))
    console.log(chalk.gray(`  http://localhost:${lock.port}/health`))
  }
}