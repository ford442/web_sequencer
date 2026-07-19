import type { ErrorCategory, StorageErrorInfo } from './types';

/**
 * Create a user-friendly error message based on error category
 */
export function createUserMessage(category: ErrorCategory, message: string): string {
  const messages: Record<ErrorCategory, string> = {
    NETWORK: 'Connection failed. Please check your internet connection and try again.',
    TIMEOUT: 'The request took too long. Please try again.',
    VALIDATION: `Validation error: ${message}`,
    SERVER: 'Server error. Our team has been notified. Please try again later.',
    NOT_FOUND: 'The requested song could not be found.',
    OFFLINE: 'You appear to be offline. Your song has been queued for upload when you reconnect.'
  };
  return messages[category] || message;
}

/**
 * Classify and enhance an error with user-friendly messaging
 */
export function classifyAndEnhanceError(
  error: unknown,
  category?: ErrorCategory
): StorageErrorInfo {
  const now = new Date().toISOString();

  if (error && typeof error === 'object' && 'category' in error) {
    const existing = error as StorageErrorInfo;
    return {
      ...existing,
      userMessage: existing.userMessage || createUserMessage(existing.category, existing.message),
      timestamp: existing.timestamp || now
    };
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const cat: ErrorCategory = category ||
    (err.message.includes('fetch') ? 'NETWORK' :
     err.message.includes('timeout') ? 'TIMEOUT' :
     err.message.includes('validation') ? 'VALIDATION' :
     err.message.includes('offline') ? 'OFFLINE' : 'SERVER');

  return {
    category: cat,
    message: err.message,
    userMessage: createUserMessage(cat, err.message),
    retryable: ['NETWORK', 'TIMEOUT', 'SERVER', 'OFFLINE'].includes(cat),
    timestamp: now
  };
}
