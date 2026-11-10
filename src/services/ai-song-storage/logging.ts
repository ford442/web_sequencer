import { log as logger } from '@/utils/log';

export function log(message: string, ...args: unknown[]): void {
  logger.debug(`[AISongStorage] ${message}`, ...args);
}

export function logError(message: string, error: unknown): void {
  console.error(`[AISongStorage] ${message}`, error);
}
