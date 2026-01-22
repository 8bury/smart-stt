/**
 * Tests for retry logic with exponential backoff
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, createAPIRetryConfig } from './retry';
import { createNetworkError, createAuthError } from './errors';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return result on first successful attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const resultPromise = withRetry(operation);
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error and succeed', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(createNetworkError(new Error('Network error')))
      .mockResolvedValue('success');

    const resultPromise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 1000,
    });

    // Wait for first attempt to fail
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay (1 second)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable error', async () => {
    const authError = createAuthError(new Error('Invalid API key'));
    const operation = vi.fn().mockRejectedValue(authError);

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
      })
    ).rejects.toThrow(authError);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should respect max attempts', async () => {
    const networkError = createNetworkError(new Error('Network error'));
    const operation = vi.fn().mockRejectedValue(networkError);

    const resultPromise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 1000,
    });
    const expectation = expect(resultPromise).rejects.toThrow(networkError);

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for first retry (1s delay)
    await vi.advanceTimersByTimeAsync(1000);

    // Wait for second retry (2s delay due to backoff)
    await vi.advanceTimersByTimeAsync(2000);

    await expectation;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should apply exponential backoff', async () => {
    const operation = vi.fn().mockRejectedValue(createNetworkError(new Error('Network error')));
    const onRetry = vi.fn();

    const resultPromise = withRetry(operation, {
      maxAttempts: 4,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      onRetry,
    });
    const expectation = expect(resultPromise).rejects.toThrow();

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for first retry (1s delay)
    await vi.advanceTimersByTimeAsync(1000);

    // Wait for second retry (2s delay)
    await vi.advanceTimersByTimeAsync(2000);

    // Wait for third retry (4s delay)
    await vi.advanceTimersByTimeAsync(4000);

    await expectation;

    // Check that onRetry was called with correct delays
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 2000);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 4000);
  });

  it('should respect max delay', async () => {
    const operation = vi.fn().mockRejectedValue(createNetworkError(new Error('Network error')));
    const onRetry = vi.fn();

    const resultPromise = withRetry(operation, {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 3000,
      backoffMultiplier: 2,
      onRetry,
    });
    const expectation = expect(resultPromise).rejects.toThrow();

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Retries with delays: 1s, 2s, 3s (capped), 3s (capped)
    await vi.advanceTimersByTimeAsync(1000); // First retry (1s delay)
    await vi.advanceTimersByTimeAsync(2000); // Second retry (2s delay)
    await vi.advanceTimersByTimeAsync(3000); // Third retry (3s delay, capped)
    await vi.advanceTimersByTimeAsync(3000); // Fourth retry (3s delay, capped)

    await expectation;

    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 2000);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 3000); // Capped at maxDelayMs
    expect(onRetry).toHaveBeenNthCalledWith(4, 4, expect.any(Error), 3000); // Capped at maxDelayMs
  });

  it('should check cancellation before each attempt', async () => {
    let isCancelled = false;
    const operation = vi.fn().mockRejectedValue(createNetworkError(new Error('Network error')));

    const resultPromise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      isCancelled: () => isCancelled,
    });
    const expectation = expect(resultPromise).rejects.toThrow('Operation cancelled by user');

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Cancel before retry
    isCancelled = true;

    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(1000);

    await expectation;

    // Only first attempt should have been made
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should use custom shouldRetry function', async () => {
    const customError = new Error('Custom error');
    const operation = vi.fn().mockRejectedValue(customError);

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        shouldRetry: (error) => error instanceof Error && error.message.includes('Network'),
      })
    ).rejects.toThrow(customError);

    // Should not retry because error doesn't match custom condition
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should invoke onRetry callback with correct parameters', async () => {
    const networkError = createNetworkError(new Error('Network error'));
    const operation = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue('success');

    const onRetry = vi.fn();

    const resultPromise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      onRetry,
    });

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for first retry
    await vi.advanceTimersByTimeAsync(1000);

    // Wait for second retry
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;

    expect(result).toBe('success');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, networkError, 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, networkError, 2000);
  });
});

describe('createAPIRetryConfig', () => {
  it('should create default config', () => {
    const config = createAPIRetryConfig();

    expect(config.maxAttempts).toBe(3);
    expect(config.initialDelayMs).toBe(1000);
    expect(config.maxDelayMs).toBe(10000);
    expect(config.backoffMultiplier).toBe(2);
    expect(config.shouldRetry).toBeDefined();
  });

  it('should allow overriding defaults', () => {
    const config = createAPIRetryConfig({
      maxAttempts: 5,
      initialDelayMs: 500,
    });

    expect(config.maxAttempts).toBe(5);
    expect(config.initialDelayMs).toBe(500);
    expect(config.maxDelayMs).toBe(10000); // Default
    expect(config.backoffMultiplier).toBe(2); // Default
  });
});
