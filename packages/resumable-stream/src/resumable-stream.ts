/**
 * 可恢复流上下文实现
 * 与 vercel/resumable-stream 接口兼容，使用 SQLite + 内存替代 Redis
 */

import { EventEmitter } from 'events';
import { StreamDatabase } from './database.js';
import { MemoryPublisher, MemorySubscriber } from './memory-pubsub.js';
import type {
  Publisher,
  Subscriber,
  CreateResumableStreamContextOptions,
  ResumableStreamContext,
  DatabaseConfig,
} from './types.js';

// 常量
const DONE_MESSAGE = "\n\n\n\nDONE_SENTINEL_hasdfasudfyge374%$%^$EDSATRTYFtydryrte\n";
const DONE_VALUE = "DONE";

/**
 * 创建可恢复流上下文
 */
export function createResumableStreamContextFactory(_defaults: {
  subscriber: () => Subscriber;
  publisher: () => Publisher;
}) {
  return function createResumableStreamContext(
    options: CreateResumableStreamContextOptions & {
      database?: DatabaseConfig;
    }
  ): ResumableStreamContext & { close: () => void } {
    const waitUntil = options.waitUntil || (async (p) => await p);
    const keyPrefix = options.keyPrefix || "resumable-stream";

    // 创建内存事件发射器
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);

    // 创建或使用提供的 publisher/subscriber
    let publisher: Publisher;
    let subscriber: Subscriber;
    let database: StreamDatabase | null = null;

    if (options.publisher && options.subscriber) {
      publisher = options.publisher;
      subscriber = options.subscriber;
    } else {
      // 使用内存版本
      publisher = new MemoryPublisher(emitter);
      subscriber = new MemorySubscriber(emitter);
    }

    // 如果提供了数据库配置，创建 SQLite 数据库
    if (options.database) {
      database = new StreamDatabase(options.database);
    }

    let initPromises: Promise<unknown>[] = [];

    // 初始化连接
    initPromises.push(publisher.connect());
    initPromises.push(subscriber.connect());

    const ctx = {
      keyPrefix,
      waitUntil,
      subscriber,
      publisher,
      database,
    };

    // 跟踪进行中的流及其中止控制器
    const activeStreams = new Map<string, AbortController>();

    const stopStream = async (streamId: string): Promise<void> => {
      const controller = activeStreams.get(streamId);
      if (!controller) {
        // 没有活跃句柄，但确保 sentinel 标记为完成，避免新 listener 无限等待
        await ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, DONE_VALUE, {
          EX: 24 * 60 * 60,
        });
        return;
      }

      controller.abort();
      activeStreams.delete(streamId);
    };

    return {
      /**
       * 恢复已存在的流
       */
      resumeExistingStream: async (
        streamId: string,
        skipCharacters?: number,
        skipChunks?: number
      ): Promise<ReadableStream<string> | null | undefined> => {
        await Promise.all(initPromises);

        const state = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
        if (state === null) {
          return undefined;
        }
        if (state === DONE_VALUE) {
          return null;
        }

        return resumeStream(ctx, streamId, skipCharacters, skipChunks);
      },

      /**
       * 创建新流
       */
      createNewResumableStream: async (
        streamId: string,
        makeStream: () => ReadableStream<string>,
        _skipCharacters?: number
      ): Promise<ReadableStream<string> | null> => {
        await Promise.all(initPromises);

        // 设置 sentinel 标记
        await ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, "1", {
          EX: 24 * 60 * 60, // 24 小时过期
        });

        const abortController = new AbortController();
        activeStreams.set(streamId, abortController);

        return createNewResumableStream(ctx, streamId, makeStream, abortController, () =>
          activeStreams.delete(streamId)
        );
      },

      /**
       * 幂等 API：创建或恢复流
       */
      resumableStream: async (
        streamId: string,
        makeStream: () => ReadableStream<string>,
        skipCharacters?: number
      ): Promise<ReadableStream<string> | null> => {
        await Promise.all(initPromises);

        const currentListenerCount = await incrOrDone(
          ctx.publisher,
          `${ctx.keyPrefix}:sentinel:${streamId}`
        );

        if (currentListenerCount === DONE_VALUE) {
          return null;
        }
        if (currentListenerCount > 1) {
          return resumeStream(ctx, streamId, skipCharacters);
        }

        const abortController = new AbortController();
        activeStreams.set(streamId, abortController);

        return createNewResumableStream(ctx, streamId, makeStream, abortController, () =>
          activeStreams.delete(streamId)
        );
      },

      /**
       * 检查流是否存在
       */
      hasExistingStream: async (streamId: string): Promise<null | true | "DONE"> => {
        await Promise.all(initPromises);

        const state = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
        if (state === null) {
          return null;
        }
        if (state === DONE_VALUE) {
          return DONE_VALUE;
        }
        return true;
      },

      /**
       * 停止正在运行的流
       */
      stopStream,

      /**
       * 关闭上下文
       */
      close: () => {
        for (const controller of activeStreams.values()) {
          controller.abort();
        }
        activeStreams.clear();
        emitter.removeAllListeners();
        if (database) {
          database.close();
        }
      },
    };
  };
}

/**
 * 创建新流
 */
async function createNewResumableStream(
  ctx: {
    keyPrefix: string;
    waitUntil: (promise: Promise<unknown>) => void;
    subscriber: Subscriber;
    publisher: Publisher;
  },
  streamId: string,
  makeStream: () => ReadableStream<string>,
  abortController: AbortController,
  onDone: () => void
): Promise<ReadableStream<string> | null> {
  const chunks: string[] = [];
  let listenerChannels: string[] = [];
  let streamDoneResolver: () => void;

  // 等待流完成的 Promise
  ctx.waitUntil(
    new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    })
  );

  let isDone = false;
  let cleanedUp = false;

  // 订阅请求频道
  await ctx.subscriber.subscribe(
    `${ctx.keyPrefix}:request:${streamId}`,
    async (message: string) => {
      const parsedMessage = JSON.parse(message) as {
        listenerId: string;
        skipCharacters?: number;
        skipChunks?: number;
      };

      console.log("Connected to listener", parsedMessage.listenerId);
      listenerChannels.push(parsedMessage.listenerId);

      const promises: Promise<unknown>[] = [];

      // 发送历史数据：每个 chunk 独立发送，以便接收端能逐 event 处理
      // （例如 SSE 要求每个 data 行是一个完整 JSON 对象）
      const skipChunks = parsedMessage.skipChunks ?? 0;

      // 优先使用 skipChunks，否则使用 skipCharacters
      let startIndex = skipChunks;

      // 如果使用 skipCharacters，需要转换为 chunk 索引
      if (parsedMessage.skipCharacters && parsedMessage.skipCharacters > 0 && skipChunks === 0) {
        const skipCharacters = parsedMessage.skipCharacters;
        let remaining = Math.max(0, skipCharacters);
        startIndex = 0;
        let firstChunkOffset = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunkLength = chunks[i].length;
          if (remaining === 0) {
            startIndex = i;
            firstChunkOffset = 0;
            break;
          }
          if (remaining < chunkLength) {
            startIndex = i;
            firstChunkOffset = remaining;
            remaining = 0;
            break;
          }
          remaining -= chunkLength;
          startIndex = i + 1;
        }

        // 发送第一个被部分跳过的 chunk
        if (startIndex < chunks.length && firstChunkOffset > 0) {
          promises.push(
            ctx.publisher.publish(
              `${ctx.keyPrefix}:chunk:${parsedMessage.listenerId}`,
              chunks[startIndex].slice(firstChunkOffset)
            )
          );
          startIndex++;
        }
      }

      // 发送剩余的完整 chunks
      for (let i = startIndex; i < chunks.length; i++) {
        promises.push(
          ctx.publisher.publish(
            `${ctx.keyPrefix}:chunk:${parsedMessage.listenerId}`,
            chunks[i]
          )
        );
      }

      // 如果流已完成，发送完成信号
      if (isDone) {
        promises.push(
          ctx.publisher.publish(
            `${ctx.keyPrefix}:chunk:${parsedMessage.listenerId}`,
            DONE_MESSAGE
          )
        );
      }

      await Promise.all(promises);
    }
  );

  return new ReadableStream<string>({
    start(controller) {
      const stream = makeStream();
      const reader = stream.getReader();

      const cleanup = async () => {
        if (cleanedUp) return;
        cleanedUp = true;
        isDone = true;
        console.log("Stream done or stopped");

        try {
          controller.close();
        } catch (e) { /* ignore */ }

        onDone();

        const promises: Promise<unknown>[] = [];

        // 标记流完成
        promises.push(
          ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, DONE_VALUE, {
            EX: 24 * 60 * 60,
          })
        );

        // 取消订阅
        promises.push(
          ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:request:${streamId}`)
        );

        // 通知所有监听者流已完成
        for (const listenerId of listenerChannels) {
          promises.push(
            ctx.publisher.publish(
              `${ctx.keyPrefix}:chunk:${listenerId}`,
              DONE_MESSAGE
            )
          );
        }

        await Promise.all(promises);
        streamDoneResolver?.();
        console.log("Cleanup done");
      };

      // 监听中止信号
      abortController.signal.addEventListener("abort", () => {
        reader.cancel().catch(() => { /* ignore */ });
        cleanup();
      }, { once: true });

      let retryCount = 0;
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 100;

      function read() {
        if (cleanedUp) return;

        reader.read().then(async ({ done, value }) => {
          retryCount = 0; // 成功读取，重置重试计数

          if (done || cleanedUp) {
            await cleanup();
            return;
          }

          // 缓冲数据
          chunks.push(value);

          try {
            controller.enqueue(value);
          } catch (e) { /* stream already closed, continue */ }

          // 广播给所有监听者
          const promises: Promise<unknown>[] = [];
          for (const listenerId of listenerChannels) {
            promises.push(
              ctx.publisher.publish(
                `${ctx.keyPrefix}:chunk:${listenerId}`,
                value
              )
            );
          }
          await Promise.all(promises);

          read();
        }).catch(async (err) => {
          // 如果是 abort 导致的错误，直接清理
          if (abortController.signal.aborted) {
            await cleanup();
            return;
          }

          // 瞬态错误：重试
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.warn(`[ResumableStream] Read error (retry ${retryCount}/${MAX_RETRIES}):`, err?.message);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * retryCount));
            read();
            return;
          }

          // 超过重试次数，关闭流
          console.error(`[ResumableStream] Read error (max retries exceeded):`, err?.message);
          await cleanup();
        });
      }

      read();
    },
  });
}

/**
 * 恢复流
 */
async function resumeStream(
  ctx: {
    keyPrefix: string;
    subscriber: Subscriber;
    publisher: Publisher;
  },
  streamId: string,
  skipCharacters?: number,
  skipChunks?: number
): Promise<ReadableStream<string> | null> {
  const listenerId = crypto.randomUUID();

  return new Promise<ReadableStream<string> | null>((resolve, reject) => {
    const readableStream = new ReadableStream<string>({
      async start(controller) {
        try {
          const cleanup = async () => {
            await ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:chunk:${listenerId}`);
          };

          const start = Date.now();
          const timeout = setTimeout(async () => {
            await cleanup();
            const val = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
            if (val === DONE_VALUE) {
              resolve(null);
            }
            if (Date.now() - start > 1000) {
              controller.error(new Error("Timeout waiting for ack"));
              reject(new Error("Timeout waiting for ack"));
            }
          }, 1000);

          // 订阅专属频道
          await ctx.subscriber.subscribe(
            `${ctx.keyPrefix}:chunk:${listenerId}`,
            async (message: string) => {
              clearTimeout(timeout);
              resolve(readableStream);

              if (message === DONE_MESSAGE) {
                try {
                  controller.close();
                } catch (e) { /* ignore */ }
                await cleanup();
                return;
              }

              try {
                controller.enqueue(message);
              } catch (e) { /* ignore */ }
            }
          );

          // 向生产者发送请求
          await ctx.publisher.publish(
            `${ctx.keyPrefix}:request:${streamId}`,
            JSON.stringify({ listenerId, skipCharacters, skipChunks })
          );
        } catch (e) {
          reject(e);
        }
      },
    });
  });
}

/**
 * 增加计数或返回 DONE
 */
async function incrOrDone(publisher: Publisher, key: string): Promise<typeof DONE_VALUE | number> {
  return publisher.incr(key).catch((reason) => {
    const errorString = String(reason);
    if (errorString.includes("ERR value is not an integer or out of range")) {
      return DONE_VALUE;
    }
    throw reason;
  });
}
