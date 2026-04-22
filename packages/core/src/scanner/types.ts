// ============================================================
// Scanner Types
// ============================================================

/**
 * 扫描选项（简单扫描）
 */
export interface ScanOptions {
  /** 文件匹配模式（如 '*.md', '*.json'） */
  pattern: string;
  /** 是否递归扫描 */
  recursive?: boolean;
}

/**
 * 扫描配置（配置目录扫描）
 */
export interface ScanConfig {
  /** 扫描目录列表（相对或绝对路径） */
  dirs: string[];
  /** 文件匹配模式（如 '*.md', 'SKILL.md'） */
  filePattern: string;
  /** 目录名匹配模式（如 '*'，用于目录格式如 skill-name/SKILL.md） */
  dirPattern?: string;
  /** 是否递归扫描 */
  recursive?: boolean;
}

/**
 * 扫描结果
 */
export interface ScanResult {
  /** 文件绝对路径 */
  filePath: string;
  /** 文件所在目录 */
  dirPath: string;
  /** 来源标识 */
  source: 'user' | 'project';
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 缓存 TTL（毫秒），默认 60 秒 */
  ttlMs?: number;
  /** 最大缓存条目数 */
  maxEntries?: number;
}