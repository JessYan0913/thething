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
  // MCP Apps types
  type MCPAppMetadata,
  type MCPAppSandboxConfig,
  type MCPAppBridgeHandlers,
  // ext-apps re-exports — 统一入口，避免下游直接依赖 @modelcontextprotocol/ext-apps
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  getToolUiResourceUri,
  AppBridge,
  registerAppTool,
  registerAppResource,
} from './types';

// Re-export MCP App types and helpers from @ai-sdk/mcp (避免下游直接依赖)
export { readMCPAppResource, splitMCPAppTools, type MCPAppResource, mcpAppClientCapabilities } from '@ai-sdk/mcp';

// Tool Wrapper
export {
  wrapMcpToolWithOutputHandler,
  wrapMcpToolsWithOutputHandler,
  wrapMcpAppTool,
  processMcpToolResult,
  type McpToolWrapperOptions,
  type McpAppToolWrapperOptions,
} from './tool-wrapper';