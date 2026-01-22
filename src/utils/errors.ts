/**
 * Structured error handling for Smart STT
 * Provides consistent error categorization and user-friendly messages
 */

import { APIError } from 'openai';

export enum ErrorCategory {
  NETWORK = 'network',
  API_AUTH = 'api_auth',
  API_RATE_LIMIT = 'api_rate_limit',
  API_VALIDATION = 'api_validation',
  TIMEOUT = 'timeout',
  AUDIO = 'audio',
  CLIPBOARD = 'clipboard',
  CONFIGURATION = 'configuration',
  EDIT_MODE = 'edit_mode',
  UNKNOWN = 'unknown',
}

export interface SmartSTTErrorParams {
  category: ErrorCategory;
  message: string; // Technical message for logs
  userMessage: string; // User-facing message in Portuguese
  canRetry?: boolean;
  originalError?: Error;
}

export class CancelledError extends Error {
  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelledError(error: unknown): error is CancelledError {
  return error instanceof CancelledError;
}

/**
 * Custom error class with structured information for error handling
 */
export class SmartSTTError extends Error {
  readonly category: ErrorCategory;
  readonly userMessage: string;
  readonly canRetry: boolean;
  readonly originalError?: Error;

  constructor(params: SmartSTTErrorParams) {
    super(params.message);
    this.name = 'SmartSTTError';
    this.category = params.category;
    this.userMessage = params.userMessage;
    this.canRetry = params.canRetry ?? false;
    this.originalError = params.originalError;

    // Maintain proper stack trace for where our error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SmartSTTError);
    }
  }
}

/**
 * Creates a network error from a caught error
 */
export function createNetworkError(error: unknown): SmartSTTError {
  const originalError = error instanceof Error ? error : undefined;
  return new SmartSTTError({
    category: ErrorCategory.NETWORK,
    message: `Network error: ${originalError?.message || String(error)}`,
    userMessage: 'Erro de conexão. Verifique sua internet e tente novamente.',
    canRetry: true,
    originalError,
  });
}

/**
 * Creates an authentication error
 */
export function createAuthError(error: unknown): SmartSTTError {
  const originalError = error instanceof Error ? error : undefined;
  return new SmartSTTError({
    category: ErrorCategory.API_AUTH,
    message: `API authentication error: ${originalError?.message || String(error)}`,
    userMessage: 'Chave da API inválida. Configure a chave correta nas configurações.',
    canRetry: false,
    originalError,
  });
}

/**
 * Creates a rate limit error
 */
export function createRateLimitError(error: unknown): SmartSTTError {
  const originalError = error instanceof Error ? error : undefined;
  return new SmartSTTError({
    category: ErrorCategory.API_RATE_LIMIT,
    message: `API rate limit exceeded: ${originalError?.message || String(error)}`,
    userMessage: 'Limite de uso da API atingido. Aguarde alguns minutos e tente novamente.',
    canRetry: true,
    originalError,
  });
}

/**
 * Creates a timeout error for a specific operation
 */
export function createTimeoutError(operation: string, timeoutMs: number): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.TIMEOUT,
    message: `Operation '${operation}' timed out after ${timeoutMs}ms`,
    userMessage: 'A operação demorou muito. Tente novamente.',
    canRetry: true,
  });
}

/**
 * Creates a clipboard paste failure error
 */
export function createPasteFailureError(error?: unknown): SmartSTTError {
  const originalError = error instanceof Error ? error : undefined;
  return new SmartSTTError({
    category: ErrorCategory.CLIPBOARD,
    message: `Paste simulation failed: ${originalError?.message || String(error || 'unknown')}`,
    userMessage: 'Texto copiado. Cole manualmente com Ctrl+V.',
    canRetry: false,
    originalError,
  });
}

/**
 * Creates a clipboard copy failure error
 */
export function createCopyFailureError(error?: unknown): SmartSTTError {
  const originalError = error instanceof Error ? error : undefined;
  return new SmartSTTError({
    category: ErrorCategory.CLIPBOARD,
    message: `Copy simulation failed: ${originalError?.message || String(error || 'unknown')}`,
    userMessage: 'Não foi possível copiar o texto selecionado.',
    canRetry: false,
    originalError,
  });
}

/**
 * Creates an empty audio error
 */
export function createEmptyAudioError(): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.AUDIO,
    message: 'Audio buffer is empty',
    userMessage: 'Áudio vazio. Grave novamente.',
    canRetry: false,
  });
}

/**
 * Creates an invalid audio error
 */
export function createInvalidAudioError(reason: string): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.AUDIO,
    message: `Invalid audio: ${reason}`,
    userMessage: 'Formato de áudio inválido.',
    canRetry: false,
  });
}

/**
 * Creates a configuration error (missing API key)
 */
export function createMissingApiKeyError(): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.CONFIGURATION,
    message: 'OpenAI API key not configured',
    userMessage: 'Configure a chave da OpenAI nas configurações.',
    canRetry: false,
  });
}

/**
 * Creates an edit mode error (no text available)
 */
export function createEditNoTextError(): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.EDIT_MODE,
    message: 'No text available for editing',
    userMessage: 'Selecione ou copie um texto antes de editar.',
    canRetry: false,
  });
}

/**
 * Creates an edit mode error (empty instruction)
 */
export function createEditEmptyInstructionError(): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.EDIT_MODE,
    message: 'Empty edit instruction after transcription',
    userMessage: 'Instrução de edição vazia. Grave novamente.',
    canRetry: false,
  });
}

/**
 * Creates an edit mode error (empty result from LLM)
 */
export function createEditEmptyResultError(): SmartSTTError {
  return new SmartSTTError({
    category: ErrorCategory.EDIT_MODE,
    message: 'LLM returned empty text after editing',
    userMessage: 'A edição resultou em texto vazio.',
    canRetry: false,
  });
}

/**
 * Categorizes an OpenAI APIError into appropriate SmartSTTError
 */
export function categorizeAPIError(error: unknown): SmartSTTError {
  if (!(error instanceof APIError)) {
    return new SmartSTTError({
      category: ErrorCategory.UNKNOWN,
      message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      userMessage: 'Erro desconhecido. Tente novamente.',
      canRetry: true,
      originalError: error instanceof Error ? error : undefined,
    });
  }

  const apiError = error as APIError;

  // Check status code
  if (apiError.status === 401 || apiError.status === 403) {
    return createAuthError(error);
  }

  if (apiError.status === 429) {
    return createRateLimitError(error);
  }

  if (apiError.status && apiError.status >= 400 && apiError.status < 500) {
    // Client error (4xx) - usually not retryable
    return new SmartSTTError({
      category: ErrorCategory.API_VALIDATION,
      message: `API validation error: ${apiError.message}`,
      userMessage: 'Dados inválidos enviados para a API.',
      canRetry: false,
      originalError: error,
    });
  }

  if (apiError.status && apiError.status >= 500) {
    // Server error (5xx) - retryable
    return new SmartSTTError({
      category: ErrorCategory.NETWORK,
      message: `API server error: ${apiError.message}`,
      userMessage: 'Erro no servidor da API. Tente novamente.',
      canRetry: true,
      originalError: error,
    });
  }

  // Network-related errors (no status code)
  if (!apiError.status) {
    return createNetworkError(error);
  }

  // Fallback
  return new SmartSTTError({
    category: ErrorCategory.UNKNOWN,
    message: `API error: ${apiError.status} ${apiError.code} ${apiError.message}`,
    userMessage: 'Erro ao comunicar com a API. Tente novamente.',
    canRetry: true,
    originalError: error,
  });
}

/**
 * Determines if an error is retryable based on its type
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof CancelledError) {
    return false;
  }
  if (error instanceof SmartSTTError) {
    return error.canRetry;
  }

  if (error instanceof APIError) {
    const categorized = categorizeAPIError(error);
    return categorized.canRetry;
  }

  // Unknown errors are considered retryable by default
  return true;
}

/**
 * Logs an error with context and structured information
 */
export function logError(context: string, error: unknown): void {
  if (error instanceof SmartSTTError) {
    console.error(
      `[${context}] ${error.category}:`,
      error.message,
      error.originalError ? `\nOriginal: ${error.originalError.message}` : ''
    );
    if (error.originalError) {
      console.error('Original error:', error.originalError);
    }
  } else if (error instanceof Error) {
    console.error(`[${context}]`, error.message, error);
  } else {
    console.error(`[${context}]`, String(error));
  }
}
