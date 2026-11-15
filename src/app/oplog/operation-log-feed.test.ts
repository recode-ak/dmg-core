import { describe, expect, test } from 'bun:test';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { OperationLogFeed } from './operation-log-feed';
import type { OperationRecord } from './operation-record';

const AT = Date.UTC(2026, 9, 22, 10, 30, 5);

const record = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  at: AT,
  module: 'todo',
  op: 'completeTask',
  kind: 'useCase',
  caller: { kind: 'user', subjectId: 'u-1' },
  trace: { cause: { kind: 'request', requestId: 'r-1' }, correlationId: 'c-1' },
  input: {},
  result: { ok: true, output: {} },
  events: [],
  writes: [],
  durationMs: 1,
  ...patch,
});

const write = (changes?: OperationRecord['writes'][number]['changes']) => ({
  aggregate: 'task',
  uuid: 't-1',
  from: 1,
  to: 2,
  ...(changes ? { changes } : {}),
});

const feed = new OperationLogFeed();

describe('OperationLogFeed', () => {
  test('строка на запись: время, модуль.операция, кто, итог', () => {
    const lines = feed.lines([record()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2026-10-22');
    expect(lines[0]).toContain('10:30:05');
    expect(lines[0]).toContain('todo.completeTask');
    expect(lines[0]).toContain('u-1');
  });

  test('отказ в итоге — код ошибки в строке', () => {
    const lines = feed.lines([
      record({
        caller: { kind: 'guest' },
        result: {
          ok: false,
          error: CoreErrors.UNAUTHORIZED.make({ callerKind: 'guest' }),
        },
      }),
    ]);
    expect(lines[0]).toContain('guest');
    expect(lines[0]).toContain('UNAUTHORIZED');
  });

  test('без aggregate изменения не выводятся', () => {
    const lines = feed.lines([
      record({ writes: [write([{ path: 'title', from: 'a', to: 'b' }])] }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('title');
  });

  test('aggregate: изменения — строка «path: from → to»', () => {
    const lines = feed.lines(
      [record({ writes: [write([{ path: 'title', from: 'a', to: 'b' }])] })],
      { aggregate: 't-1' },
    );
    expect(lines.join('\n')).toContain('title: "a" → "b"');
  });

  test('aggregate: redacted — «path: [скрыто]», значений нет', () => {
    const lines = feed.lines(
      [record({ writes: [write([{ path: 'password', redacted: true }])] })],
      { aggregate: 't-1' },
    );
    const text = lines.join('\n');
    expect(text).toContain('password: [скрыто]');
    expect(text).not.toMatch(/password:.*→/);
  });

  test('aggregate: ValueDigest — «заменено, N байт, hash»', () => {
    const lines = feed.lines(
      [
        record({
          writes: [
            write([
              {
                path: 'body',
                from: 'x',
                to: { digest: true, size: 5000, hash: 'abc123def456' },
              },
            ]),
          ],
        }),
      ],
      { aggregate: 't-1' },
    );
    expect(lines.join('\n')).toContain('заменено, 5000 байт, abc123def456');
  });

  test('aggregate: запись без changes выводится строкой без падения', () => {
    const lines = feed.lines([record({ writes: [write()] })], {
      aggregate: 't-1',
    });
    expect(lines[0]).toContain('todo.completeTask');
  });

  test('aggregate: версии патча видны, чужие агрегаты записи не выводятся', () => {
    const lines = feed.lines(
      [
        record({
          writes: [
            {
              aggregate: 'task',
              uuid: 't-2',
              from: 5,
              to: 6,
              changes: [{ path: 'foreign', from: 1, to: 2 }],
            },
            write([{ path: 'title', from: 'a', to: 'b' }]),
          ],
        }),
      ],
      { aggregate: 't-1' },
    );
    const text = lines.join('\n');
    expect(text).toContain('1 → 2');
    expect(text).not.toContain('foreign');
  });

  test('порядок строк — порядок записей на входе', () => {
    const lines = feed.lines([record({ op: 'a' }), record({ op: 'b' })]);
    expect(lines[0]).toContain('todo.a');
    expect(lines[1]).toContain('todo.b');
  });
});
