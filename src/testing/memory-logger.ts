import type { Logger } from '../app/context';
import type { LogRecord } from './memory-logger.types';

export type { LogRecord } from './memory-logger.types';

/** Логгер для тестов: складывает записи в `records` вместе с `meta`. */
export class MemoryLogger implements Logger {
  constructor(readonly records: LogRecord[] = []) {}

  debug(source: string, message: string, meta?: LogRecord['meta']): void {
    this.write('debug', source, message, meta);
  }

  info(source: string, message: string, meta?: LogRecord['meta']): void {
    this.write('info', source, message, meta);
  }

  warn(source: string, message: string, meta?: LogRecord['meta']): void {
    this.write('warn', source, message, meta);
  }

  error(source: string, message: string, meta?: LogRecord['meta']): void {
    this.write('error', source, message, meta);
  }

  private write(
    level: LogRecord['level'],
    source: string,
    message: string,
    meta: LogRecord['meta'],
  ): void {
    const record = { level, source, message };
    this.records.push(meta === undefined ? record : { ...record, meta });
  }
}
