const DEBUG = true;

export function log(message: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.log(`[AISongStorage] ${message}`, ...args);
  }
}

export function logError(message: string, error: unknown): void {
  console.error(`[AISongStorage] ${message}`, error);
}
