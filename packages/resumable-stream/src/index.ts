/**
 * @the-thing/resumable-stream
 *
 * 基于 SQLite + 内存的可恢复流实现
 * 与 vercel/resumable-stream 接口兼容
 */

// 导出类型
export type {
  Publisher,
  Subscriber,
  CreateResumableStreamContextOptions,
  ResumableStreamContext,
  StreamChunk,
  StreamStatus,
  Stream,
  StreamData,
  DatabaseConfig,
  StreamManagerOptions,
  CreateStreamOptions,
  StreamEvent,
} from './types.js';

// 导出内存版 Pub/Sub
export { MemoryPublisher, MemorySubscriber } from './memory-pubsub.js';

// 导出数据库类
export { StreamDatabase } from './database.js';

// 导出核心函数
export { createResumableStreamContextFactory } from './resumable-stream.js';

// 导入核心函数
import { createResumableStreamContextFactory } from './resumable-stream.js';
import { MemoryPublisher, MemorySubscriber } from './memory-pubsub.js';
import { EventEmitter } from 'events';
import type { DatabaseConfig } from './types.js';

/**
 * 创建默认的内存版 Publisher 和 Subscriber
 */
function createDefaultMemoryClients() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  return {
    subscriber: () => new MemorySubscriber(emitter),
    publisher: () => new MemoryPublisher(emitter),
  };
}

/**
 * 创建可恢复流上下文的便捷函数
 * 与 vercel/resumable-stream 的 createResumableStreamContext 接口兼容
 */
export const createResumableStreamContext = createResumableStreamContextFactory(
  createDefaultMemoryClients()
);

/**
 * 默认配置
 */
export const defaultConfig: DatabaseConfig = {
  path: './resumable-streams.db',
  defaultTtlMs: 24 * 60 * 60 * 1000, // 24 小时
  cleanupIntervalMs: 60 * 60 * 1000, // 1 小时
};
