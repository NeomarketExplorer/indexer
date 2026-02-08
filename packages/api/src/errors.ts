/**
 * Error handling utilities for API clients
 */

import { z } from 'zod';

/**
 * Base error class for all API-related errors
 */
export abstract class BaseAPIError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * APIError - For API-specific errors with status code, message, and optional response body
 */
export class APIError extends BaseAPIError {
  readonly code = 'API_ERROR';

  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    public readonly body?: unknown
  ) {
    super(message);
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.status >= 500 && this.status < 600;
  }

  /**
   * Check if the error is retryable (5xx or specific 4xx codes)
   */
  isRetryable(): boolean {
    if (this.isServerError()) return true;
    if (this.status === 408 || this.status === 429) return true;
    return false;
  }
}

/**
 * ValidationError - For Zod/schema validation failures
 */
export class ValidationError extends BaseAPIError {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly errors: z.ZodIssue[],
    public readonly rawData?: unknown
  ) {
    super(message);
  }

  /**
   * Get a formatted list of validation issues
   */
  getFormattedErrors(): string[] {
    return this.errors.map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    });
  }

  /**
   * Create from a ZodError
   */
  static fromZodError(error: z.ZodError, rawData?: unknown): ValidationError {
    return new ValidationError(
      `Validation failed: ${error.errors.map(e => e.message).join(', ')}`,
      error.errors,
      rawData
    );
  }
}

/**
 * NetworkError - For network connectivity issues (timeout, no connection)
 */
export class NetworkError extends BaseAPIError {
  readonly code = 'NETWORK_ERROR';

  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly isTimeout: boolean = false,
    public readonly url?: string
  ) {
    super(message);
  }

  /**
   * Check if the error is retryable
   */
  isRetryable(): boolean {
    return true;
  }

  /**
   * Create a timeout error
   */
  static timeout(url: string, timeoutMs: number): NetworkError {
    return new NetworkError(
      `Request timeout after ${timeoutMs}ms`,
      undefined,
      true,
      url
    );
  }

  /**
   * Create a connection error
   */
  static connectionFailed(url: string, cause?: Error): NetworkError {
    return new NetworkError(
      'Failed to connect to server',
      cause,
      false,
      url
    );
  }

  /**
   * Create from an AbortError
   */
  static fromAbortError(url: string, timeoutMs: number): NetworkError {
    return NetworkError.timeout(url, timeoutMs);
  }
}

/**
 * RateLimitError - For 429 rate limit responses
 */
export class RateLimitError extends BaseAPIError {
  readonly code = 'RATE_LIMIT_ERROR';

  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly url?: string,
    public readonly limit?: number,
    public readonly remaining?: number,
    public readonly resetAt?: Date
  ) {
    super(message);
  }

  /**
   * Get the recommended wait time in milliseconds
   */
  getWaitTimeMs(): number {
    if (this.retryAfter !== undefined) {
      return this.retryAfter * 1000;
    }
    if (this.resetAt) {
      const waitMs = this.resetAt.getTime() - Date.now();
      return Math.max(0, waitMs);
    }
    return 60000;
  }

  /**
   * Create from response headers
   */
  static fromResponse(
    url: string,
    headers: Headers,
    _body?: unknown
  ): RateLimitError {
    const retryAfter = headers.get('Retry-After');
    const limit = headers.get('X-RateLimit-Limit');
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');

    let resetAt: Date | undefined;
    if (reset) {
      const resetValue = parseInt(reset, 10);
      if (resetValue > 1000000000) {
        resetAt = new Date(resetValue * 1000);
      } else {
        resetAt = new Date(Date.now() + resetValue * 1000);
      }
    }

    return new RateLimitError(
      'Rate limit exceeded. Please slow down your requests.',
      retryAfter ? parseInt(retryAfter, 10) : undefined,
      url,
      limit ? parseInt(limit, 10) : undefined,
      remaining ? parseInt(remaining, 10) : undefined,
      resetAt
    );
  }
}

/**
 * Type guards
 */
export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export function isBaseAPIError(error: unknown): error is BaseAPIError {
  return error instanceof BaseAPIError;
}

/**
 * Parse various error types into appropriate error classes
 */
export function parseApiError(error: unknown): BaseAPIError {
  if (error instanceof BaseAPIError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return ValidationError.fromZodError(error);
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new NetworkError('Request was aborted', error, true);
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      return new NetworkError('Network request failed', error, false);
    }

    if (
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ETIMEDOUT')
    ) {
      return new NetworkError(error.message, error);
    }

    return new APIError(error.message, 0, 'Unknown', '', undefined);
  }

  const message = typeof error === 'string' ? error : 'An unknown error occurred';
  return new APIError(message, 0, 'Unknown', '', error);
}

/**
 * User-friendly error messages mapping
 */
const userFriendlyMessages: Record<string, string> = {
  'Failed to fetch': 'Unable to connect to the server. Please check your internet connection.',
  'Network request failed': 'Unable to connect to the server. Please check your internet connection.',
  'Request was aborted': 'The request took too long. Please try again.',
  'Failed to connect to server': 'Unable to reach the server. Please try again later.',
  '400': 'The request was invalid. Please check your input and try again.',
  '401': 'You are not authorized. Please log in and try again.',
  '403': 'You do not have permission to perform this action.',
  '404': 'The requested resource was not found.',
  '408': 'The request timed out. Please try again.',
  '409': 'There was a conflict with the current state. Please refresh and try again.',
  '422': 'The provided data is invalid. Please check your input.',
  '429': 'Too many requests. Please wait a moment before trying again.',
  '500': 'An unexpected server error occurred. Please try again later.',
  '502': 'The server is temporarily unavailable. Please try again later.',
  '503': 'The service is temporarily unavailable. Please try again later.',
  '504': 'The server took too long to respond. Please try again.',
};

/**
 * Maps technical errors to user-friendly messages
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof RateLimitError) {
    const waitTime = Math.ceil(error.getWaitTimeMs() / 1000);
    if (waitTime > 0) {
      return `Too many requests. Please wait ${waitTime} seconds before trying again.`;
    }
    return userFriendlyMessages['429'];
  }

  if (error instanceof NetworkError) {
    if (error.isTimeout) {
      return 'The request took too long. Please try again.';
    }
    return 'Unable to connect to the server. Please check your internet connection.';
  }

  if (error instanceof ValidationError) {
    const firstError = error.getFormattedErrors()[0];
    if (firstError) {
      return `Invalid data: ${firstError}`;
    }
    return 'The provided data is invalid. Please check your input.';
  }

  if (error instanceof APIError) {
    const statusMessage = userFriendlyMessages[String(error.status)];
    if (statusMessage) {
      return statusMessage;
    }

    if (error.body && typeof error.body === 'object' && 'message' in error.body) {
      return String((error.body as { message: unknown }).message);
    }

    if (error.isClientError()) {
      return 'The request could not be completed. Please try again.';
    }
    if (error.isServerError()) {
      return 'An unexpected server error occurred. Please try again later.';
    }
  }

  if (error instanceof Error) {
    const knownMessage = userFriendlyMessages[error.message];
    if (knownMessage) {
      return knownMessage;
    }

    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return 'The request took too long. Please try again.';
    }

    if (
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('fetch')
    ) {
      return 'Unable to connect to the server. Please check your internet connection.';
    }
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Extract error details for logging
 */
export function getErrorDetails(error: unknown): {
  code: string;
  message: string;
  status?: number;
  url?: string;
  isRetryable: boolean;
  details?: unknown;
} {
  if (error instanceof RateLimitError) {
    return {
      code: error.code,
      message: error.message,
      status: 429,
      url: error.url,
      isRetryable: true,
      details: {
        retryAfter: error.retryAfter,
        limit: error.limit,
        remaining: error.remaining,
        resetAt: error.resetAt?.toISOString(),
      },
    };
  }

  if (error instanceof NetworkError) {
    return {
      code: error.code,
      message: error.message,
      url: error.url,
      isRetryable: error.isRetryable(),
      details: {
        isTimeout: error.isTimeout,
        cause: error.cause?.message,
      },
    };
  }

  if (error instanceof ValidationError) {
    return {
      code: error.code,
      message: error.message,
      isRetryable: false,
      details: {
        errors: error.getFormattedErrors(),
        rawData: error.rawData,
      },
    };
  }

  if (error instanceof APIError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      url: error.url,
      isRetryable: error.isRetryable(),
      details: {
        statusText: error.statusText,
        body: error.body,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'UNKNOWN_ERROR',
    message,
    isRetryable: false,
    details: error,
  };
}
