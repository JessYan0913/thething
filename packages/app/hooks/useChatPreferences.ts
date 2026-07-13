'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * 共享的对话输入框偏好状态管理 hook
 * 同时持久化到 localStorage（即时）和后端 ~/.thething/preferences.json（跨设备）
 */

export type ApprovalMode = 'smart' | 'auto-review' | 'full-trust'

export interface ChatPreferencesState {
  selectedModel: string
  selectedAgent: string
  approvalMode: ApprovalMode
  handleModelChange: (value: string) => void
  handleAgentChange: (value: string) => void
  handleApprovalModeChange: (value: string) => void
}

// localStorage keys (保持兼容)
const SELECTED_MODEL_KEY = 'chat_selected_model'
const SELECTED_AGENT_KEY = 'chat_selected_agent'
const SELECTED_APPROVAL_MODE_KEY = 'chat_approval_mode'

function readLocalStorage(key: string, defaultValue: string): string {
  if (typeof window === 'undefined') return defaultValue
  return localStorage.getItem(key) || defaultValue
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, value)
}

// debounce 后端同步，避免频繁写入
let syncTimeout: ReturnType<typeof setTimeout> | null = null
function debouncedSyncToBackend(prefs: Record<string, string>) {
  if (syncTimeout) clearTimeout(syncTimeout)
  syncTimeout = setTimeout(() => {
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch(() => {
      // 静默失败，不影响用户体验
    })
  }, 500)
}

export function useChatPreferences(): ChatPreferencesState {
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    readLocalStorage(SELECTED_MODEL_KEY, 'default')
  )
  const [selectedAgent, setSelectedAgent] = useState<string>(() =>
    readLocalStorage(SELECTED_AGENT_KEY, 'auto')
  )
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() =>
    readLocalStorage(SELECTED_APPROVAL_MODE_KEY, 'smart') as ApprovalMode
  )

  const mountedRef = useRef(false)

  // 首次挂载时从后端加载偏好（覆盖 localStorage 可能过时的值）
  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    fetch('/api/preferences')
      .then((r) => r.json())
      .then((prefs) => {
        if (prefs.selectedModel) {
          setSelectedModel(prefs.selectedModel)
          writeLocalStorage(SELECTED_MODEL_KEY, prefs.selectedModel)
        }
        if (prefs.selectedAgent) {
          setSelectedAgent(prefs.selectedAgent)
          writeLocalStorage(SELECTED_AGENT_KEY, prefs.selectedAgent)
        }
        if (prefs.approvalMode) {
          setApprovalMode(prefs.approvalMode)
          writeLocalStorage(SELECTED_APPROVAL_MODE_KEY, prefs.approvalMode)
        }
      })
      .catch(() => {
        // 静默失败，使用 localStorage 或默认值
      })
  }, [])

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value)
    writeLocalStorage(SELECTED_MODEL_KEY, value)
    debouncedSyncToBackend({ selectedModel: value })
  }, [])

  const handleAgentChange = useCallback((value: string) => {
    setSelectedAgent(value)
    writeLocalStorage(SELECTED_AGENT_KEY, value)
    debouncedSyncToBackend({ selectedAgent: value })
  }, [])

  const handleApprovalModeChange = useCallback((value: string) => {
    setApprovalMode(value as ApprovalMode)
    writeLocalStorage(SELECTED_APPROVAL_MODE_KEY, value)
    debouncedSyncToBackend({ approvalMode: value })
  }, [])

  return {
    selectedModel,
    selectedAgent,
    approvalMode,
    handleModelChange,
    handleAgentChange,
    handleApprovalModeChange,
  }
}
