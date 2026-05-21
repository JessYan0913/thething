// Re-export todo types from @the-thing/core
export type { Todo, TodoStatus, TodoStore, TodoCreateInput, TodoUpdateInput } from '@the-thing/core'
export { STATUS_CONFIG } from '@the-thing/core'

import type { TodoStatus } from '@the-thing/core'

/** Tailwind CSS styles mapped from STATUS_CONFIG.level */
export const STATUS_STYLES: Record<TodoStatus, { color: string; animation?: string }> = {
  pending: { color: 'text-gray-400' },
  in_progress: { color: 'text-blue-500', animation: 'animate-spin' },
  completed: { color: 'text-green-500' },
  failed: { color: 'text-red-500' },
  cancelled: { color: 'text-gray-400' },
}