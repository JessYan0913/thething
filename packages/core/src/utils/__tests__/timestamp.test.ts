import { describe, test, expect } from 'vitest';
import { formatTimestamp } from '../timestamp';

describe('formatTimestamp', () => {
  test('格式化为 YYYY-MM-DD HH:mm:ss（本地时区）', () => {
    // 用本地时区分量构造 Date，避免测试受运行环境时区影响
    const d = new Date(2024, 0, 5, 13, 7, 9); // 2024-01-05 13:07:09 本地时间
    expect(formatTimestamp(d.getTime())).toBe('2024-01-05 13:07:09');
  });

  test('月、日、时、分、秒不足两位时补零', () => {
    const d = new Date(2024, 9, 2, 3, 4, 5); // 2024-10-02 03:04:05 本地时间
    expect(formatTimestamp(d.getTime())).toBe('2024-10-02 03:04:05');
  });

  test('处理 Unix 纪元 0', () => {
    // 在部分时区纪元对应 1969-12-31，故期望值按本地分量计算
    const d = new Date(0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    expect(formatTimestamp(0)).toBe(expected);
  });
});

import { parseTimestamp } from '../timestamp';

describe('parseTimestamp', () => {
  test('按本地时区解析 YYYY-MM-DD HH:mm:ss', () => {
    const expected = new Date(2024, 0, 5, 13, 7, 9).getTime(); // 本地时间分量
    expect(parseTimestamp('2024-01-05 13:07:09')).toBe(expected);
  });

  test('与 formatTimestamp 互为逆运算（round-trip）', () => {
    const d = new Date(2024, 9, 2, 3, 4, 5);
    const s = formatTimestamp(d.getTime());
    expect(parseTimestamp(s)).toBe(d.getTime());
  });

  test('容忍首尾空白', () => {
    expect(parseTimestamp('  2024-01-05 13:07:09  ')).toBe(
      new Date(2024, 0, 5, 13, 7, 9).getTime(),
    );
  });

  test('格式非法时抛出错误', () => {
    expect(() => parseTimestamp('2024/01/05 13:07:09')).toThrow(
      /无效的时间格式/,
    );
    expect(() => parseTimestamp('2024-01-05')).toThrow(/无效的时间格式/);
    expect(() => parseTimestamp('2024-01-05 13:07')).toThrow(/无效的时间格式/);
  });
});
