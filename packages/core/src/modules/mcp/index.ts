// ============================================================
// MCP Module
// ============================================================

// Registry
export { McpRegistry, createMcpRegistry } from './registry';

// 从模块内部 loader 导出（消除 modules → composition 反向依赖）
export {
  loadMcpServers,
  loadMcpFile,
  scanMcpDirs,
  clearMcpCache,
  clearMcpsCache,
  getAvailableMcpServers,
  MCP_LOADER_MODULE_VERSION,
  type LoadMcpsOptions,
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