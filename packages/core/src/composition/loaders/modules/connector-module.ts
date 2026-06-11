// ============================================================
// Connector Module - AppModule adapter for connector loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadConnectors, type LoadConnectorsOptions } from '../../../modules/connector/loader-internal';
import type { ConnectorFrontmatter } from '../../../modules/connector/loader';

export function createConnectorModule(loadOptions?: LoadConnectorsOptions): AppModule<ConnectorFrontmatter[]> {
  let loadedConnectors: ConnectorFrontmatter[] = [];

  return {
    name: 'connectors',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadConnectorsOptions = {
        cwd: context.cwd,
        configDir: context.configDir,
        homeDir: context.homeDir,
        dirs: context.resourceDirs.connectors,
        env: context.env,
        ...loadOptions,
      };
      loadedConnectors = await loadConnectors(options);
    },

    snapshot(): ConnectorFrontmatter[] {
      return loadedConnectors;
    },

    async dispose(): Promise<void> {
      loadedConnectors = [];
    },
  };
}
