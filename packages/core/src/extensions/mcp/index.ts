// ============================================================
// MCP Module
// ============================================================

// Registry
export { McpRegistry, createMcpRegistry } from './registry';

// Loader（直接从 api/loaders 导出，移除中间 loader 代理层）
export {
  loadMcpServers,
  loadMcpFile,
  scanMcpDirs,
  clearMcpCache,
  clearMcpsCache,
  getAvailableMcpServers,
  MCP_LOADER_MODULE_VERSION,
  type LoadMcpsOptions,
} from '../../api/loaders/mcps';

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