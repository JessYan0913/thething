import { useCallback, useMemo } from 'react'
import chalk from 'chalk'
import type { UseConversationResult } from './useConversation.js'
import type { CommandResult } from '../lib/types.js'
import type { GoalState } from '@the-thing/core'

interface SlashCommandOptions {
  conversation: UseConversationResult
  setModel: (model: string) => void
  currentModel: string
  onExit: () => void
  goalState: GoalState | null
  setGoalState: (goal: GoalState | null) => void
}

interface CommandDef {
  name: string
  aliases?: string[]
  description: string
}

const COMMANDS: CommandDef[] = [
  { name: '/help', description: 'Show commands' },
  { name: '/exit', aliases: ['/quit'], description: 'Exit the CLI' },
  { name: '/clear', description: 'Clear conversation' },
  { name: '/model', description: 'Switch model (/model <name>)' },
  { name: '/list', aliases: ['/conversations'], description: 'List conversations' },
  { name: '/resume', description: 'Resume conversation (/resume <n|id>)' },
  { name: '/rename', description: 'Rename conversation (/rename <title>)' },
  { name: '/delete', description: 'Delete conversation (/delete <n|id>)' },
  { name: '/new', description: 'Start new conversation' },
  { name: '/history', description: 'Show recent messages' },
  { name: '/goal', description: 'Set/view goal (/goal <objective>)' },
  { name: '/goal pause', description: 'Pause active goal' },
  { name: '/goal resume', description: 'Resume paused goal' },
  { name: '/goal continue', description: 'Continue after max turns' },
  { name: '/goal complete', description: 'Mark goal as complete' },
  { name: '/goal clear', description: 'Clear active goal' },
]

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function useSlashCommands(opts: SlashCommandOptions) {
  const { conversation, setModel, currentModel, onExit, goalState, setGoalState } = opts
  let lastConversationList: ReturnType<typeof conversation.listConversations> = []

  const handleCommand = useCallback(async (input: string): Promise<CommandResult> => {
    const parts = input.trim().split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (cmd) {
      case '/help':
        return {
          type: 'handled',
          output: COMMANDS.map(c =>
            `  ${chalk.cyan(c.name.padEnd(16))} ${chalk.dim(c.description)}`
          ).join('\n'),
        }

      case '/exit':
      case '/quit':
        onExit()
        return { type: 'exit' }

      case '/clear':
        conversation.clearMessages()
        return { type: 'handled', output: chalk.dim('Conversation cleared.') }

      case '/model':
        if (!args) {
          return { type: 'handled', output: `Current model: ${chalk.cyan(currentModel)}` }
        }
        setModel(args)
        return { type: 'handled', output: `Model switched to ${chalk.cyan(args)}` }

      case '/list':
      case '/conversations': {
        const convos = conversation.listConversations()
        lastConversationList = convos
        if (convos.length === 0) {
          return { type: 'handled', output: chalk.dim('No conversations yet.') }
        }
        const lines = convos.slice(0, 20).map((c, i) => {
          const current = c.id === conversation.conversationId ? chalk.green(' ●') : '  '
          const time = formatRelativeTime(c.updatedAt)
          return `${current} ${chalk.dim(`${i + 1}.`)} ${c.title || chalk.dim('(untitled)')} ${chalk.dim(time)}`
        })
        return { type: 'handled', output: lines.join('\n') }
      }

      case '/resume': {
        if (!args) {
          return { type: 'handled', output: chalk.yellow('Usage: /resume <number|id>') }
        }
        const num = parseInt(args, 10)
        let targetId: string
        if (!isNaN(num) && num >= 1 && num <= lastConversationList.length) {
          targetId = lastConversationList[num - 1].id
        } else {
          targetId = args
        }
        const ok = conversation.resumeConversation(targetId)
        if (!ok) {
          return { type: 'handled', output: chalk.red('Conversation not found.') }
        }
        const msgs = conversation.messages
        const preview = msgs.slice(-3).map(m => {
          const role = m.role === 'user' ? chalk.cyan('You') : chalk.green('AI')
          const text = String((m.parts?.[0] as any)?.text || '').slice(0, 60)
          return `  ${role}: ${text}`
        }).join('\n')
        return {
          type: 'handled',
          output: `Resumed conversation (${msgs.length} messages)\n${preview}`,
        }
      }

      case '/rename': {
        if (!args) {
          return { type: 'handled', output: chalk.yellow('Usage: /rename <title>') }
        }
        conversation.renameConversation(args)
        return { type: 'handled', output: `Renamed to: ${chalk.cyan(args)}` }
      }

      case '/delete': {
        if (!args) {
          return { type: 'handled', output: chalk.yellow('Usage: /delete <number|id>') }
        }
        const dnum = parseInt(args, 10)
        let did: string
        if (!isNaN(dnum) && dnum >= 1 && dnum <= lastConversationList.length) {
          did = lastConversationList[dnum - 1].id
        } else {
          did = args
        }
        const ok = conversation.deleteConversation(did)
        return {
          type: 'handled',
          output: ok ? chalk.dim('Deleted.') : chalk.red('Not found.'),
        }
      }

      case '/new':
        conversation.newConversation()
        return { type: 'handled', output: chalk.dim('New conversation started.') }

      case '/history': {
        const msgs = conversation.messages
        if (msgs.length === 0) {
          return { type: 'handled', output: chalk.dim('No messages yet.') }
        }
        const lines = msgs.slice(-5).map(m => {
          const role = m.role === 'user' ? chalk.cyan('You') : chalk.green('AI')
          const text = String((m.parts?.[0] as any)?.text || '').slice(0, 80)
          return `  ${role}: ${text}`
        })
        return { type: 'handled', output: lines.join('\n') }
      }

      case '/goal': {
        const goalArgs = args.trim().toLowerCase()

        // /goal 或 /goal status
        if (!goalArgs || goalArgs === 'status') {
          if (!goalState) {
            return { type: 'handled', output: chalk.dim('No active goal. Set one with /goal <objective>.') }
          }
          const statusColor = goalState.status === 'active' ? chalk.green
            : goalState.status === 'paused' ? chalk.yellow
            : goalState.status === 'complete' ? chalk.blue
            : chalk.red
          const lines = [
            `Goal: ${goalState.objective}`,
            `Status: ${statusColor(goalState.status)}`,
            `Turns: ${goalState.turnsExecuted}`,
            `Tokens: ${goalState.tokensUsed}`,
          ]
          if (goalState.status === 'max_turns') {
            lines.push(chalk.dim(`Hint: Run /goal continue to reset and continue.`))
          }
          return { type: 'handled', output: lines.join('\n') }
        }

        // /goal clear
        if (goalArgs === 'clear') {
          if (!goalState) {
            return { type: 'handled', output: chalk.dim('No active goal to clear.') }
          }
          setGoalState(null)
          return { type: 'handled', output: chalk.dim('Goal cleared.') }
        }

        // /goal pause
        if (goalArgs === 'pause') {
          if (!goalState || goalState.status !== 'active') {
            return { type: 'handled', output: chalk.dim('No active goal to pause.') }
          }
          setGoalState({ ...goalState, status: 'paused', updatedAt: Date.now() })
          return { type: 'handled', output: chalk.dim('Goal paused.') }
        }

        // /goal resume
        if (goalArgs === 'resume') {
          if (!goalState || goalState.status !== 'paused') {
            return { type: 'handled', output: chalk.dim('No paused goal to resume.') }
          }
          setGoalState({ ...goalState, status: 'active', updatedAt: Date.now() })
          return { type: 'handled', output: chalk.dim('Goal resumed.'), shouldQuery: true }
        }

        // /goal continue
        if (goalArgs === 'continue') {
          if (!goalState || goalState.status !== 'max_turns') {
            return { type: 'handled', output: chalk.dim('Current goal is not in max-turns state.') }
          }
          setGoalState({ ...goalState, status: 'active', turnsExecuted: 0, updatedAt: Date.now() })
          return { type: 'handled', output: chalk.dim('Goal continuation counter reset. Continuing...'), shouldQuery: true }
        }

        // /goal complete
        if (goalArgs === 'complete') {
          if (!goalState) {
            return { type: 'handled', output: chalk.dim('No active goal to complete.') }
          }
          setGoalState({ ...goalState, status: 'complete', updatedAt: Date.now() })
          return { type: 'handled', output: chalk.dim('Goal marked complete.') }
        }

        // /goal <objective> - 设置新目标
        const objective = args.trim()
        if (objective.length > 4000) {
          return { type: 'handled', output: chalk.red(`Goal too long (${objective.length} chars; limit 4000).`) }
        }

        const newGoal: GoalState = {
          id: crypto.randomUUID(),
          objective,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turnsExecuted: 1,
          tokensUsed: 0,
          tokenBudget: null,
          blockedCount: 0,
        }
        setGoalState(newGoal)
        return { type: 'handled', output: chalk.green('Goal set.'), shouldQuery: true }
      }

      default:
        return { type: 'unknown', output: chalk.yellow(`Unknown command: ${cmd}`) }
    }
  }, [conversation, currentModel, setModel, onExit])

  const availableCommands = useMemo(() => COMMANDS, [])

  return { handleCommand, availableCommands }
}
