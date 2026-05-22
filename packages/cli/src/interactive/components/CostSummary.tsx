import React from 'react'
import { Text, Box } from 'ink'

interface Props {
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
}

export function CostSummary({ totalCostUsd, inputTokens, outputTokens }: Props) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        Cost: ${totalCostUsd.toFixed(6)} | Input: {inputTokens} | Output: {outputTokens}
      </Text>
    </Box>
  )
}
