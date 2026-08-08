import { tool } from 'ai';
import { z } from 'zod';
import type { TodoStore } from '../types';
import { createTodo } from '../todo-create';

/**
 * TodoBatchCreateTool - Create multiple todos at once with dependency declarations
 *
 * Key design:
 * - `dependsOnSteps` uses 1-based index referring to positions in the `tasks` array
 * - Only forward references are allowed (elements must be < current index)
 * - Tasks are created in order, so later tasks can reference earlier ones
 * - Returns minimal info (id/subject/status) to save token context
 *
 * @example
 * ```typescript
 * todo_create_batch({
 *   tasks: [
 *     { subject: "Read requirements" },            // index 1
 *     { subject: "Design API", dependsOnSteps: [1] },  // index 2, depends on step 1
 *     { subject: "Implement", dependsOnSteps: [1, 2] }, // index 3, depends on steps 1+2
 *   ]
 * })
 * ```
 */
const BatchTaskSchema = z.object({
  /** Task title in imperative form (e.g., "Implement /export endpoint") */
  subject: z.string().min(1).describe('Task title'),
  /** 1-based index of steps this task depends on within this batch. Must be < current position. */
  dependsOnSteps: z.array(z.number().int().min(1)).optional()
    .describe('1-based indices of steps this task depends on'),
  /** 完成标准（可执行的验证方式） */
  verify: z.string().optional()
    .describe('How to verify this task is done — an executable check where possible (e.g. "npx vitest run src/utils passes")'),
});

export const todoBatchCreateToolSchema = z.object({
  /** Array of tasks to create */
  tasks: z.array(BatchTaskSchema).min(1).max(20)
    .describe('Tasks to create (1-20). Order matters: dependsOnSteps references 1-based positions in this array.'),
});

export type TodoBatchCreateToolInput = z.infer<typeof todoBatchCreateToolSchema>;

export type TodoBatchCreateToolOutput = {
  success: true;
  created: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
  total: number;
} | {
  success: false;
  error: string;
};

/**
 * Validate dependsOnSteps references:
 * - Must be valid 1-based indices within the tasks array
 * - Must only reference earlier tasks (no forward references)
 * - Must not reference itself
 */
function validateDependsOnSteps(
  tasks: Array<{ subject: string; dependsOnSteps?: number[] }>,
): string | null {
  for (let i = 0; i < tasks.length; i++) {
    const deps = tasks[i].dependsOnSteps;
    if (!deps || deps.length === 0) continue;

    const currentIndex = i + 1; // 1-based

    for (const dep of deps) {
      if (dep < 1 || dep > tasks.length) {
        return `Task ${currentIndex} ("${tasks[i].subject}"): dependsOnSteps[${dep}] is out of range (1-${tasks.length})`;
      }
      if (dep >= currentIndex) {
        return `Task ${currentIndex} ("${tasks[i].subject}"): dependsOnSteps[${dep}] is a forward reference. Only earlier tasks (1-${currentIndex - 1}) can be referenced.`;
      }
    }
  }
  return null;
}

/**
 * Shared tool description (single source — both factory variants use it).
 */
const TODO_BATCH_CREATE_DESCRIPTION = `Create multiple todos at once with dependency declarations. Use this to plan and track complex multi-step work.

IMPORTANT:
- Tasks are created in order. dependsOnSteps uses 1-based indices referring to positions in the tasks array.
- Example: task at index 1, task at index 2 with dependsOnSteps: [1] means task 2 depends on task 1.
- Only forward references are allowed (can only depend on earlier tasks).
- After creating tasks, use todo_write (full list with ids) to update their status as you work through them.
- When delegating to a sub-agent, pass the todo's id as the todoId parameter of the agent tool.

For very simple work (1-2 steps), just use the tools directly without creating tasks.`;

/**
 * Shared execute implementation for both factory variants.
 */
async function executeBatchCreate(
  store: TodoStore,
  conversationId: string,
  input: TodoBatchCreateToolInput,
): Promise<TodoBatchCreateToolOutput> {
  try {
    // Validate dependency references
    const validationError = validateDependsOnSteps(input.tasks);
    if (validationError) {
      return {
        success: false as const,
        error: validationError,
      };
    }

    const created: Array<{ id: string; subject: string; status: string }> = [];

    for (let i = 0; i < input.tasks.length; i++) {
      const task = input.tasks[i];
      const blockedBy: string[] = [];

      // Resolve dependsOnSteps (1-based) to actual todo IDs
      if (task.dependsOnSteps) {
        for (const step of task.dependsOnSteps) {
          const depIndex = step - 1; // convert to 0-based
          if (depIndex < created.length) {
            blockedBy.push(created[depIndex].id);
          }
        }
      }

      const todo = createTodo(store, {
        conversationId,
        subject: task.subject,
        blockedBy,
        ...(task.verify ? { metadata: { verify: task.verify } } : {}),
      });

      created.push({
        id: todo.id,
        subject: todo.subject,
        status: todo.status,
      });
    }

    return {
      success: true as const,
      created,
      total: created.length,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create a TodoBatchCreateTool
 *
 * @param store - The todo store
 * @returns The tool definition
 */
export function createTodoBatchCreateTool(store: TodoStore) {
  return tool({
    description: TODO_BATCH_CREATE_DESCRIPTION,
    inputSchema: todoBatchCreateToolSchema,
    execute: (input: TodoBatchCreateToolInput) => executeBatchCreate(store, 'default', input),
  });
}

/**
 * Create a TodoBatchCreateTool bound to a conversation
 *
 * @param store - The todo store
 * @param conversationId - The conversation ID to associate todos with
 * @returns The tool definition
 */
export function createTodoBatchCreateToolForConversation(store: TodoStore, conversationId: string) {
  return tool({
    description: TODO_BATCH_CREATE_DESCRIPTION,
    inputSchema: todoBatchCreateToolSchema,
    execute: (input: TodoBatchCreateToolInput) => executeBatchCreate(store, conversationId, input),
  });
}