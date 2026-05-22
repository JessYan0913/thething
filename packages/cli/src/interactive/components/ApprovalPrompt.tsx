import React, { useState } from 'react'
import { Text, Box, useInput } from 'ink'
import chalk from 'chalk'
import type { ApprovalRequest, ApprovalResponse, SelectOption } from '../lib/types.js'
import { buildApprovalQuestion, buildApprovalOptions, computeApprovalScope } from '../lib/approval-logic.js'

interface ApprovalPromptProps {
  request: ApprovalRequest
  onRespond: (response: ApprovalResponse) => void
  sessionApprovedScopes: Set<string>
}

export function ApprovalPrompt({ request, onRespond, sessionApprovedScopes }: ApprovalPromptProps) {
  const question = buildApprovalQuestion(request.toolName, request.input)
  const options = buildApprovalOptions(request.toolName, request.input)
  const [selected, setSelected] = useState(0)

  useInput((input, key) => {
    if (key.upArrow || key.leftArrow) {
      setSelected(prev => (prev - 1 + options.length) % options.length)
    } else if (key.downArrow || key.rightArrow) {
      setSelected(prev => (prev + 1) % options.length)
    } else if (key.return) {
      handleSelect(options[selected].value)
    } else if (key.escape) {
      handleSelect('deny')
    } else {
      const num = parseInt(input, 10)
      if (num >= 1 && num <= options.length) {
        handleSelect(options[num - 1].value)
      }
    }
  })

  function handleSelect(choice: 'allow' | 'always' | 'deny') {
    const approved = choice !== 'deny'
    if (choice === 'always') {
      sessionApprovedScopes.add(computeApprovalScope(request.toolName, request.input))
    }
    onRespond({ approvalId: request.approvalId, approved })
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold> {question}</Text>
      <Box flexDirection="column">
        {options.map((opt, i) => (
          <Text key={opt.value}>
            {i === selected ? chalk.cyan(' ❯ ') : '   '}
            {i === selected
              ? chalk.cyan.bold(`${i + 1}. ${opt.label}`)
              : chalk.dim(`${i + 1}. ${opt.label}`)}
          </Text>
        ))}
      </Box>
      <Text dimColor> Esc to deny</Text>
    </Box>
  )
}

interface UserQuestionPromptProps {
  question: string
  options: SelectOption[]
  multiSelect?: boolean
  onAnswer: (answer: string | string[]) => void
}

export function UserQuestionPrompt({ question, options, multiSelect, onAnswer }: UserQuestionPromptProps) {
  const [selected, setSelected] = useState(0)
  const [checked, setChecked] = useState(new Set<number>())

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(prev => (prev - 1 + options.length) % options.length)
    } else if (key.downArrow) {
      setSelected(prev => (prev + 1) % options.length)
    } else if (key.return) {
      if (multiSelect) {
        onAnswer([...checked].sort().map(i => options[i].value))
      } else {
        onAnswer(options[selected].value)
      }
    } else if (input === ' ' && multiSelect) {
      setChecked(prev => {
        const next = new Set(prev)
        if (next.has(selected)) next.delete(selected)
        else next.add(selected)
        return next
      })
    } else if (key.escape) {
      if (multiSelect) onAnswer([])
      else onAnswer(options[options.length - 1].value)
    }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold> {question}</Text>
      <Box flexDirection="column">
        {options.map((opt, i) => {
          const indicator = multiSelect
            ? (checked.has(i) ? chalk.green('◉') : chalk.dim('○'))
            : ''
          const arrow = i === selected ? chalk.cyan('❯ ') : '  '
          const label = i === selected ? chalk.cyan.bold(opt.label) : chalk.dim(opt.label)
          return (
            <Text key={`${i}`}>
              {' '}{arrow}{indicator}{indicator ? ' ' : ''}{label}
            </Text>
          )
        })}
      </Box>
      <Text dimColor>
        {multiSelect ? ' Space to toggle · Enter to confirm · Esc to cancel' : ' Esc to cancel'}
      </Text>
    </Box>
  )
}
