/**
 * Tests for timeout handling utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout } from './timeout';
import { SmartSTTError, ErrorCategory } from './errors';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve if operation completes before timeout', async () => {
    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'success';
    });

    const promise = withTimeout(operation, 200, 'testOp');

    vi.advanceTimersByTime(100);
    await Promise.resolve(); // Let the operation complete

    const result = await promise;
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should reject with timeout error if operation exceeds timeout', async () => {
    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
      return 'success';
    });

    const promise = withTimeout(operation, 200, 'testOp');

    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow(SmartSTTError);
    await expect(promise).rejects.toMatchObject({
      category: ErrorCategory.TIMEOUT,
      userMessage: expect.stringContaining('demorou muito'),
      canRetry: true
    });
  });

  it('should include operation name in error message', async () => {
    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
      return 'success';
    });

    const promise = withTimeout(operation, 100, 'whisperTranscription');

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow(SmartSTTError);
    await expect(promise).rejects.toMatchObject({
      category: ErrorCategory.TIMEOUT,
      canRetry: true
    });
  });

  it('should handle synchronous errors from operation', async () => {
    const error = new Error('Sync error');
    const operation = vi.fn(() => {
      throw error;
    });

    await expect(withTimeout(operation, 1000, 'testOp')).rejects.toThrow(error);
  });

  it('should handle rejected promises from operation', async () => {
    const error = new Error('Async error');
    const operation = vi.fn(async () => {
      throw error;
    });

    await expect(withTimeout(operation, 1000, 'testOp')).rejects.toThrow(error);
  });

  it('should clear timeout on successful completion', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return 'success';
    });

    const promise = withTimeout(operation, 200, 'testOp');

    vi.advanceTimersByTime(50);
    await Promise.resolve();

    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('should clear timeout on operation error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const operation = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      throw new Error('Operation failed');
    });

    const promise = withTimeout(operation, 200, 'testOp');

    vi.advanceTimersByTime(50);
    await Promise.resolve();

    try {
      await promise;
    } catch {
      // Expected to fail
    }

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('should work with real timers for integration', async () => {
    vi.useRealTimers();

    const operation = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'real success';
    };

    const result = await withTimeout(operation, 100, 'realOp');
    expect(result).toBe('real success');
  });
});
