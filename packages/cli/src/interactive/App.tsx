import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { nanoid } from 'nanoid'
import type { UIMessage } from 'ai'
import type { CoreRuntime, AppContext, DataStore } from '@the-thing/core'
import { generateConversationTitle } from '@the-thing/core'
import { useAgentStream } from './hooks/useAgentStream.js'
import { useConversation } from './hooks/useConversation.js'
import { useSlashCommands } from './hooks/useSlashCommands.js'
import { StreamingResponse } from './components/StreamingResponse.js'
import { InputBar } from './components/InputBar.js'
import { MessageList } from './components/MessageList.js'
import type { CompletedMessage } from './lib/types.js'

function extractLastAssistantText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      return (msg.parts || [])
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join('\n\n')
    }
  }
  return ''
}

interface AppProps {
  runtime: CoreRuntime
  context: AppContext
  store: DataStore
  initialConversationId?: string
  initialModel: string
  apiKey: string
  baseURL: string
  enableThinking?: boolean
}

export function App({
  runtime,
  context,
  store,
  initialConversationId,
  initialModel,
  apiKey,
  baseURL,
  enableThinking,
}: AppProps) {
  const { exit } = useApp()
  const [modelName, setModelName] = useState(initialModel)
  const [completedItems, setCompletedItems] = useState<CompletedMessage[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const sessionApprovedScopes = useRef(new Set<string>())
  const isFirstTurn = useRef(true)

  const conversation = useConversation(store, initialConversationId)
  const stream = useAgentStream({
    context,
    conversationId: conversation.conversationId,
    modelConfig: { apiKey, baseURL, modelName, enableThinking },
  })

  const commands = useSlashCommands({
    conversation,
    setModel: setModelName,
    currentModel: modelName,
    onExit: () => {
      runtime.dispose().then(() => exit())
    },
  })

  const handleSubmit = useCallback((text: string) => {
    setErrorMsg(null)
    const userMsg: UIMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text }],
    }

    setCompletedItems(prev => [...prev, {
      id: userMsg.id,
      role: 'user',
      text,
    }])

    const allMessages = [...conversation.messages, userMsg]
    conversation.setMessages(allMessages)
    stream.startStream(allMessages)
  }, [conversation, stream])

  useEffect(() => {
    if (stream.state.phase === 'done') {
      const streamText = stream.state.text
      const finishedText = stream.finishedMessages.length > 0
        ? extractLastAssistantText(stream.finishedMessages)
        : ''

      // Prefer streamText (reset per turn) to avoid cross-turn text leaking.
      // Only fall back to finishedText if streamText is empty.
      const text = streamText || finishedText

      const item: CompletedMessage = {
        id: nanoid(),
        role: 'assistant',
        text,
        toolCalls: [...stream.state.toolCalls.values()],
        reasoning: stream.state.reasoning || undefined,
        cost: stream.state.cost,
      }
      setCompletedItems(prev => [...prev, item])

      if (stream.finishedMessages.length > 0) {
        conversation.setMessages(stream.finishedMessages)
        conversation.saveMessages()

        if (isFirstTurn.current && text) {
          isFirstTurn.current = false
          generateConversationTitle(
            stream.finishedMessages,
          ).then(title => {
            if (title) conversation.setConversationTitle(title)
          }).catch(() => {})
        }
      }

      stream.reset()
    }

    if (stream.state.phase === 'error') {
      setErrorMsg(stream.state.error || 'Unknown error')
      stream.reset()
    }
  }, [stream.state.phase])

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      if (stream.state.phase === 'streaming' || stream.state.phase === 'awaiting-approval') {
        stream.abort()
      } else {
        runtime.dispose().then(() => exit())
      }
    }
  })

  const isStreaming = stream.state.phase === 'streaming' || stream.state.phase === 'awaiting-approval'

  return (
    <Box flexDirection="column">
      <MessageList items={completedItems} />

      {isStreaming && (
        <Box flexDirection="column" marginTop={1}>
          <StreamingResponse
            state={stream.state}
            onApprovalResponse={stream.respondApproval}
            sessionApprovedScopes={sessionApprovedScopes.current}
          />
        </Box>
      )}

      {errorMsg && !isStreaming && (
        <Box marginTop={1}>
          <Text color="red">Error: {errorMsg}</Text>
        </Box>
      )}

      {!isStreaming && (
        <InputBar
          onSubmit={handleSubmit}
          onCommand={commands.handleCommand}
          disabled={isStreaming}
          currentModel={modelName}
          conversationTitle={conversation.conversationTitle}
        />
      )}
    </Box>
  )
}
