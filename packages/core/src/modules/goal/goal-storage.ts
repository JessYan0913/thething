// ============================================================
// Goal Storage - SQLite 持久化
// ============================================================
// 目标状态持久化到 DataStore，支持会话恢复。

import type { GoalState } from './types'
import type { DataStore } from '../../primitives/datastore/types'

const GOAL_TABLE = 'goals'

/**
 * 确保 goals 表存在
 */
function ensureTable(dataStore: DataStore): void {
  const db = (dataStore as any).db
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${GOAL_TABLE} (
      conversation_id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

/**
 * 持久化当前目标
 */
export function persistGoal(
  dataStore: DataStore,
  conversationId: string,
  goal: GoalState,
): void {
  try {
    ensureTable(dataStore)
    const db = (dataStore as any).db
    if (!db) return

    db.prepare(`
      INSERT OR REPLACE INTO ${GOAL_TABLE} (conversation_id, goal, updated_at)
      VALUES (?, ?, ?)
    `).run(conversationId, JSON.stringify(goal), Date.now())
  } catch {
    // 静默忽略持久化失败
  }
}

/**
 * 加载目标
 */
export function loadGoal(
  dataStore: DataStore,
  conversationId: string,
): GoalState | null {
  try {
    ensureTable(dataStore)
    const db = (dataStore as any).db
    if (!db) return null

    const row = db.prepare(`
      SELECT goal FROM ${GOAL_TABLE} WHERE conversation_id = ?
    `).get(conversationId) as { goal: string } | undefined

    if (!row) return null
    return JSON.parse(row.goal) as GoalState
  } catch {
    return null
  }
}

/**
 * 清除目标（写入墓碑标记）
 */
export function clearGoalStorage(
  dataStore: DataStore,
  conversationId: string,
): void {
  try {
    ensureTable(dataStore)
    const db = (dataStore as any).db
    if (!db) return

    db.prepare(`
      DELETE FROM ${GOAL_TABLE} WHERE conversation_id = ?
    `).run(conversationId)
  } catch {
    // 静默忽略
  }
}
