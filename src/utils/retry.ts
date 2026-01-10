/**
 * Retry logic with exponential backoff for handling transient failures
 */

import { isRetryableError, logError } from './errors';

export interface RetryConfig {
  /** Maximum number of attempts (including the initial attempt) */
  maxAttempts: number;
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (delay *= backoffMultiplier) */
  backoffMultiplier: number;
  /** Function to determine if an error should trigger a retry */
  shouldRetry: (error: unknown) => boolean;
  /** Callback invoked before each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Function to check if operation was cancelled (e.g., user cancellation) */
  isCancelled?: () => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: isRetryableError,
};

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Wraps an async operation with retry logic using exponential backoff
 *
 * @param operation - The async function to execute
 * @param config - Configuration for retry behavior
 * @returns Promise that resolves with the operation result or rejects with the last error
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => apiCall(),
 *   {
 *     maxAttempts: 3,
 *     shouldRetry: (error) => error instanceof NetworkError
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    // Check for cancellation before each attempt
    if (finalConfig.isCancelled?.()) {
      throw new Error('Operation cancelled by user');
    }

    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry if this was the last attempt
      if (attempt === finalConfig.maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!finalConfig.shouldRetry(error)) {
        throw error;
      }

      // Calculate delay for this retry
      const delayMs = calculateDelay(
        attempt,
        finalConfig.initialDelayMs,
        finalConfig.maxDelayMs,
        finalConfig.backoffMultiplier
      );

      // Invoke retry callback if provided
      if (finalConfig.onRetry) {
        finalConfig.onRetry(attempt, error, delayMs);
      } else {
        // Default logging
        console.warn(`[Retry] Attempt ${attempt}/${finalConfig.maxAttempts} failed, retrying in ${delayMs}ms...`);
        logError('Retry', error);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All attempts failed, throw the last error
  throw lastError;
}

/**
 * Creates a retry configuration for API calls with sensible defaults
 */
export function createAPIRetryConfig(
  overrides: Partial<RetryConfig> = {}
): Partial<RetryConfig> {
  return {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    shouldRetry: isRetryableError,
    ...overrides,
  };
}
