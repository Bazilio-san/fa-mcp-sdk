import { createServer } from 'net';
import { logger as lgr } from '../logger.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.bgCyan('port-checker') });

/**
 * Checks if a port is available on the given host
 * @param port - Port number to check
 * @param host - Host address (default: '0.0.0.0')
 * @returns Promise that resolves to true if port is available, false if occupied
 */
export function isPortAvailable (port: number, host: string = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.on('error', () => {
      // Port is occupied
      resolve(false);
    });

    server.on('listening', () => {
      // Port is available
      server.close(() => {
        resolve(true);
      });
    });

    // Try to bind to the port
    server.listen(port, host);
  });
}

/**
 * Checks if a port is occupied and logs the result
 * @param port - Port number to check
 * @param host - Host address (default: '0.0.0.0')
 * @returns Promise that resolves to true if port is available, throws error if occupied
 */
export async function checkPortAvailability (port: number, host: string = '0.0.0.0', exitOnError: boolean = true): Promise<void> {
  const isAvailable = await isPortAvailable(port, host);

  if (!isAvailable) {
    const errorMessage = `Port ${port} is already in use on ${host}. Please stop the service using this port or configure a different port.`;
    if (exitOnError) {
      logger.error(errorMessage);
      process.exit(1);
    }
    throw new Error(errorMessage);
  }
}
