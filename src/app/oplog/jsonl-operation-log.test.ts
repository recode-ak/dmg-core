import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { JsonlOperationLog, type TruncatedValue } from './jsonl-operation-log';
import type { OperationRecord, ValueDigest } from './operation-record';

const DAY_1 = Date.UTC(2026, 9, 21, 23, 59);
const DAY_2 = Date.UTC(2026, 9, 22, 0, 1);

const record = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  at: DAY_1,
  module: 'todo',
  op: 'completeTask',
  kind: 'useCase',
  caller: { kind: 'user', subjectId: 'u-1' },
  trace: { cause: { kind: 'request', requestId: 'r-1' }, correlationId: 'r-1' },
  input: { taskId: 't-1' },
  result: { ok: true, output: {} },
  events: [{ name: 'todo.task.completed', eventId: 'e-1' }],
  writes: [{ aggregate: 'task', uuid: 't-1', from: 0, to: 1 }],
  durationMs: 3,
  ...patch,
});

let root: string;
let dir: string;

/** Записи файла дня — по строке JSON на запись. */
function lines(day: string): unknown[] {
  return readFileSync(join(dir, `${day}.jsonl`), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oplog-'));
  dir = join(root, 'oplog');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('JsonlOperationLog', () => {
  test('каталог создаётся только при первой записи', async () => {
    const log = new JsonlOperationLog(dir);
    expect(existsSync(dir)).toBe(false);
    await log.append(record());
    expect(existsSync(dir)).toBe(true);
  });

  test('запись — строка JSON в файле своего дня (UTC)', async () => {
    const log = new JsonlOperationLog(dir);
    await log.append(record({ at: DAY_1, op: 'a' }));
    await log.append(record({ at: DAY_1, op: 'b' }));
    await log.append(record({ at: DAY_2, op: 'c' }));
    expect(lines('2026-10-21').map((r) => (r as OperationRecord).op)).toEqual([
      'a',
      'b',
    ]);
    expect(lines('2026-10-22')).toEqual([record({ at: DAY_2, op: 'c' })]);
  });

  test('параллельные записи не перемешиваются', async () => {
    const log = new JsonlOperationLog(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        log.append(record({ op: `op${i}` })),
      ),
    );
    expect(lines('2026-10-21')).toHaveLength(20);
  });

  test('отказ пишется целиком', async () => {
    const log = new JsonlOperationLog(dir);
    const error = CoreErrors.UNAUTHORIZED.make({ callerKind: 'guest' });
    await log.append(record({ result: { ok: false, error } }));
    expect(lines('2026-10-21')).toEqual([
      record({ result: { ok: false, error } }),
    ]);
  });

  test('большой вход обрезается по порогу с пометкой', async () => {
    const log = new JsonlOperationLog(dir, { maxBytes: 100 });
    const input = { text: 'я'.repeat(500) };
    await log.append(record({ input }));
    const [written] = lines('2026-10-21') as OperationRecord[];
    const size = new TextEncoder().encode(JSON.stringify(input)).length;
    const truncated = written?.input as TruncatedValue;
    expect(truncated).toEqual({
      truncated: true,
      bytes: size,
      head: expect.any(String),
    });
    expect(new TextEncoder().encode(truncated.head).length).toBeLessThanOrEqual(
      100,
    );
    expect(JSON.stringify(input).startsWith(truncated.head)).toBe(true);
  });

  test('большой выход обрезается, малый вход — как есть', async () => {
    const log = new JsonlOperationLog(dir, { maxBytes: 100 });
    const output = { items: Array.from({ length: 50 }, (_, i) => i) };
    await log.append(record({ result: { ok: true, output } }));
    const [written] = lines('2026-10-21') as OperationRecord[];
    expect(written?.input).toEqual({ taskId: 't-1' });
    expect(written?.result).toEqual({
      ok: true,
      output: {
        truncated: true,
        bytes: expect.any(Number),
        head: expect.any(String),
      },
    });
  });

  test('большой payload ошибки обрезается, код — как есть (D-73)', async () => {
    const log = new JsonlOperationLog(dir, { maxBytes: 100 });
    const error = CoreErrors.INPUT_VALIDATION.make({
      issues: Array.from({ length: 20 }, (_, i) => ({
        path: `items.${i}`,
        message: 'Неверное значение',
      })),
    });
    await log.append(record({ result: { ok: false, error } }));
    const [written] = lines('2026-10-21') as OperationRecord[];
    expect(written?.result).toEqual({
      ok: false,
      error: {
        ...error,
        payload: {
          truncated: true,
          bytes: expect.any(Number),
          head: expect.any(String),
        },
      },
    });
  });

  test('сводка выхода query — как есть', async () => {
    const log = new JsonlOperationLog(dir, { maxBytes: 100 });
    await log.append(record({ result: { ok: true, size: 5000 } }));
    const [written] = lines('2026-10-21') as OperationRecord[];
    expect(written?.result).toEqual({ ok: true, size: 5000 });
  });

  test('порог по умолчанию — 8 КБ', async () => {
    const log = new JsonlOperationLog(dir);
    await log.append(record({ input: { text: 'a'.repeat(8000) } }));
    await log.append(record({ input: { text: 'a'.repeat(9000) } }));
    const [small, big] = lines('2026-10-21') as OperationRecord[];
    expect(small?.input).toEqual({ text: 'a'.repeat(8000) });
    expect(big?.input).toMatchObject({ truncated: true });
  });
});

describe('JsonlOperationLog — патч записи: дайджест крупных значений (D-86)', () => {
  /** Запись с одним изменённым полем. */
  const patched = (from: unknown, to: unknown): OperationRecord =>
    record({
      writes: [
        {
          aggregate: 'task',
          uuid: 't-1',
          from: 0,
          to: 1,
          changes: [{ path: 'body', from, to }],
        },
      ],
    });

  /** Изменения первой записи агрегата из первой строки файла дня. */
  function writtenChanges(): unknown[] {
    const [written] = lines('2026-10-21') as OperationRecord[];
    return [...(written?.writes[0]?.changes ?? [])];
  }

  const digestOf = (value: unknown): ValueDigest => {
    const json = JSON.stringify(value);
    return {
      digest: true,
      size: new TextEncoder().encode(json).length,
      hash: createHash('sha256').update(json).digest('hex').slice(0, 12),
    };
  };

  test('значение больше порога — дайджест: размер и начало sha256', async () => {
    const log = new JsonlOperationLog(dir, { valueMaxBytes: 50 });
    const big = { text: 'я'.repeat(100) };
    await log.append(patched('мало', big));
    expect(writtenChanges()).toEqual([
      { path: 'body', from: 'мало', to: digestOf(big) },
    ]);
  });

  test('одинаковые значения — одинаковый hash', async () => {
    const log = new JsonlOperationLog(dir, { valueMaxBytes: 50 });
    const big = 'a'.repeat(200);
    await log.append(patched(big, big));
    const [change] = writtenChanges() as {
      from: ValueDigest;
      to: ValueDigest;
    }[];
    expect(change?.from).toEqual(digestOf(big));
    expect(change?.to.hash).toBe(change?.from.hash ?? '');
  });

  test('порог по умолчанию — 1 КБ', async () => {
    const log = new JsonlOperationLog(dir);
    const small = 'a'.repeat(1000);
    const big = 'a'.repeat(1100);
    await log.append(patched(small, big));
    expect(writtenChanges()).toEqual([
      { path: 'body', from: small, to: digestOf(big) },
    ]);
  });

  test('порог настраивается отдельно от maxBytes', async () => {
    const log = new JsonlOperationLog(dir, {
      maxBytes: 10,
      valueMaxBytes: 5000,
    });
    const value = 'a'.repeat(2000);
    await log.append(patched(null, value));
    expect(writtenChanges()).toEqual([{ path: 'body', from: null, to: value }]);
  });

  test('redacted — как есть, не дайджест', async () => {
    const log = new JsonlOperationLog(dir, { valueMaxBytes: 1 });
    await log.append(
      record({
        writes: [
          {
            aggregate: 'task',
            uuid: 't-1',
            from: 0,
            to: 1,
            changes: [{ path: 'title', redacted: true }],
          },
        ],
      }),
    );
    expect(writtenChanges()).toEqual([{ path: 'title', redacted: true }]);
  });

  test('from: undefined у созданного — поля нет в строке', async () => {
    const log = new JsonlOperationLog(dir, { valueMaxBytes: 50 });
    await log.append(patched(undefined, 'новое'));
    expect(writtenChanges()).toEqual([{ path: 'body', to: 'новое' }]);
    expect(writtenChanges()[0]).not.toHaveProperty('from');
  });

  test('запись без changes — как есть', async () => {
    const log = new JsonlOperationLog(dir, { valueMaxBytes: 1 });
    await log.append(record());
    const [written] = lines('2026-10-21') as OperationRecord[];
    expect(written?.writes).toEqual([
      { aggregate: 'task', uuid: 't-1', from: 0, to: 1 },
    ]);
  });
});
