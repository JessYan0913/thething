import { describe, test, expect } from 'vitest';
import { add, multiply } from '../math';

describe('add', () => {
  test('两个正数相加', () => {
    expect(add(1, 2)).toBe(3);
  });

  test('处理负数', () => {
    expect(add(-5, 3)).toBe(-2);
  });

  test('处理小数', () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
  });

  test('处理零', () => {
    expect(add(0, 0)).toBe(0);
  });
});

describe('multiply', () => {
  test('两个正数相乘', () => {
    expect(multiply(3, 4)).toBe(12);
  });

  test('处理负数', () => {
    expect(multiply(-2, 5)).toBe(-10);
  });

  test('与零相乘', () => {
    expect(multiply(7, 0)).toBe(0);
  });

  test('处理小数', () => {
    expect(multiply(0.5, 0.5)).toBeCloseTo(0.25);
  });
});
