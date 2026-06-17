/**
 * 流管理器单例
 * 使用 @the-thing/resumable-stream 的新接口
 */

import { createResumableStreamContextFactory, MemoryPublisher, MemorySubscriber } from '@the-thing/resumable-stream';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

// 单例模式
let streamContext: ReturnType<ReturnType<typeof createResumableStreamContextFactory>> | null = null;

/**
 * 获取流管理器实例
 */
export function getStreamManager() {
  if (!streamContext) {
    const globalConfigDir = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething');

    // 创建内存事件发射器
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);

    // 创建内存版 Publisher 和 Subscriber
    const publisher = new MemoryPublisher(emitter);
    const subscriber = new MemorySubscriber(emitter);

    // 创建上下文
    const createContext = createResumableStreamContextFactory({
      subscriber: () => subscriber,
      publisher: () => publisher,
    });

    streamContext = createContext({
      waitUntil: (promise) => {
        // 在 Node.js 环境中，我们不需要特殊处理
        promise.catch(console.error);
      },
      database: {
        path: path.join(globalConfigDir, 'chat-streams.db'),
        defaultTtlMs: 24 * 60 * 60 * 1000, // 24 小时
        cleanupIntervalMs: 60 * 60 * 1000, // 1 小时
      },
    });
  }

  return streamContext;
}

/**
 * 关闭流管理器（用于优雅关闭）
 */
export function closeStreamManager() {
  if (streamContext) {
    streamContext.close();
    streamContext = null;
  }
}
