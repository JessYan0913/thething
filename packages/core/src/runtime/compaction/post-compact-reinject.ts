import type { UIMessage } from "ai";
import { estimateMessagesTokens, estimateTextTokens } from "./token-counter";
import { DEFAULT_POST_COMPACT_CONFIG, type PostCompactConfig } from "./types";

export interface ReinjectContext {
  recentlyReadFiles: Array<{ path: string; content: string }>;
  activeSkills: Array<{ name: string; instructions: string }>;
  thingMdContent?: string;
  mcpToolResults?: Array<{ tool: string; result: string }>;
}

/**
 * Re-inject critical context after compaction within the token budget.
 * Inserts a system message with recently read files and active skills
 * right after the summary message, before the boundary marker.
 */
export async function reinjectAfterCompact(
  messages: UIMessage[],
  context: ReinjectContext,
  config?: PostCompactConfig,
): Promise<UIMessage[]> {
  const resolvedConfig = { ...DEFAULT_POST_COMPACT_CONFIG, ...config };

  const currentTokens = await estimateMessagesTokens(messages);
  const remainingBudget = resolvedConfig.totalBudget - currentTokens;

  if (remainingBudget <= 0) {
    console.log(
      `[Post-Compact] No remaining budget (${currentTokens} tokens), skipping reinjection`
    );
    return messages;
  }

  const reinjectParts: Array<{ type: "text"; text: string }> = [];
  let usedTokens = 0;

  // 1. Restore recently read files (most recent first)
  const filesToRestore = context.recentlyReadFiles.slice(0, resolvedConfig.maxFilesToRestore);
  for (const file of filesToRestore) {
    const truncated = truncateToTokens(file.content, resolvedConfig.maxTokensPerFile);
    const tokenCost = await estimateTextTokens(truncated);

    if (usedTokens + tokenCost > remainingBudget) break;

    reinjectParts.push({
      type: "text",
      text: `[Recently read file: ${file.path}]\n${truncated}\n[End of file]`,
    });
    usedTokens += tokenCost;
  }

  // 2. Restore active skill instructions
  if (context.activeSkills.length > 0) {
    const skillBudget = Math.min(
      resolvedConfig.skillsTokenBudget,
      remainingBudget - usedTokens
    );
    const tokenPerSkill = skillBudget / context.activeSkills.length;

    for (const skill of context.activeSkills) {
      const truncated = truncateToTokens(skill.instructions, Math.min(tokenPerSkill, resolvedConfig.maxTokensPerSkill));
      const tokenCost = await estimateTextTokens(truncated);

      if (usedTokens + tokenCost > remainingBudget) break;

      reinjectParts.push({
        type: "text",
        text: `[Active skill: ${skill.name}]\n${truncated}\n[End of skill]`,
      });
      usedTokens += tokenCost;
    }
  }

  // 3. Restore THING.md if available
  if (context.thingMdContent && usedTokens < remainingBudget) {
    const truncated = truncateToTokens(context.thingMdContent, resolvedConfig.maxTokensPerFile);
    const tokenCost = await estimateTextTokens(truncated);

    if (usedTokens + tokenCost <= remainingBudget) {
      reinjectParts.push({
        type: "text",
        text: `[Project context: THING.md]\n${truncated}\n[End of project context]`,
      });
      usedTokens += tokenCost;
    }
  }

  if (reinjectParts.length === 0) {
    return messages;
  }

  const injectMessage: UIMessage = {
    id: `reinject-${Date.now()}`,
    role: "system",
    parts: reinjectParts,
  };

  // Insert after the summary message, before the boundary marker
  const result = [...messages];
  const summaryIndex = result.findIndex(
    (m) =>
      m.role === "system" &&
      m.parts.some(
        (p) =>
          p.type === "text" &&
          typeof p.text === "string" &&
          p.text.includes("[Previous conversation summary]")
      )
  );

  if (summaryIndex >= 0) {
    result.splice(summaryIndex + 1, 0, injectMessage);
  } else {
    result.unshift(injectMessage);
  }

  console.log(
    `[Post-Compact] Reinjected ${reinjectParts.length} parts, ${usedTokens} tokens, remaining budget: ${remainingBudget - usedTokens}`
  );

  return result;
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + "\n...[truncated for context budget]";
}