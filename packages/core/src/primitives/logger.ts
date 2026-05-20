// ============================================================
// Logger - 条件日志工具
// ============================================================
// Core 作为库不应直接 console.log。
// 使用此 logger 统一日志输出，仅在 debugEnabled 时输出。

let _debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  _debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
  return _debugEnabled;
}

export const logger = {
  debug(tag: string, message: string, data?: unknown): void {
    if (_debugEnabled) {
      console.log(`[${tag}] ${message}`, data ?? '');
    }
  },
  warn(tag: string, message: string, data?: unknown): void {
    console.warn(`[${tag}] ${message}`, data ?? '');
  },
  error(tag: string, message: string, data?: unknown): void {
    console.error(`[${tag}] ${message}`, data ?? '');
  },
};
