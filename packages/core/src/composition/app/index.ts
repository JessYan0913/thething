// ============================================================
// App Module - 应用层统一入口导出
// ============================================================

export { createContext } from './context';
export { createAgent } from './create';
export { resolveAgentConfig } from './resolve-agent-config';

// 向后兼容：createChatAgent 从 runtime/agent 导出
export { createChatAgent } from '../../modules/agent/create';

export type {
  AppContext,
  CreateContextOptions,
  CreateAgentOptions,
  CreateAgentResult,
  ModelConfig,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './types';

export type {
  ResolvedAgentConfig,
  AgentModules,
} from '../../modules/agent/types';
