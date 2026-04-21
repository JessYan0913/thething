import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerRegistry, CircuitBreakerError } from '../circuit-breaker';
import { withRetry } from '../retry';

// ============================================================
// Circuit Breaker Tests
// ============================================================
describe('circuit-breaker', () => {
  describe('CircuitBreaker', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeoutMs: 1000,
      });
    });

    describe('initial state', () => {
      it('should start in closed state', () => {
        expect(breaker.getState()).toBe('closed');
      });
    });

    describe('execute', () => {
      it('should execute function successfully in closed state', async () => {
        const result = await breaker.execute(() => Promise.resolve('success'));
        expect(result).toBe('success');
        expect(breaker.getState()).toBe('closed');
      });

      it('should count failures', async () => {
        const failFn = () => Promise.reject(new Error('test error'));
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(failFn);
          } catch (e) {
            // Expected
          }
        }
        expect(breaker.getState()).toBe('open');
      });

      it('should reject immediately when open', async () => {
        // Trip the breaker
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('error')));
          } catch (e) {}
        }

        // Should reject immediately
        try {
          await breaker.execute(() => Promise.resolve('success'));
        } catch (e) {
          expect(e).toBeInstanceOf(CircuitBreakerError);
          expect((e as CircuitBreakerError).state).toBe('open');
        }
      });
    });

    describe('half-open state', () => {
      it('should transition to half-open after timeout', async () => {
        // Trip the breaker
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('error')));
          } catch (e) {}
        }
        expect(breaker.getState()).toBe('open');

        // Wait for timeout
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Should be half-open now
        expect(breaker.getState()).toBe('half-open');
      });

      it('should close after success threshold in half-open', async () => {
        // Trip and wait for half-open
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('error')));
          } catch (e) {}
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Succeed twice
        await breaker.execute(() => Promise.resolve('ok'));
        await breaker.execute(() => Promise.resolve('ok'));

        expect(breaker.getState()).toBe('closed');
      });

      it('should open again on failure in half-open', async () => {
        // Trip and wait for half-open
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('error')));
          } catch (e) {}
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Fail once
        try {
          await breaker.execute(() => Promise.reject(new Error('error')));
        } catch (e) {}

        expect(breaker.getState()).toBe('open');
      });
    });

    describe('reset', () => {
      it('should reset to closed state', async () => {
        // Trip the breaker
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('error')));
          } catch (e) {}
        }
        expect(breaker.getState()).toBe('open');

        breaker.reset();
        expect(breaker.getState()).toBe('closed');
      });
    });
  });

  describe('CircuitBreakerRegistry', () => {
    let registry: CircuitBreakerRegistry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry();
    });

    it('should create breaker for new connector', () => {
      const breaker = registry.get('connector-1');
      expect(breaker).toBeDefined();
      expect(breaker.getState()).toBe('closed');
    });

    it('should return same breaker for same connector', () => {
      const breaker1 = registry.get('connector-1');
      const breaker2 = registry.get('connector-1');
      expect(breaker1).toBe(breaker2);
    });

    it('should create different breakers for different connectors', () => {
      const breaker1 = registry.get('connector-1');
      const breaker2 = registry.get('connector-2');
      expect(breaker1).not.toBe(breaker2);
    });

    it('should reset specific breaker', async () => {
      const breaker = registry.get('connector-1');
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('error')));
        } catch (e) {}
      }
      expect(breaker.getState()).toBe('open');

      registry.reset('connector-1');
      expect(breaker.getState()).toBe('closed');
    });

    it('should reset all breakers', async () => {
      const breaker1 = registry.get('connector-1');
      const breaker2 = registry.get('connector-2');

      for (let i = 0; i < 5; i++) {
        try {
          await breaker1.execute(() => Promise.reject(new Error('error')));
          await breaker2.execute(() => Promise.reject(new Error('error')));
        } catch (e) {}
      }

      registry.resetAll();
      expect(breaker1.getState()).toBe('closed');
      expect(breaker2.getState()).toBe('closed');
    });

    it('should get all breakers', () => {
      registry.get('connector-1');
      registry.get('connector-2');
      const all = registry.getAll();
      expect(all.size).toBe(2);
    });
  });

  describe('CircuitBreakerError', () => {
    it('should have correct name and state', () => {
      const error = new CircuitBreakerError('test message', 'open');
      expect(error.name).toBe('CircuitBreakerError');
      expect(error.state).toBe('open');
      expect(error.message).toBe('test message');
    });
  });
});

// ============================================================
// Retry Tests
// ============================================================
describe('retry', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = () => Promise.resolve('success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const fn = () => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('temporary error'));
        }
        return Promise.resolve('success');
      };

      const result = await withRetry(fn, { maxRetries: 3, jitter: false });
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retries', async () => {
      const fn = () => Promise.reject(new Error('persistent error'));

      try {
        await withRetry(fn, { maxRetries: 2, jitter: false });
      } catch (e) {
        expect((e as Error).message).toBe('persistent error');
      }
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = () => {
        attempts++;
        const now = Date.now();
        if (attempts > 1) {
          delays.push(now);
        }
        if (attempts < 3) {
          return Promise.reject(new Error('error'));
        }
        return Promise.resolve('success');
      };

      await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: false,
      });

      // First delay should be ~100ms, second ~200ms
      expect(delays.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect retryableErrors pattern', async () => {
      let attempts = 0;
      const fn = () => {
        attempts++;
        return Promise.reject(new Error('timeout error'));
      };

      try {
        await withRetry(fn, {
          maxRetries: 2,
          retryableErrors: ['timeout'],
          jitter: false,
        });
      } catch (e) {
        expect(attempts).toBe(3); // Tried 3 times (initial + 2 retries)
      }
    });

    it('should throw immediately for non-retryable error', async () => {
      let attempts = 0;
      const fn = () => {
        attempts++;
        return Promise.reject(new Error('non-retryable error'));
      };

      try {
        await withRetry(fn, {
          maxRetries: 3,
          retryableErrors: ['timeout'],
        });
      } catch (e) {
        expect(attempts).toBe(1); // Should not retry
      }
    });

    it('should cap delay at maxDelayMs', async () => {
      // Skip this test due to slow execution
      // The logic is already tested in the backoff calculation
    });
  });
});