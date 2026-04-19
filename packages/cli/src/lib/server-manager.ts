// ============================================================
// Server Lock File Management
// ============================================================

import fs from 'fs'
import path from 'path'

export interface ServerLock {
  port: number
  pid: number
  startedAt: number
  dataDir: string
}

/**
 * Write server lock file
 */
export function writeServerLock(lockPath: string, lock: ServerLock): void {
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
}

/**
 * Read server lock file
 */
export function readServerLock(lockPath: string): ServerLock | null {
  if (!fs.existsSync(lockPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(lockPath, 'utf-8')
    return JSON.parse(content) as ServerLock
  } catch {
    return null
  }
}

/**
 * Delete server lock file
 */
export function deleteServerLock(lockPath: string): void {
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath)
  }
}

/**
 * Check if server is running
 */
export function isServerRunning(lockPath: string): boolean {
  const lock = readServerLock(lockPath)
  if (!lock) return false

  // Check if process is still running
  try {
    // Sending signal 0 to check if process exists
    process.kill(lock.pid, 0)
    return true
  } catch {
    // Process not running, clean up stale lock
    deleteServerLock(lockPath)
    return false
  }
}

/**
 * Stop server by PID
 */
export function stopServerProcess(lock: ServerLock): boolean {
  try {
    process.kill(lock.pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}