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

// ============================================================
// Abort Controller Registry
// 用于将 stopStream 与 abortController.abort() 连接起来，
// 确保点击停止按钮时能真正终止服务端的 LLM 调用和 bash 进程。
// ============================================================

const abortControllers = new Map<string, AbortController>();

/**
 * 注册 AbortController，关联到 conversationId
 */
export function registerAbortController(chatId: string, controller: AbortController) {
  abortControllers.set(chatId, controller);
}

/**
 * 移除 AbortController（流正常结束时调用）
 */
export function unregisterAbortController(chatId: string) {
  abortControllers.delete(chatId);
}

/**
 * 中止指定会话的执行（触发 abort signal）
 * @returns true 如果找到了并中止了对应的 controller
 */
export function abortChat(chatId: string): boolean {
  const controller = abortControllers.get(chatId);
  if (controller) {
    controller.abort();
    abortControllers.delete(chatId);
    return true;
  }
  return false;
}

/**
 * 获取流管理器实例
 */
export function getStreamManager() {
  if (!streamContext) {
    // 运行时数据库路径（留在 .thething/ 下，非协议配置）
    const runtimeDataBase = path.join(os.homedir(), '.thething');

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
        path: path.join(runtimeDataBase, 'chat-streams.db'),
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
