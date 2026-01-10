/**
 * Tests for error handling utilities
 */

import { describe, it, expect, vi } from 'vitest';
import { APIError } from 'openai';
import {
  ErrorCategory,
  SmartSTTError,
  createNetworkError,
  createAuthError,
  createRateLimitError,
  createTimeoutError,
  createPasteFailureError,
  createCopyFailureError,
  createEmptyAudioError,
  createInvalidAudioError,
  createMissingApiKeyError,
  createEditNoTextError,
  createEditEmptyInstructionError,
  createEditEmptyResultError,
  categorizeAPIError,
  isRetryableError,
  logError,
} from './errors';

describe('SmartSTTError', () => {
  it('should create error with all properties', () => {
    const originalError = new Error('Original error');
    const error = new SmartSTTError({
      category: ErrorCategory.NETWORK,
      message: 'Technical message',
      userMessage: 'User message',
      canRetry: true,
      originalError,
    });

    expect(error.name).toBe('SmartSTTError');
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.message).toBe('Technical message');
    expect(error.userMessage).toBe('User message');
    expect(error.canRetry).toBe(true);
    expect(error.originalError).toBe(originalError);
  });

  it('should default canRetry to false', () => {
    const error = new SmartSTTError({
      category: ErrorCategory.AUDIO,
      message: 'Test',
      userMessage: 'Test user',
    });

    expect(error.canRetry).toBe(false);
  });
});

describe('Error factory functions', () => {
  it('createNetworkError should create retryable network error', () => {
    const originalError = new Error('Connection refused');
    const error = createNetworkError(originalError);

    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.canRetry).toBe(true);
    expect(error.userMessage).toContain('conexão');
    expect(error.message).toContain('Connection refused');
  });

  it('createAuthError should create non-retryable auth error', () => {
    const error = createAuthError(new Error('Invalid API key'));

    expect(error.category).toBe(ErrorCategory.API_AUTH);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('Chave da API');
  });

  it('createRateLimitError should create retryable rate limit error', () => {
    const error = createRateLimitError(new Error('Rate limit exceeded'));

    expect(error.category).toBe(ErrorCategory.API_RATE_LIMIT);
    expect(error.canRetry).toBe(true);
    expect(error.userMessage).toContain('Limite de uso');
  });

  it('createTimeoutError should create retryable timeout error', () => {
    const error = createTimeoutError('transcription', 30000);

    expect(error.category).toBe(ErrorCategory.TIMEOUT);
    expect(error.canRetry).toBe(true);
    expect(error.message).toContain('transcription');
    expect(error.message).toContain('30000');
    expect(error.userMessage).toContain('demorou muito');
  });

  it('createPasteFailureError should create non-retryable clipboard error', () => {
    const error = createPasteFailureError();

    expect(error.category).toBe(ErrorCategory.CLIPBOARD);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('Cole manualmente');
  });

  it('createCopyFailureError should create non-retryable clipboard error', () => {
    const error = createCopyFailureError();

    expect(error.category).toBe(ErrorCategory.CLIPBOARD);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('copiar');
  });

  it('createEmptyAudioError should create non-retryable audio error', () => {
    const error = createEmptyAudioError();

    expect(error.category).toBe(ErrorCategory.AUDIO);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('vazio');
  });

  it('createInvalidAudioError should create non-retryable audio error', () => {
    const error = createInvalidAudioError('Invalid format');

    expect(error.category).toBe(ErrorCategory.AUDIO);
    expect(error.canRetry).toBe(false);
    expect(error.message).toContain('Invalid format');
    expect(error.userMessage).toContain('inválido');
  });

  it('createMissingApiKeyError should create non-retryable config error', () => {
    const error = createMissingApiKeyError();

    expect(error.category).toBe(ErrorCategory.CONFIGURATION);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('Configure a chave');
  });

  it('createEditNoTextError should create non-retryable edit mode error', () => {
    const error = createEditNoTextError();

    expect(error.category).toBe(ErrorCategory.EDIT_MODE);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('Selecione ou copie');
  });

  it('createEditEmptyInstructionError should create non-retryable edit mode error', () => {
    const error = createEditEmptyInstructionError();

    expect(error.category).toBe(ErrorCategory.EDIT_MODE);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('vazia');
  });

  it('createEditEmptyResultError should create non-retryable edit mode error', () => {
    const error = createEditEmptyResultError();

    expect(error.category).toBe(ErrorCategory.EDIT_MODE);
    expect(error.canRetry).toBe(false);
    expect(error.userMessage).toContain('vazio');
  });
});

describe('categorizeAPIError', () => {
  it('should categorize 401 as auth error', () => {
    const apiError = new APIError(401, { error: { message: 'Invalid API key' } }, 'Unauthorized', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.API_AUTH);
    expect(error.canRetry).toBe(false);
  });

  it('should categorize 403 as auth error', () => {
    const apiError = new APIError(403, { error: { message: 'Forbidden' } }, 'Forbidden', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.API_AUTH);
    expect(error.canRetry).toBe(false);
  });

  it('should categorize 429 as rate limit error', () => {
    const apiError = new APIError(429, { error: { message: 'Rate limit exceeded' } }, 'Too Many Requests', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.API_RATE_LIMIT);
    expect(error.canRetry).toBe(true);
  });

  it('should categorize 4xx as validation error', () => {
    const apiError = new APIError(400, { error: { message: 'Invalid request' } }, 'Bad Request', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.API_VALIDATION);
    expect(error.canRetry).toBe(false);
  });

  it('should categorize 5xx as network error', () => {
    const apiError = new APIError(500, { error: { message: 'Internal server error' } }, 'Server Error', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.canRetry).toBe(true);
  });

  it('should categorize errors without status as network error', () => {
    const apiError = new APIError(undefined as any, null, 'Connection failed', new Headers());
    const error = categorizeAPIError(apiError);

    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.canRetry).toBe(true);
  });

  it('should categorize non-APIError as unknown error', () => {
    const normalError = new Error('Something went wrong');
    const error = categorizeAPIError(normalError);

    expect(error.category).toBe(ErrorCategory.UNKNOWN);
    expect(error.canRetry).toBe(true);
  });
});

describe('isRetryableError', () => {
  it('should return true for retryable SmartSTTError', () => {
    const error = createNetworkError(new Error('Network error'));
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false for non-retryable SmartSTTError', () => {
    const error = createAuthError(new Error('Auth error'));
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return true for retryable APIError', () => {
    const apiError = new APIError(500, { error: { message: 'Server error' } }, 'Server Error', new Headers());
    expect(isRetryableError(apiError)).toBe(true);
  });

  it('should return false for non-retryable APIError', () => {
    const apiError = new APIError(401, { error: { message: 'Unauthorized' } }, 'Unauthorized', new Headers());
    expect(isRetryableError(apiError)).toBe(false);
  });

  it('should return true for unknown errors', () => {
    const error = new Error('Unknown error');
    expect(isRetryableError(error)).toBe(true);
  });
});

describe('logError', () => {
  it('should log SmartSTTError with category and original error', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalError = new Error('Original');
    const error = new SmartSTTError({
      category: ErrorCategory.NETWORK,
      message: 'Network error',
      userMessage: 'User message',
      originalError,
    });

    logError('TestContext', error);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[TestContext] network:',
      'Network error',
      expect.stringContaining('Original: Original')
    );
    expect(consoleSpy).toHaveBeenCalledWith('Original error:', originalError);

    consoleSpy.mockRestore();
  });

  it('should log regular Error', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Test error');

    logError('TestContext', error);

    expect(consoleSpy).toHaveBeenCalledWith('[TestContext]', 'Test error', error);

    consoleSpy.mockRestore();
  });

  it('should log non-Error values', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('TestContext', 'string error');

    expect(consoleSpy).toHaveBeenCalledWith('[TestContext]', 'string error');

    consoleSpy.mockRestore();
  });
});
