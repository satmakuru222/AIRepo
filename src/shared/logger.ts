import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  base: { service: 'follow-up-concierge' },
  serializers: pino.stdSerializers,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}
