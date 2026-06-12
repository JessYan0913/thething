// ============================================================
// Connectors Loader - 基于 MultiSourceConfigLoader
// ============================================================

import { parsePlainYamlFile } from '../../primitives/parser';
import { createMultiSourceLoader } from '../../services/scanner/multi-source-loader';
import type { ConnectorFrontmatter } from './loader';
import { ConnectorFrontmatterSchema } from './loader';
import type { ConfigSource } from '../../primitives/constants';
import { resolveConnectorVars } from './var-resolver';

// ============================================================
// 扩展类型
// ============================================================

interface ConnectorWithSource extends ConnectorFrontmatter {
  source: ConfigSource;
  filePath: string;
}

// ============================================================
// MultiSource Loader
// ============================================================

const connectorsLoader = createMultiSourceLoader<ConnectorWithSource>({
  subcategory: 'connectors',
  filePattern: '*.yaml',
  filePatterns: ['*.yaml', '*.yml'],
  parse: async (filePath, source) => {
    const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
    const processed = resolveConnectorVars(result.data as Record<string, unknown>);

    return {
      ...processed as ConnectorFrontmatter,
      source,
      filePath: result.filePath,
    };
  },
  getMergeKey: (item) => item.id,
});

// ============================================================
// Public API
// ============================================================

export interface LoadConnectorsOptions {
  cwd?: string;
  sources?: ConfigSource[];
  dirs?: readonly string[];
  configDir?: string;
  homeDir?: string;
}

export async function loadConnectors(options?: LoadConnectorsOptions): Promise<ConnectorFrontmatter[]> {
  const items = await connectorsLoader.load({
    cwd: options?.cwd,
    configDir: options?.configDir,
    homeDir: options?.homeDir,
    dirs: options?.dirs,
  });

  return items.map((c) => ({
    id: c.id,
    name: c.name,
    version: c.version,
    description: c.description,
    enabled: c.enabled,
    variables: c.variables,
    inbound: c.inbound,
    auth: c.auth,
    custom_settings: c.custom_settings,
    base_url: c.base_url,
    tools: c.tools,
    sourcePath: c.filePath,
  }));
}

export async function loadConnectorFile(
  filePath: string,
  source: ConfigSource,
): Promise<ConnectorWithSource> {
  const result = await parsePlainYamlFile(filePath, ConnectorFrontmatterSchema);
  const processed = resolveConnectorVars(result.data as Record<string, unknown>);

  return {
    ...processed as ConnectorFrontmatter,
    source,
    filePath: result.filePath,
  };
}
