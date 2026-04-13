import type { AgentDefinition, AgentExecutionContext } from '../core/types';

export function resolveToolsForAgent(
  definition: AgentDefinition,
  context: AgentExecutionContext,
): string[] | undefined {
  const { allowedTools, disallowedTools } = definition;

  if (!allowedTools?.length) {
    return undefined;
  }

  const availableToolNames = Object.keys(context.parentTools);
  const filtered = availableToolNames.filter((name) => {
    if (!allowedTools.includes(name) && !allowedTools.includes('*')) {
      return false;
    }
    if (disallowedTools?.includes(name)) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : undefined;
}
