// ============================================================
// API Layer - 使用指南
// ============================================================
//
// 中层 API（单模块加载）：
// - loadSkills()      加载技能
// - loadMcpServers()  加载 MCP 服务器
// - loadConnectors()  加载 Connector
// - loadPermissions() 加载权限规则
// - loadMemory()      加载记忆
// - loadAll()         并行加载所有模块
//
// 高层 API（推荐）：
// - createAgent()     创建 Agent（一键启动）
// - createContext()   加载所有配置
//
// ============================================================

export {
  loadAll,
  loadSkills,
  loadAgents,
  loadMcpServers,
  loadConnectors,
  loadPermissions,
  loadMemory,
  clearAllCache,
  type LoadAllOptions,
  type LoadAllResult,
  type LoadSkillsOptions,
  type LoadAgentsOptions,
  type LoadMcpsOptions,
  type LoadConnectorsOptions,
  type LoadPermissionsOptions,
  type LoadMemoryOptions,
  type MemoryEntry,
} from './loaders';

export { createAgent, createContext } from './app';
export type {
  AppContext,
  CreateAgentOptions,
  CreateAgentResult,
  CreateContextOptions,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './app/types';