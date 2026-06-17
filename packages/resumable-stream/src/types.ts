/**
 * 类型定义 - 与 vercel/resumable-stream 接口兼容
 */

/**
 * 发布者接口
 */
export interface Publisher {
  connect: () => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<number | unknown>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<"OK" | unknown>;
  get: (key: string) => Promise<string | number | null>;
  incr: (key: string) => Promise<number>;
}

/**
 * 订阅者接口
 */
export interface Subscriber {
  connect: () => Promise<unknown>;
  subscribe: (channel: string, callback: (message: string) => void) => Promise<void | number>;
  unsubscribe: (channel: string) => Promise<unknown>;
}

/**
 * 创建上下文选项
 */
export interface CreateResumableStreamContextOptions {
  keyPrefix?: string;
  waitUntil: ((promise: Promise<unknown>) => void) | null;
  subscriber?: Subscriber;
  publisher?: Publisher;
}

/**
 * 可恢复流上下文
 */
export interface ResumableStreamContext {
  /**
   * 幂等 API：创建或恢复流
   * @param streamId 流 ID
   * @param makeStream 创建流的工厂函数
   * @param skipCharacters 跳过的字符数（已弃用，使用 skipChunks）
   * @returns 可读流，如果流已完成返回 null
   */
  resumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number
  ) => Promise<ReadableStream<string> | null>;

  /**
   * 恢复已存在的流
   * @param streamId 流 ID
   * @param skipCharacters 跳过的字符数（已弃用，使用 skipChunks）
   * @param skipChunks 跳过的 chunk 数
   * @returns 可读流，如果流不存在返回 undefined，如果已完成返回 null
   */
  resumeExistingStream: (
    streamId: string,
    skipCharacters?: number,
    skipChunks?: number
  ) => Promise<ReadableStream<string> | null | undefined>;

  /**
   * 创建新流
   * @param streamId 流 ID
   * @param makeStream 创建流的工厂函数
   * @param skipCharacters 跳过的字符数（已弃用，使用 skipChunks）
   * @returns 可读流，如果流已完成返回 null
   */
  createNewResumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number
  ) => Promise<ReadableStream<string> | null>;

  /**
   * 检查流是否存在
   * @param streamId 流 ID
   * @returns null: 不存在, true: 存在/进行中, "DONE": 已完成
   */
  hasExistingStream: (
    streamId: string
  ) => Promise<null | true | "DONE">;

  /**
   * 停止正在运行的流
   * @param streamId 流 ID
   */
  stopStream: (streamId: string) => Promise<void>;
}

/**
 * 流数据块
 */
export interface StreamChunk {
  type: 'text' | 'metadata' | 'error' | 'done';
  data: any;
  timestamp: number;
  sequence: number;
}

/**
 * 流状态
 */
export type StreamStatus = 'active' | 'completed' | 'stopped' | 'expired';

/**
 * 流信息
 */
export interface Stream {
  id: string;
  chatId: string;
  status: StreamStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * 流数据（包含所有数据块）
 */
export interface StreamData extends Stream {
  chunks: StreamChunk[];
}

/**
 * 数据库配置
 */
export interface DatabaseConfig {
  path: string;
  defaultTtlMs?: number;
  cleanupIntervalMs?: number;
}

/**
 * 流管理器选项
 */
export interface StreamManagerOptions {
  database: DatabaseConfig;
  autoCleanup?: boolean;
  logger?: (message: string, ...args: any[]) => void;
}

/**
 * 创建流选项
 */
export interface CreateStreamOptions {
  chatId: string;
  ttlMs?: number;
}

/**
 * 流事件
 */
export type StreamEvent =
  | { type: 'created'; streamId: string; chatId: string }
  | { type: 'chunk_added'; streamId: string; sequence: number }
  | { type: 'completed'; streamId: string }
  | { type: 'stopped'; streamId: string }
  | { type: 'resumed'; streamId: string; fromSequence: number }
  | { type: 'expired'; streamId: string }
  | { type: 'cleaned_up'; count: number };
