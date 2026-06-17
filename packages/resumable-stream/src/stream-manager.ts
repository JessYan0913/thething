import { EventEmitter } from 'events';
import { StreamDatabase } from './database.js';
import type {
  Stream,
  StreamChunk,
  StreamData,
  StreamManagerOptions,
  CreateStreamOptions,
  StreamEvent,
} from './types.js';

/**
 * 流管理器 - 提供完整的可恢复流功能
 * 基于内存 Pub/Sub + SQLite 持久化
 * 实现类似 vercel/resumable-stream 的懒缓冲策略
 */
export class StreamManager {
  private db: StreamDatabase;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Array<(event: StreamEvent) => void> = [];
  private logger: (message: string, ...args: any[]) => void;

  // 内存 Pub/Sub 机制
  private emitter = new EventEmitter();

  // 流缓冲区：streamId -> chunks[]
  private streamBuffers = new Map<string, string[]>();

  // 流监听者：streamId -> Set<listenerId>
  private streamListeners = new Map<string, Set<string>>();

  // 流完成标记
  private streamDone = new Set<string>();

  // 监听者回调：listenerId -> callback
  private listenerCallbacks = new Map<string, (chunk: string) => void>();

  // 监听者完成回调：listenerId -> callback
  private listenerDoneCallbacks = new Map<string, () => void>();

  constructor(options: StreamManagerOptions) {
    this.db = new StreamDatabase(options.database);
    this.logger = options.logger ?? console.log;

    // 增加 EventEmitter 的监听器限制
    this.emitter.setMaxListeners(100);

    if (options.autoCleanup !== false) {
      this.startCleanup(options.database.cleanupIntervalMs);
    }
  }

  /**
   * 启动定期清理
   */
  private startCleanup(intervalMs: number = 60 * 60 * 1000): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      const count = this.db.cleanupExpiredStreams();
      if (count > 0) {
        this.logger(`Cleaned up ${count} expired streams`);
        this.emit({ type: 'cleaned_up', count });
      }
    }, intervalMs);
  }

  /**
   * 停止定期清理
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 注册事件处理器
   */
  onEvent(handler: (event: StreamEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit(event: StreamEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger('Event handler error:', error);
      }
    }
  }

  /**
   * 创建新流
   */
  createStream(options: CreateStreamOptions): Stream {
    const stream = this.db.createStream(options.chatId, options.ttlMs);
    this.logger(`Created stream ${stream.id} for chat ${options.chatId}`);
    this.emit({ type: 'created', streamId: stream.id, chatId: options.chatId });

    // 初始化缓冲区
    this.streamBuffers.set(stream.id, []);
    this.streamListeners.set(stream.id, new Set());

    return stream;
  }

  /**
   * 获取流信息
   */
  getStream(streamId: string): Stream | null {
    return this.db.getStream(streamId);
  }

  /**
   * 获取流数据（包含所有数据块）
   */
  getStreamData(streamId: string): StreamData | null {
    return this.db.getStreamData(streamId);
  }

  /**
   * 从指定序号恢复流
   * @param streamId 流 ID
   * @param fromSequence 起始序号（不含），不提供则从头开始
   * @returns 流数据块列表
   */
  resumeStream(streamId: string, fromSequence?: number): StreamChunk[] | null {
    const stream = this.db.getStream(streamId);
    if (!stream) {
      this.logger(`Stream ${streamId} not found`);
      return null;
    }

    if (stream.status !== 'active') {
      this.logger(`Stream ${streamId} is not active (status: ${stream.status})`);
      return null;
    }

    const chunks = this.db.getStreamChunks(streamId, fromSequence);
    const from = fromSequence ?? 0;
    this.logger(`Resumed stream ${streamId} from sequence ${from}, got ${chunks.length} chunks`);
    this.emit({ type: 'resumed', streamId, fromSequence: from });

    return chunks;
  }

  /**
   * 添加数据块到流
   */
  addChunk(streamId: string, chunk: Omit<StreamChunk, 'sequence'>): StreamChunk | null {
    const result = this.db.addChunk(streamId, chunk);
    if (result) {
      this.emit({ type: 'chunk_added', streamId, sequence: result.sequence });

      // 广播给所有监听者
      this.broadcastToListeners(streamId, JSON.stringify(chunk));
    }
    return result;
  }

  /**
   * 批量添加数据块
   */
  addChunks(streamId: string, chunks: Array<Omit<StreamChunk, 'sequence'>>): StreamChunk[] {
    const results: StreamChunk[] = [];
    for (const chunk of chunks) {
      const result = this.addChunk(streamId, chunk);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  /**
   * 完成流
   */
  completeStream(streamId: string): boolean {
    const success = this.db.completeStream(streamId);
    if (success) {
      this.logger(`Completed stream ${streamId}`);
      this.emit({ type: 'completed', streamId });

      // 标记流完成并通知所有监听者
      this.streamDone.add(streamId);
      this.notifyStreamDone(streamId);
    }
    return success;
  }

  /**
   * 停止流
   */
  stopStream(streamId: string): boolean {
    const success = this.db.stopStream(streamId);
    if (success) {
      this.logger(`Stopped stream ${streamId}`);
      this.emit({ type: 'stopped', streamId });

      // 标记流停止并通知所有监听者
      this.streamDone.add(streamId);
      this.notifyStreamDone(streamId);
    }
    return success;
  }

  /**
   * 获取聊天的所有活跃流
   */
  getActiveStreamsByChatId(chatId: string): Stream[] {
    return this.db.getActiveStreamsByChatId(chatId);
  }

  /**
   * 删除流
   */
  deleteStream(streamId: string): boolean {
    this.streamDone.add(streamId);
    this.notifyStreamDone(streamId);
    this.streamBuffers.delete(streamId);
    this.streamListeners.delete(streamId);
    return this.db.deleteStream(streamId);
  }

  /**
   * 手动清理过期流
   */
  cleanup(): number {
    const count = this.db.cleanupExpiredStreams();
    if (count > 0) {
      this.logger(`Manually cleaned up ${count} expired streams`);
      this.emit({ type: 'cleaned_up', count });
    }
    return count;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.db.getStats();
  }

  /**
   * 创建可恢复的 ReadableStream
   * 这是一个便捷方法，用于创建可以直接返回给客户端的流
   */
  createResumableReadableStream(
    streamId: string,
    options: {
      fromSequence?: number;
      onChunk?: (chunk: StreamChunk) => void;
      onComplete?: () => void;
      onError?: (error: Error) => void;
    } = {}
  ): ReadableStream<StreamChunk> {
    const { fromSequence, onChunk, onComplete, onError } = options;

    return new ReadableStream<StreamChunk>({
      start: async (controller) => {
        try {
          const chunks = this.resumeStream(streamId, fromSequence);
          if (!chunks) {
            controller.close();
            onComplete?.();
            return;
          }

          for (const chunk of chunks) {
            controller.enqueue(chunk);
            onChunk?.(chunk);
          }

          controller.close();
          onComplete?.();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          controller.error(err);
          onError?.(err);
        }
      },
    });
  }

  /**
   * 创建 SSE 格式的可恢复流
   * 用于直接返回给客户端的 SSE 响应
   */
  createResumableSSEStream(
    streamId: string,
    options: {
      fromSequence?: number;
      encoder?: InstanceType<typeof TextEncoder>;
    } = {}
  ): ReadableStream<Uint8Array> {
    const encoder = options.encoder ?? new TextEncoder();

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          const chunks = this.resumeStream(streamId, options.fromSequence);
          if (!chunks) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }

          for (const chunk of chunks) {
            const sseData = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          const errorChunk = {
            type: 'error' as const,
            data: { message: error instanceof Error ? error.message : String(error) },
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
          controller.close();
        }
      },
    });
  }

  /**
   * 订阅流的实时更新
   * 类似于 vercel/resumable-stream 的 resumeStream
   *
   * @param streamId 流 ID
   * @param listenerId 监听者 ID（唯一标识）
   * @param fromSequence 从指定序号开始（用于增量恢复）
   * @returns 可读流，用于接收数据
   */
  subscribeToStream(
    streamId: string,
    listenerId: string,
    options: {
      fromSequence?: number;
      onChunk?: (chunk: string) => void;
      onDone?: () => void;
      onError?: (error: Error) => void;
    } = {}
  ): ReadableStream<string> | null {
    const { fromSequence, onChunk, onDone, onError } = options;

    // 检查流是否存在
    const stream = this.db.getStream(streamId);
    if (!stream) {
      this.logger(`Stream ${streamId} not found`);
      return null;
    }

    // 如果流已完成，返回空流
    if (stream.status !== 'active') {
      this.logger(`Stream ${streamId} is not active (status: ${stream.status})`);
      return null;
    }

    // 注册监听者
    if (!this.streamListeners.has(streamId)) {
      this.streamListeners.set(streamId, new Set());
    }
    this.streamListeners.get(streamId)!.add(listenerId);

    // 获取已缓冲的数据
    const bufferedChunks = this.streamBuffers.get(streamId) || [];
    const startIndex = fromSequence ?? 0;

    // 创建可读流
    return new ReadableStream<string>({
      start: async (controller) => {
        try {
          // 发送已缓冲的数据
          for (let i = startIndex; i < bufferedChunks.length; i++) {
            controller.enqueue(bufferedChunks[i]);
            onChunk?.(bufferedChunks[i]);
          }

          // 如果流已完成，关闭流
          if (this.streamDone.has(streamId)) {
            controller.close();
            onDone?.();
            return;
          }

          // 注册回调，接收后续数据
          this.listenerCallbacks.set(listenerId, (chunk: string) => {
            try {
              controller.enqueue(chunk);
              onChunk?.(chunk);
            } catch (error) {
              // 流可能已关闭
            }
          });

          // 注册完成回调
          this.listenerDoneCallbacks.set(listenerId, () => {
            try {
              controller.close();
              onDone?.();
            } catch (error) {
              // 流可能已关闭
            }
          });

          // 监听流事件
          const chunkHandler = (event: { streamId: string; data: string }) => {
            if (event.streamId === streamId) {
              const callback = this.listenerCallbacks.get(listenerId);
              if (callback) {
                callback(event.data);
              }
            }
          };

          const doneHandler = (event: { streamId: string }) => {
            if (event.streamId === streamId) {
              const callback = this.listenerDoneCallbacks.get(listenerId);
              if (callback) {
                callback();
              }
              // 清理
              this.emitter.off('stream_chunk', chunkHandler);
              this.emitter.off('stream_done', doneHandler);
              this.listenerCallbacks.delete(listenerId);
              this.listenerDoneCallbacks.delete(listenerId);
            }
          };

          this.emitter.on('stream_chunk', chunkHandler);
          this.emitter.on('stream_done', doneHandler);

        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          controller.error(err);
          onError?.(err);
        }
      },
    });
  }

  /**
   * 广播数据给所有监听者
   */
  private broadcastToListeners(streamId: string, data: string): void {
    const listeners = this.streamListeners.get(streamId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    // 缓冲数据
    if (!this.streamBuffers.has(streamId)) {
      this.streamBuffers.set(streamId, []);
    }
    this.streamBuffers.get(streamId)!.push(data);

    // 通知所有监听者
    this.emitter.emit('stream_chunk', { streamId, data });
  }

  /**
   * 通知所有监听者流已完成
   */
  private notifyStreamDone(streamId: string): void {
    this.emitter.emit('stream_done', { streamId });

    // 清理监听者
    this.streamListeners.delete(streamId);
    this.streamBuffers.delete(streamId);
  }

  /**
   * 关闭管理器
   */
  close(): void {
    this.stopCleanup();
    this.db.close();
    this.emitter.removeAllListeners();
    this.streamBuffers.clear();
    this.streamListeners.clear();
    this.streamDone.clear();
    this.listenerCallbacks.clear();
    this.listenerDoneCallbacks.clear();
    this.logger('Stream manager closed');
  }
}
