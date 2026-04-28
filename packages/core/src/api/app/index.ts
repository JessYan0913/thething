// ============================================================
// App Module - 应用层统一入口导出
// ============================================================

export { createContext } from './context';
export { createAgent } from './create';

// 向后兼容：createChatAgent 从 runtime/agent 导出
export { createChatAgent } from '../../runtime/agent/create';

export type {
  AppContext,
  CreateContextOptions,
  CreateAgentOptions,
  CreateAgentResult,
  ModelConfig,
  ReloadOptions,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './types';