// ============================================================
// Agents Module - AppModule adapter for agents loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadAgents, type LoadAgentsOptions } from '../../../modules/agent/loader';
import type { AgentDefinition } from '../../../modules/agent/types';

export function createAgentsModule(loadOptions?: LoadAgentsOptions): AppModule<AgentDefinition[]> {
  let loadedAgents: AgentDefinition[] = [];

  return {
    name: 'agents',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadAgentsOptions = {
        cwd: context.cwd,
        configDir: context.configDir,
        homeDir: context.homeDir,
        dirs: context.resourceDirs.agents,
        ...loadOptions,
      };
      loadedAgents = await loadAgents(options);
    },

    snapshot(): AgentDefinition[] {
      return loadedAgents;
    },

    async dispose(): Promise<void> {
      loadedAgents = [];
    },
  };
}
