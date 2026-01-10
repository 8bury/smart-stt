/**
 * Timeout handling utilities for async operations
 */

import { createTimeoutError } from './errors';

/**
 * Wraps an async operation with a timeout
 *
 * @param operation - The async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns Promise that resolves with operation result or rejects with TimeoutError
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   () => fetchData(),
 *   5000,
 *   'fetchData'
 * );
 * ```
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  let isTimedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      reject(createTimeoutError(operationName, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    return result;
  } finally {
    // Clean up timeout if operation completed before timeout
    if (timeoutHandle && !isTimedOut) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Timeout constants for different operations in the application
 */
export const TIMEOUTS = {
  /** Whisper transcription can take longer for longer audio */
  TRANSCRIPTION: 30000, // 30 seconds
  /** GPT text cleaning is usually fast */
  TEXT_CLEANING: 15000, // 15 seconds
  /** GPT text editing may take longer depending on text length */
  TEXT_EDITING: 20000, // 20 seconds
  /** Clipboard operations should be quick */
  CLIPBOARD_PASTE: 2000, // 2 seconds
  CLIPBOARD_COPY: 2000, // 2 seconds
} as const;
