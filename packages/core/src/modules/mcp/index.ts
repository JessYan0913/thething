// ============================================================
// MCP Module
// ============================================================

// Registry
export { McpRegistry, createMcpRegistry, type McpRegistryOptions } from './registry';

// OAuth
export {
  createMcpOAuthProvider,
  parseOAuthState,
  type McpOAuthProviderHandle,
  type McpOAuthProviderOptions,
} from './mcp-oauth';

// 从模块内部 loader 导出（消除 modules → composition 反向依赖）
export {
  loadMcpServers,
  loadMcpFile,
  scanMcpDirs,
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
  type McpOAuthConfig,
} from './types';

// Tool Wrapper
export {
  wrapMcpToolWithOutputHandler,
  wrapMcpToolsWithOutputHandler,
  processMcpToolResult,
  createRegistryBoundMcpTool,
  type McpToolWrapperOptions,
} from './tool-wrapper';