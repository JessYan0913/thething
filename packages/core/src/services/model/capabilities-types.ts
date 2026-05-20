// ============================================================
// Model Capabilities Types
// ============================================================

export interface ModelCapabilities {
  /** 上下文窗口限制（tokens） */
  contextLimit: number;
  /** 默认输出预留（tokens） */
  defaultOutputTokens: number;
}