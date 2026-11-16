import type { LogLevel } from '../app/logger/console-logger.types';

/** Запись `MemoryLogger`; `meta` — как передана, поля нет, если её не было. */
export type LogRecord = {
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
};
