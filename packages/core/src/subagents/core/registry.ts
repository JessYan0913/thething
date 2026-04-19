import type { AgentDefinition } from './types';

class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    this.agents.set(agent.agentType, agent);
  }

  get(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType);
  }

  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  has(agentType: string): boolean {
    return this.agents.has(agentType);
  }

  unregister(agentType: string): boolean {
    return this.agents.delete(agentType);
  }
}

export const globalAgentRegistry = new AgentRegistry();
