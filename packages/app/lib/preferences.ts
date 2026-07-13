import path from 'path'
import os from 'os'
import fs from 'fs/promises'

/**
 * 用户偏好设置存储在 ~/.thething/preferences.json
 * 用于持久化对话输入框的三个选项选择：
 * - selectedModel: 模型选择 (default/fast/smart)
 * - selectedAgent: Agent 选择 (auto/agentType)
 * - approvalMode: 审批模式 (smart/auto-review/full-trust)
 */

export interface UserPreferences {
  selectedModel: string
  selectedAgent: string
  approvalMode: 'smart' | 'auto-review' | 'full-trust'
}

const PREFERENCES_FILE = path.join(os.homedir(), '.thething', 'preferences.json')

const DEFAULT_PREFERENCES: UserPreferences = {
  selectedModel: 'default',
  selectedAgent: 'auto',
  approvalMode: 'smart',
}

export async function loadPreferences(): Promise<UserPreferences> {
  try {
    const content = await fs.readFile(PREFERENCES_FILE, 'utf-8')
    const parsed = JSON.parse(content)
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export async function savePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const current = await loadPreferences()
  const updated = { ...current, ...prefs }
  await fs.mkdir(path.dirname(PREFERENCES_FILE), { recursive: true })
  await fs.writeFile(PREFERENCES_FILE, JSON.stringify(updated, null, 2), 'utf-8')
}
