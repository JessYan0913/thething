import { describe, it, expect } from 'vitest';
import { estimateTaskComplexity, getRecommendedModel } from '../task-complexity';
import type { ModelMessage } from 'ai';

describe('Task Complexity Estimator', () => {
  describe('estimateTaskComplexity', () => {
    it('returns 0 for empty messages', () => {
      expect(estimateTaskComplexity([])).toBe(0);
    });

    it('returns low score for simple short message', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '你好' },
      ];
      const score = estimateTaskComplexity(messages);
      expect(score).toBeLessThan(30);
    });

    it('returns higher score for long message', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '请帮我完成一个非常复杂的任务，需要重构整个认证系统，包括用户登录、注册、密码重置、OAuth集成等功能，并且需要编写完整的测试用例，同时还要处理各种边界情况和异常情况，确保系统的稳定性和安全性，以及性能优化和代码质量提升' },
      ];
      const score = estimateTaskComplexity(messages);
      expect(score).toBeGreaterThan(10);
    });

    it('returns higher score for code content', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '请帮我修复这个函数：\n```typescript\nfunction calculateTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n```\n需要处理空数组和无效输入的情况' },
      ];
      const score = estimateTaskComplexity(messages);
      expect(score).toBeGreaterThan(20);
    });

    it('returns higher score for multi-step request', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '首先帮我读取这个文件，然后修改配置，接着运行测试，最后提交代码' },
      ];
      const score = estimateTaskComplexity(messages);
      expect(score).toBeGreaterThan(15);
    });

    it('returns higher score for file operations', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '请读取 src/config.ts 文件，然后写入到 dist/config.js' },
      ];
      const score = estimateTaskComplexity(messages);
      expect(score).toBeGreaterThan(20);
    });

    it('uses custom weights when provided', () => {
      const messages: ModelMessage[] = [
        { role: 'user', content: '请帮我完成这个任务' },
      ];
      const scoreWithCustomWeights = estimateTaskComplexity(messages, {
        weights: { messageLength: 1.0, toolCalls: 0, codeContent: 0, multiStep: 0, fileOperations: 0 },
      });
      const scoreDefault = estimateTaskComplexity(messages);
      expect(scoreWithCustomWeights).toBeDefined();
      expect(scoreDefault).toBeDefined();
    });
  });

  describe('getRecommendedModel', () => {
    it('returns "fast" for low complexity', () => {
      expect(getRecommendedModel(0)).toBe('fast');
      expect(getRecommendedModel(29)).toBe('fast');
    });

    it('returns "default" for medium complexity', () => {
      expect(getRecommendedModel(30)).toBe('default');
      expect(getRecommendedModel(69)).toBe('default');
    });

    it('returns "smart" for high complexity', () => {
      expect(getRecommendedModel(70)).toBe('smart');
      expect(getRecommendedModel(100)).toBe('smart');
    });
  });
});
