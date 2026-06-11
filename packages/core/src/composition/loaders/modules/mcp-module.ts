// ============================================================
// MCP Module - AppModule adapter for MCP loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadMcpServers, type LoadMcpsOptions } from '../../../modules/mcp/loader';
import type { McpServerConfig } from '../../../modules/mcp/types';

export function createMcpModule(loadOptions?: LoadMcpsOptions): AppModule<McpServerConfig[]> {
  let loadedMcps: McpServerConfig[] = [];

  return {
    name: 'mcps',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadMcpsOptions = {
        cwd: context.cwd,
        configDir: context.configDir,
        homeDir: context.homeDir,
        dirs: context.resourceDirs.mcps,
        ...loadOptions,
      };
      loadedMcps = await loadMcpServers(options);
    },

    snapshot(): McpServerConfig[] {
      return loadedMcps;
    },

    async dispose(): Promise<void> {
      loadedMcps = [];
    },
  };
}
