import { useState, useCallback } from 'react'
import { nanoid } from 'nanoid'
import type { UIMessage } from 'ai'
import type { DataStore, Conversation } from '@the-thing/core'

export interface UseConversationResult {
  conversationId: string
  messages: UIMessage[]
  setMessages: (msgs: UIMessage[]) => void
  addMessage: (msg: UIMessage) => void
  clearMessages: () => void
  saveMessages: () => void
  newConversation: () => void
  listConversations: () => Conversation[]
  resumeConversation: (id: string) => boolean
  renameConversation: (title: string) => void
  deleteConversation: (id: string) => boolean
  conversationTitle: string | null
  setConversationTitle: (title: string) => void
}

export function useConversation(
  store: DataStore,
  initialConversationId?: string,
): UseConversationResult {
  const [conversationId, setConversationId] = useState(
    initialConversationId || nanoid(),
  )
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [conversationTitle, setConversationTitle] = useState<string | null>(null)

  const addMessage = useCallback((msg: UIMessage) => {
    setMessages(prev => [...prev, msg])
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const saveMessages = useCallback(() => {
    try {
      const conv = store.conversationStore.getConversation(conversationId)
      if (!conv) {
        store.conversationStore.createConversation(conversationId, conversationTitle || undefined)
      }
      store.messageStore.replaceConversation(conversationId, messages)
    } catch {
      // silently ignore save failures
    }
  }, [store, conversationId, messages, conversationTitle])

  const newConversation = useCallback(() => {
    const id = nanoid()
    setConversationId(id)
    setMessages([])
    setConversationTitle(null)
  }, [])

  const listConversations = useCallback(() => {
    try {
      return store.conversationStore.listConversations()
    } catch {
      return []
    }
  }, [store])

  const resumeConversation = useCallback((id: string) => {
    const conv = store.conversationStore.getConversation(id)
    if (!conv) return false
    const msgs = store.messageStore.getMessagesByConversation(id)
    setConversationId(id)
    setMessages(msgs)
    setConversationTitle(conv.title)
    return true
  }, [store])

  const renameConversation = useCallback((title: string) => {
    store.conversationStore.updateConversationTitle(conversationId, title)
    setConversationTitle(title)
  }, [store, conversationId])

  const deleteConversation = useCallback((id: string) => {
    try {
      store.conversationStore.deleteConversation(id)
      if (id === conversationId) {
        newConversation()
      }
      return true
    } catch {
      return false
    }
  }, [store, conversationId, newConversation])

  return {
    conversationId,
    messages,
    setMessages,
    addMessage,
    clearMessages,
    saveMessages,
    newConversation,
    listConversations,
    resumeConversation,
    renameConversation,
    deleteConversation,
    conversationTitle,
    setConversationTitle,
  }
}
