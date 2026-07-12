import React, { useState, useCallback, useRef, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import chalk from 'chalk'

interface Props {
  onSubmit: (text: string) => void
  onCommand: (cmd: string) => Promise<{ type: string; output?: string; shouldQuery?: boolean }>
  disabled?: boolean
  currentModel: string
  conversationTitle?: string | null
}

export function InputBar({ onSubmit, onCommand, disabled, currentModel, conversationTitle }: Props) {
  const [value, setValue] = useState('')
  const [commandOutput, setCommandOutput] = useState<string | null>(null)
  const [continuationBuffer, setContinuationBuffer] = useState<string[]>([])
  const isContinuation = continuationBuffer.length > 0

  const handleSubmit = useCallback(async (input: string) => {
    if (disabled) return
    const trimmed = input.trim()
    if (!trimmed) return

    if (trimmed.endsWith('\\')) {
      setContinuationBuffer(prev => [...prev, trimmed.slice(0, -1)])
      setValue('')
      return
    }

    if (isContinuation) {
      const fullInput = [...continuationBuffer, trimmed].join('\n')
      setContinuationBuffer([])
      setValue('')
      setCommandOutput(null)
      onSubmit(fullInput)
      return
    }

    setValue('')
    setCommandOutput(null)

    if (trimmed.startsWith('/')) {
      const result = await onCommand(trimmed)
      if (result.output) {
        setCommandOutput(result.output)
      }
      // 如果命令需要触发查询，发送一个空消息来触发 agent
      if (result.shouldQuery) {
        onSubmit('')
      }
      return
    }

    onSubmit(trimmed)
  }, [disabled, onSubmit, onCommand, isContinuation, continuationBuffer])

  useInput((input, key) => {
    if (key.escape && isContinuation) {
      setContinuationBuffer([])
      setValue('')
    }
  }, { isActive: !disabled })

  const prompt = isContinuation ? chalk.dim('... ') : chalk.cyan('> ')
  const statusParts = [chalk.dim(currentModel)]
  if (conversationTitle) {
    statusParts.push(chalk.dim(`| ${conversationTitle}`))
  }

  return (
    <Box flexDirection="column">
      {commandOutput && (
        <Box marginBottom={1}>
          <Text>{commandOutput}</Text>
        </Box>
      )}
      <Box>
        <Text>{prompt}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={disabled ? '' : isContinuation ? 'Continue input...' : 'Send a message...'}
          focus={!disabled}
        />
      </Box>
      <Box>
        <Text>{statusParts.join(' ')}</Text>
      </Box>
    </Box>
  )
}
