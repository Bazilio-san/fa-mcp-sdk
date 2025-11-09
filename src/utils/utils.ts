import { closeAllPgConnectionsPg } from 'af-db-ts';
import { fileLogger } from '../logger.js';

export const trim = (s: any): string => String(s || '').trim();

export const ppj = (v: any) => {
  return JSON.stringify(v, null, 2);
};

export const isObject = (o: any): boolean => (o && typeof o === 'object');

export const isNonEmptyObject = (o: any): boolean => isObject(o) && !Array.isArray(o) && Object.values(o).some((v) => v !== undefined);

async function gracefulShutdown (signal: string, exitCode: number = 0) {
  console.log(`A ${signal} signal has been received. Complete...`);
  const FORCE_EXIT_TIMEOUT_MS = 10_000;
  const forceTimer = setTimeout(() => {
    console.error('Timeout 10s. Hard finish.');
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  // To prevent the timer from holding the event
  forceTimer.unref?.();

  try {
    console.log(`Received ${signal}, shutting down gracefully. Closing database connections...`);
    await closeAllPgConnectionsPg();
    console.log('Connections successfully closed');
    if (fileLogger?.asyncFinish) {
      await fileLogger.asyncFinish();
    }
    process.exit(exitCode);
  } catch (error) {
    console.error('Error when closing connections:', error);
    process.exit(1);
  }
}

/**
 * Shared: register graceful shutdown handlers (idempotent)
 */
export function registerGracefulShutdownHandlers (): void {
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
