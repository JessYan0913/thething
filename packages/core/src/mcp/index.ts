// ============================================================
// MCP Module
// ============================================================

// Registry
export { McpRegistry, createMcpRegistry } from './registry';

// Loader
export {
  scanMcpDirs,
  loadMcpConfig,
  clearMcpCache,
  getAvailableMcpServers,
  MCP_LOADER_MODULE_VERSION,
} from './loader';

// Config Store (CRUD)
export {
  getMcpServerConfigs,
  getMcpServerConfig,
  getMcpServerConfigsWithSource,
  getMcpServerConfigWithSource,
  addMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  getUserMcpConfigDir,
  getProjectMcpConfigDir,
} from './mcp-config-store';

// Types
export {
  McpServerConfigSchema,
  DEFAULT_MCP_LOADER_CONFIG,
  type McpServerConfig,
  type McpServerConfigSource,
  type McpClientConnection,
  type McpRegistrySnapshot,
  type McpTransportType,
  type McpLoaderConfig,
} from './types';

// Tool Wrapper
export {
  wrapMcpToolWithOutputHandler,
  wrapMcpToolsWithOutputHandler,
  processMcpToolResult,
  type McpToolWrapperOptions,
} from './tool-wrapper';