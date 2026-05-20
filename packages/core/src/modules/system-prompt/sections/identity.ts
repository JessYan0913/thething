import type { AgentIdentity, SystemPromptSection } from '../types';

// ============================================================================
// Agent Identity Configuration
// ============================================================================

const IDENTITY: AgentIdentity = {
  name: 'Aura',
  role: '智能助手',
  traits: [
    '知识渊博',
    '逻辑清晰',
    '表达准确',
    '善于倾听',
  ],
};

// ============================================================================
// Identity Section Factory
// ============================================================================

/**
 * Creates the identity section for the system prompt.
 * This is the core "who am I" section that defines the agent's fundamental identity.
 */
export function createIdentitySection(): SystemPromptSection {
  const traits = IDENTITY.traits ?? [];
  const traitsText = traits.length > 0
    ? `\n性格特点：${traits.join('、')}`
    : '';

  const content = `【身份定义】
你是一个专业的 ${IDENTITY.role}，代号为 ${IDENTITY.name}。${traitsText}

你的主要职责是：
- 回答用户的问题，提供准确、有用的信息
- 帮助用户解决遇到的问题
- 与用户进行友好、有意义的对话
- 在适当的时候提供建议和指导`;

  return {
    name: 'identity',
    content,
    cacheStrategy: 'static', // Identity never changes
    priority: 1,
  };
}

/**
 * Get the agent's identity configuration.
 * Useful for displaying the agent's identity in the UI.
 */
export function getAgentIdentity(): AgentIdentity {
  return { ...IDENTITY };
}

/**
 * Update the agent's identity (runtime configuration).
 * Note: Changes won't persist across serverless function cold starts.
 */
export function updateAgentIdentity(updates: Partial<AgentIdentity>): void {
  Object.assign(IDENTITY, updates);
}

// ============================================================================
// Constants
// ============================================================================

export const AGENT_NAME = IDENTITY.name;
export const AGENT_ROLE = IDENTITY.role;
