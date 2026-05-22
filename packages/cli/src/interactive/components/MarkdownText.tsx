import React, { useMemo } from 'react'
import { Text } from 'ink'
import { renderMarkdown } from '../lib/markdown.js'

interface Props {
  text: string
  streaming?: boolean
}

export function MarkdownText({ text, streaming }: Props) {
  const rendered = useMemo(() => {
    if (!text) return ''
    if (streaming) return text
    try {
      return renderMarkdown(text)
    } catch {
      return text
    }
  }, [text, streaming])

  if (!rendered) return null

  return <Text>{rendered}</Text>
}
