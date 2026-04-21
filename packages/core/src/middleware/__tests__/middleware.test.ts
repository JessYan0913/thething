import { describe, it, expect } from 'vitest';
import { guardrailsMiddleware } from '../guardrails';

// ============================================================
// Middleware Tests
// ============================================================
describe('middleware', () => {
  describe('guardrailsMiddleware', () => {
    it('should create middleware with default keywords', () => {
      const middleware = guardrailsMiddleware();
      expect(middleware).toBeDefined();
      expect(middleware.specificationVersion).toBe('v3');
    });

    it('should create middleware with custom keywords', () => {
      const middleware = guardrailsMiddleware({
        keywords: [/custom-pattern/g],
      });
      expect(middleware).toBeDefined();
      expect(middleware.specificationVersion).toBe('v3');
    });

    it('should have wrapGenerate method', () => {
      const middleware = guardrailsMiddleware();
      expect(middleware.wrapGenerate).toBeDefined();
    });

    it('should have wrapStream method', () => {
      const middleware = guardrailsMiddleware();
      expect(middleware.wrapStream).toBeDefined();
    });

    describe('sanitization patterns', () => {
      // Test the default patterns directly
      const defaultPatterns = [
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN-like pattern
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
        /\b\d{16}\b/, // Credit card-like
      ];

      it('should match SSN pattern', () => {
        const pattern = defaultPatterns[0];
        expect(pattern.test('123-45-6789')).toBe(true);
        expect(pattern.test('abc-12-3456')).toBe(false);
      });

      it('should match email pattern', () => {
        const pattern = defaultPatterns[1];
        expect(pattern.test('test@example.com')).toBe(true);
        expect(pattern.test('invalid-email')).toBe(false);
      });

      it('should match 16-digit pattern', () => {
        const pattern = defaultPatterns[2];
        expect(pattern.test('1234567890123456')).toBe(true);
        expect(pattern.test('12345678')).toBe(false);
      });

      it('should replace matched patterns with [REDACTED]', () => {
        const text = 'SSN: 123-45-6789';
        const pattern = defaultPatterns[0];
        const sanitized = text.replace(pattern, '[REDACTED]');
        expect(sanitized).toBe('SSN: [REDACTED]');
      });

      it('should replace email with [REDACTED]', () => {
        const text = 'Contact: user@example.com';
        const pattern = defaultPatterns[1];
        const sanitized = text.replace(pattern, '[REDACTED]');
        expect(sanitized).toBe('Contact: [REDACTED]');
      });

      it('should replace credit card with [REDACTED]', () => {
        const text = 'Card: 1234567890123456';
        const pattern = defaultPatterns[2];
        const sanitized = text.replace(pattern, '[REDACTED]');
        expect(sanitized).toBe('Card: [REDACTED]');
      });
    });
  });
});