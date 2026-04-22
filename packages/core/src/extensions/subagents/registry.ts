import type { AgentDefinition } from './types';

/**
 * Agent 注册表
 *
 * 管理所有已注册的 Agent 定义，包括内置、用户自定义、项目级 Agent。
 */
class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  /**
   * 注册 Agent
   */
  register(agent: AgentDefinition): void {
    this.agents.set(agent.agentType, agent);
  }

  /**
   * 获取 Agent 定义
   */
  get(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType);
  }

  /**
   * 获取所有 Agent
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * 检查 Agent 是否存在
   */
  has(agentType: string): boolean {
    return this.agents.has(agentType);
  }

  /**
   * 移除 Agent
   */
  unregister(agentType: string): boolean {
    return this.agents.delete(agentType);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * 获取注册表大小
   */
  size(): number {
    return this.agents.size;
  }

  /**
   * 按来源获取 Agent
   */
  getBySource(source: string): AgentDefinition[] {
    return this.getAll().filter(a => a.source === source);
  }

  /**
   * 获取 Agent 名称列表
   */
  getNames(): string[] {
    return Array.from(this.agents.keys());
  }
}

/**
 * 全局 Agent 注册表实例
 */
export const globalAgentRegistry = new AgentRegistry();