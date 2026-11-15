import { describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from '#core/testing/index';
import { JsonlOperationLog } from './jsonl-operation-log';
import type { OperationRecord } from './operation-record';

const day = (d: number) => Date.UTC(2026, 9, d, 12, 0);

const record = (at: number): OperationRecord => ({
  at,
  module: 'todo',
  op: 'completeTask',
  kind: 'useCase',
  caller: { kind: 'user', subjectId: 'u-1' },
  trace: { cause: { kind: 'request', requestId: 'r-1' }, correlationId: 'r-1' },
  input: {},
  result: { ok: true, output: {} },
  events: [],
  writes: [],
  durationMs: 1,
});

const temp = useTempDir('oplog-retain-');

/** Каталог лога с пустыми файлами указанных имён. */
function seed(...names: string[]): string {
  const dir = temp().path;
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), '');
  return dir;
}

const files = (dir: string) => readdirSync(dir).sort();

describe('JsonlOperationLog: retainDays (D-85)', () => {
  test('старше срока удалены, последние N дней включая текущий остаются', async () => {
    const dir = seed(
      '2026-10-18.jsonl',
      '2026-10-19.jsonl',
      '2026-10-20.jsonl',
      '2026-10-21.jsonl',
    );
    const log = new JsonlOperationLog(dir, { retainDays: 3 });
    await log.append(record(day(22)));
    expect(files(dir)).toEqual([
      '2026-10-20.jsonl',
      '2026-10-21.jsonl',
      '2026-10-22.jsonl',
    ]);
  });

  test('первая запись после старта запускает проверку', async () => {
    const dir = seed('2026-09-01.jsonl');
    await new JsonlOperationLog(dir, { retainDays: 7 }).append(record(day(22)));
    expect(files(dir)).toEqual(['2026-10-22.jsonl']);
  });

  test('проверка один раз на день и повторяется при смене дня', async () => {
    const dir = seed();
    const log = new JsonlOperationLog(dir, { retainDays: 2 });
    await log.append(record(day(22)));
    writeFileSync(join(dir, '2026-10-01.jsonl'), '');
    await log.append(record(day(22) + 1000));
    expect(files(dir)).toContain('2026-10-01.jsonl');
    await log.append(record(day(23)));
    expect(files(dir)).toEqual(['2026-10-22.jsonl', '2026-10-23.jsonl']);
  });

  test('без retainDays ничего не удаляется', async () => {
    const dir = seed('2020-01-01.jsonl', '2026-10-01.jsonl');
    await new JsonlOperationLog(dir).append(record(day(22)));
    expect(files(dir)).toEqual([
      '2020-01-01.jsonl',
      '2026-10-01.jsonl',
      '2026-10-22.jsonl',
    ]);
  });

  test('посторонние файлы и каталоги не трогаются', async () => {
    const dir = seed(
      'notes.txt',
      'backup.jsonl',
      '2026-10-1.jsonl',
      '2020-01-01.jsonl.bak',
    );
    mkdirSync(join(dir, '2019-01-01'));
    await new JsonlOperationLog(dir, { retainDays: 1 }).append(record(day(22)));
    expect(files(dir)).toEqual([
      '2019-01-01',
      '2020-01-01.jsonl.bak',
      '2026-10-1.jsonl',
      '2026-10-22.jsonl',
      'backup.jsonl',
      'notes.txt',
    ]);
  });

  test('сбой удаления не блокирует append', async () => {
    // Каталог с именем дня: удалить его как файл нельзя.
    const dir = seed();
    mkdirSync(join(dir, '2026-09-01.jsonl'));
    const log = new JsonlOperationLog(dir, { retainDays: 1 });
    await log.append(record(day(22)));
    await log.append(record(day(22) + 1000));
    expect(files(dir)).toContain('2026-10-22.jsonl');
  });

  test('retainDays не целое ≥ 1 — ошибка в конструкторе', () => {
    for (const retainDays of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => new JsonlOperationLog(seed(), { retainDays })).toThrow(
        'retainDays',
      );
    }
  });

  test('запись из будущего не удаляет свежие файлы: срок от системных часов', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dir = seed(`${today}.jsonl`);
    const log = new JsonlOperationLog(dir, { retainDays: 1 });
    await log.append(record(Date.UTC(2099, 0, 1, 12, 0)));
    expect(files(dir)).toEqual([`${today}.jsonl`, '2099-01-01.jsonl']);
  });
});
