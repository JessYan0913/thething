/**
 * 内存版 Publisher 和 Subscriber
 * 用于替代 Redis 的 Pub/Sub 功能
 */

import { EventEmitter } from 'events';
import type { Publisher, Subscriber } from './types.js';

/**
 * 内存版发布者
 */
export class MemoryPublisher implements Publisher {
  private emitter: EventEmitter;
  private store = new Map<string, string>();
  private counters = new Map<string, number>();

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  async connect(): Promise<void> {
    // 内存版无需连接
  }

  async publish(channel: string, message: string): Promise<number> {
    this.emitter.emit(channel, message);
    return 1;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<"OK"> {
    this.store.set(key, value);

    // 如果设置了过期时间，设置定时器
    if (options?.EX) {
      setTimeout(() => {
        this.store.delete(key);
      }, options.EX * 1000);
    }

    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async incr(key: string): Promise<number> {
    const current = this.counters.get(key) ?? 0;
    const newValue = current + 1;
    this.counters.set(key, newValue);
    return newValue;
  }
}

/**
 * 内存版订阅者
 */
export class MemorySubscriber implements Subscriber {
  private emitter: EventEmitter;
  private subscriptions = new Map<string, (message: string) => void>();

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  async connect(): Promise<void> {
    // 内存版无需连接
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    this.subscriptions.set(channel, callback);
    this.emitter.on(channel, callback);
  }

  async unsubscribe(channel: string): Promise<void> {
    const callback = this.subscriptions.get(channel);
    if (callback) {
      this.emitter.off(channel, callback);
      this.subscriptions.delete(channel);
    }
  }
}
