import React from 'react'
import { Text, Box } from 'ink'
import Spinner from './Spinner.js'

interface Props {
  text: string
  isActive: boolean
  elapsed: number
}

export function ReasoningBlock({ text, isActive, elapsed }: Props) {
  if (!text && !isActive) return null

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {isActive ? (
          <>
            <Spinner type="dots" />
            <Text color="yellow"> Thinking...</Text>
          </>
        ) : (
          <Text dimColor>──── Thought for {elapsed.toFixed(1)}s ────</Text>
        )}
      </Box>
      {text && (
        <Box marginLeft={2}>
          <Text dimColor>{text}</Text>
        </Box>
      )}
    </Box>
  )
}
