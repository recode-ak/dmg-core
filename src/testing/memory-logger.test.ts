import { describe, expect, test } from 'bun:test';
import type { Logger } from '../app/context';
import { type LogRecord, MemoryLogger } from './memory-logger';

describe('MemoryLogger', () => {
  test('складывает записи всех уровней по порядку', () => {
    const logger = new MemoryLogger();
    logger.error('b', 'ошибка');
    logger.debug('a', 'отладка');
    logger.info('a', 'сведения');
    logger.warn('b', 'предупреждение');
    expect(logger.records).toStrictEqual([
      { level: 'error', source: 'b', message: 'ошибка' },
      { level: 'debug', source: 'a', message: 'отладка' },
      { level: 'info', source: 'a', message: 'сведения' },
      { level: 'warn', source: 'b', message: 'предупреждение' },
    ]);
  });

  test('хранит meta записи: приложение пишет через порт Logger', () => {
    const logger = new MemoryLogger();
    const app: Logger = logger;
    app.debug('a', 'отладка', { step: 1 });
    app.info('a', 'сведения', { step: 2 });
    app.warn('b', 'предупреждение', { uc: 'createTask' });
    app.error('b', 'ошибка', { code: 'X', error: 'текст броска' });
    expect(logger.records.map((r) => r.meta)).toStrictEqual([
      { step: 1 },
      { step: 2 },
      { uc: 'createTask' },
      { code: 'X', error: 'текст броска' },
    ]);
  });

  test('meta видна поиску утечки по JSON записей', () => {
    const logger = new MemoryLogger();
    logger.error('b', 'сбой', { error: 'Купить хлеб' });
    expect(JSON.stringify(logger.records)).toContain('Купить хлеб');
  });

  test('пишет в переданный массив', () => {
    const records: LogRecord[] = [];
    new MemoryLogger(records).info('x', 'сообщение');
    expect(records).toEqual([
      { level: 'info', source: 'x', message: 'сообщение' },
    ]);
  });
});
