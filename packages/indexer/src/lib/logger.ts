/**
 * Pino logger configuration
 */

import pino from 'pino';
import { getConfig } from './config';

let logger: pino.Logger | null = null;

/**
 * Get or create the logger instance
 */
export function getLogger(): pino.Logger {
  if (logger) {
    return logger;
  }

  const config = getConfig();
  const isDev = config.nodeEnv === 'development';

  logger = pino({
    level: config.logLevel,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: {
      service: 'polymarket-indexer',
      env: config.nodeEnv,
    },
  });

  return logger;
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(bindings: pino.Bindings): pino.Logger {
  return getLogger().child(bindings);
}
