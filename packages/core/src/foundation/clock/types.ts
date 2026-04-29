// ============================================================
// Clock - 时间抽象接口
// ============================================================
//
// 用于时间依赖的可测试设计。
// 默认使用系统时间，测试时可注入固定或可控时钟。
// ============================================================

/**
 * Clock 抽象接口
 * 用于获取当前时间戳（毫秒）
 */
export interface Clock {
  /** 获取当前时间戳（毫秒） */
  now(): number;
}

/**
 * 系统时钟（默认实现）
 * 使用 Date.now() 返回真实系统时间
 */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * 固定时钟（用于测试）
 * 总是返回指定的固定时间戳
 *
 * @param timestamp - 固定时间戳（毫秒）
 *
 * @example
 * const clock = fixedClock(1700000000000);
 * clock.now(); // always returns 1700000000000
 */
export function fixedClock(timestamp: number): Clock {
  return {
    now: () => timestamp,
  };
}

/**
 * 偏移时钟（用于测试时间流逝）
 * 在基准时钟基础上增加固定偏移量
 *
 * @param base - 基准时钟
 * @param offsetMs - 偏移量（毫秒），可为负数
 *
 * @example
 * const clock = offsetClock(systemClock, -1000);
 * clock.now(); // returns Date.now() - 1000 (1 second ago)
 */
export function offsetClock(base: Clock, offsetMs: number): Clock {
  return {
    now: () => base.now() + offsetMs,
  };
}

/**
 * 可推进时钟（用于测试时间流逝）
 * 可以手动推进时间，模拟时间流逝
 *
 * @param initialMs - 初始时间戳（毫秒）
 *
 * @example
 * const clock = advancedClock(1700000000000);
 * clock.now(); // 1700000000000
 * clock.advance(1000);
 * clock.now(); // 1700000001000
 */
export function advancedClock(initialMs: number): Clock & { advance(ms: number): void } {
  let current = initialMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}