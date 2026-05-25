"use client";

/**
 * TodoDependencyTree - Visualize todo dependencies
 * 
 * Shows the dependency chain of todos in a tree structure.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Todo } from "@/lib/todos/types";
import { STATUS_CONFIG } from "@/lib/todos/types";

/**
 * TodoDependencyTree Props
 */
export interface TodoDependencyTreeProps {
  /** All todos */
  todos: Todo[];
  /** Root todo ID to start from */
  rootTodoId: string;
  /** Callback when a todo is clicked */
  onTodoClick?: (todo: Todo) => void;
  /** Show blocks (dependents) instead of blockedBy (dependencies) */
  showBlocks?: boolean;
  /** Class name */
  className?: string;
}

/**
 * TodoDependencyTree component
 */
export function TodoDependencyTree({
  todos,
  rootTodoId,
  onTodoClick,
  showBlocks = false,
  className,
}: TodoDependencyTreeProps) {
  const todoMap = React.useMemo(() => {
    const map = new Map<string, Todo>();
    for (const todo of todos) {
      map.set(todo.id, todo);
    }
    return map;
  }, [todos]);

  const rootTodo = todoMap.get(rootTodoId);
  if (!rootTodo) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        Todo {rootTodoId} not found
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {showBlocks
        ? renderBlockingTree(rootTodo, todoMap, onTodoClick, 0)
        : renderBlockedByTree(rootTodo, todoMap, onTodoClick, 0)}
    </div>
  );
}

/**
 * Render tree showing blockedBy (dependencies)
 */
function renderBlockedByTree(
  todo: Todo,
  todoMap: Map<string, Todo>,
  onTodoClick: ((todo: Todo) => void) | undefined,
  depth: number
): React.ReactNode {
  const blockedByTodos = todo.blockedBy
    .map((id) => todoMap.get(id))
    .filter((t): t is Todo => t !== undefined);

  return (
    <div key={todo.id} style={{ marginLeft: depth * 24 }}>
      <TodoTreeItem todo={todo} onClick={() => onTodoClick?.(todo)} />
      {blockedByTodos.map((dep) =>
        renderBlockedByTree(dep, todoMap, onTodoClick, depth + 1)
      )}
    </div>
  );
}

/**
 * Render tree showing blocks (dependents)
 */
function renderBlockingTree(
  todo: Todo,
  todoMap: Map<string, Todo>,
  onTodoClick: ((todo: Todo) => void) | undefined,
  depth: number
): React.ReactNode {
  const blockingTodos = todo.blocks
    .map((id) => todoMap.get(id))
    .filter((t): t is Todo => t !== undefined);

  return (
    <div key={todo.id} style={{ marginLeft: depth * 24 }}>
      <TodoTreeItem todo={todo} onClick={() => onTodoClick?.(todo)} />
      {blockingTodos.map((dep) =>
        renderBlockingTree(dep, todoMap, onTodoClick, depth + 1)
      )}
    </div>
  );
}

/**
 * TodoTreeItem Props
 */
interface TodoTreeItemProps {
  todo: Todo;
  onClick?: () => void;
}

/**
 * Single todo item in the tree
 */
function TodoTreeItem({ todo, onClick }: TodoTreeItemProps) {
  const config = STATUS_CONFIG[todo.status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted transition-colors",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <span className={cn("text-lg", config.color)}>{config.icon}</span>
      <span className="font-medium truncate">{todo.subject}</span>
      <span className="text-xs text-muted-foreground shrink-0">#{todo.id}</span>
      {todo.status === "in_progress" && todo.activeForm && (
        <span className="text-xs text-blue-500 truncate">({todo.activeForm})</span>
      )}
    </div>
  );
}

/**
 * TodoDependencyGraph - Shows full dependency graph
 * 
 * Renders all todos grouped by their dependency relationships.
 */
export interface TodoDependencyGraphProps {
  todos: Todo[];
  onTodoClick?: (todo: Todo) => void;
  className?: string;
}

export function TodoDependencyGraph({
  todos,
  onTodoClick,
  className,
}: TodoDependencyGraphProps) {
  // Find root todos (todos with no blockedBy)
  const rootTodos = React.useMemo(() => {
    return todos.filter((t) => t.blockedBy.length === 0);
  }, [todos]);

  // Find all orphan todos (todos that nothing depends on and they don't depend on anything)
  const orphanTodos = React.useMemo(() => {
    const blockingIds = new Set<string>();
    for (const todo of todos) {
      for (const depId of todo.blockedBy) {
        blockingIds.add(depId);
      }
    }
    return todos.filter(
      (t) =>
        t.blockedBy.length === 0 &&
        t.blocks.length === 0 &&
        !blockingIds.has(t.id)
    );
  }, [todos]);

  if (todos.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground p-4", className)}>
        No todos to display
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Independent todos */}
      {orphanTodos.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Independent Todos
          </h4>
          <div className="space-y-1">
            {orphanTodos.map((todo) => (
              <TodoTreeItem
                key={todo.id}
                todo={todo}
                onClick={() => onTodoClick?.(todo)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Todos with dependencies */}
      {rootTodos
        .filter((t) => t.blocks.length > 0)
        .map((todo) => (
          <div key={todo.id}>
            <h4 className="text-sm font-medium mb-2">Dependency Chain</h4>
            <TodoDependencyTree
              todos={todos}
              rootTodoId={todo.id}
              onTodoClick={onTodoClick}
            />
          </div>
        ))}
    </div>
  );
}

/**
 * TodoDependencySelector - Select dependencies when creating/editing a todo
 */
export interface TodoDependencySelectorProps {
  todos: Todo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  className?: string;
}

export function TodoDependencySelector({
  todos,
  selectedIds,
  onChange,
  excludeIds = [],
  className,
}: TodoDependencySelectorProps) {
  // Filter todos that can be selected (exclude self and descendants to avoid circular deps)
  const availableTodos = React.useMemo(() => {
    const excludeSet = new Set(excludeIds);

    // Also exclude descendants
    const collectDescendants = (todoId: string): Set<string> => {
      const descendants = new Set<string>();
      const todo = todos.find((t) => t.id === todoId);
      if (todo) {
        for (const blockId of todo.blocks) {
          if (!excludeSet.has(blockId)) {
            descendants.add(blockId);
            const subDescendants = collectDescendants(blockId);
            subDescendants.forEach((d) => descendants.add(d));
          }
        }
      }
      return descendants;
    };

    for (const excludeId of excludeIds) {
      const descendants = collectDescendants(excludeId);
      descendants.forEach((d) => excludeSet.add(d));
    }

    return todos.filter((t) => !excludeSet.has(t.id));
  }, [todos, excludeIds]);

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-sm font-medium">Dependencies</label>
      <div className="border rounded-lg p-2 space-y-1 max-h-64 overflow-y-auto">
        {availableTodos.map((todo) => (
          <label
            key={todo.id}
            className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(todo.id)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selectedIds, todo.id]);
                } else {
                  onChange(selectedIds.filter((id) => id !== todo.id));
                }
              }}
              className="rounded"
            />
            <span className="text-lg">{STATUS_CONFIG[todo.status].icon}</span>
            <span className="text-sm truncate flex-1">{todo.subject}</span>
            <span className="text-xs text-muted-foreground">#{todo.id}</span>
          </label>
        ))}
      </div>
      {selectedIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Selected: {selectedIds.join(", ")}
        </div>
      )}
    </div>
  );
}
