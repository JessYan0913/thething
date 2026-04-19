// ============================================================
// Stop Command - Stop the running server
// ============================================================

import chalk from 'chalk'
import { getDataDirConfig } from '../lib/data-dir'
import { readServerLock, deleteServerLock, stopServerProcess, isServerRunning } from '../lib/server-manager'

export interface StopOptions {}

export default async function stop(options?: StopOptions): Promise<void> {
  const dataDirConfig = getDataDirConfig()

  // Check if server is running
  if (!isServerRunning(dataDirConfig.lockPath)) {
    console.log(chalk.yellow('Server is not running.'))
    return
  }

  // Read lock file
  const lock = readServerLock(dataDirConfig.lockPath)
  if (!lock) {
    console.log(chalk.yellow('Server is not running (no lock file).'))
    return
  }

  // Stop the process
  console.log(chalk.blue(`Stopping server (PID: ${lock.pid})...`))

  const success = stopServerProcess(lock)

  if (success) {
    // Delete lock file
    deleteServerLock(dataDirConfig.lockPath)
    console.log(chalk.green('Server stopped successfully.'))
  } else {
    console.log(chalk.red('Failed to stop server. Process may have already exited.'))
    // Clean up stale lock
    deleteServerLock(dataDirConfig.lockPath)
  }
}