import { RETRY_CONFIG } from './constants';
import { log } from './logging';
import type { CircuitBreakerState } from './types';

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: null,
  isOpen: false
};

export function checkCircuitBreaker(): boolean {
  if (!circuitBreaker.isOpen) return true;

  const now = Date.now();
  const timeSinceLastFailure = now - (circuitBreaker.lastFailureTime || 0);

  if (timeSinceLastFailure >= RETRY_CONFIG.CIRCUIT_BREAKER_RESET_MS) {
    log('Circuit breaker reset');
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    return true;
  }

  return false;
}

export function recordFailure(): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.failures >= RETRY_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
    log('Circuit breaker opened - too many failures');
    circuitBreaker.isOpen = true;
  }
}

export function recordSuccess(): void {
  if (circuitBreaker.failures > 0) {
    log('Circuit breaker - resetting failure count after success');
    circuitBreaker.failures = 0;
    circuitBreaker.isOpen = false;
  }
}
