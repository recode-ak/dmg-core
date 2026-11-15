import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { useTempDir } from '#core/testing/index';
import { OperationLogReader } from './operation-log-reader';
import type { OperationRecord } from './operation-record';

const LEGACY_DIR = join(import.meta.dir, 'fixtures/legacy');

const D21 = Date.UTC(2026, 9, 21, 12, 0);
const D22 = Date.UTC(2026, 9, 22, 12, 0);
const D23 = Date.UTC(2026, 9, 23, 12, 0);

const record = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  at: D21,
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

const temp = useTempDir('oplog-reader-');

/** Файл дня в каталоге лога: по строке JSON на запись (строка-строка — как есть). */
function writeDay(day: string, ...rows: (OperationRecord | string)[]): void {
  mkdirSync(temp().path, { recursive: true });
  writeFileSync(
    join(temp().path, `${day}.jsonl`),
    rows
      .map((r) => `${typeof r === 'string' ? r : JSON.stringify(r)}\n`)
      .join(''),
  );
}

function reader(dir = temp().path) {
  const warnings: string[] = [];
  return {
    warnings,
    reader: new OperationLogReader(dir, (m) => warnings.push(m)),
  };
}

const ops = (rows: readonly OperationRecord[]) => rows.map((r) => r.op);

describe('OperationLogReader: фильтры', () => {
  test('без фильтра — все записи каталога по возрастанию at', async () => {
    writeDay(
      '2026-10-22',
      record({ at: D22 + 5, op: 'd' }),
      record({ at: D22, op: 'c' }),
    );
    writeDay(
      '2026-10-21',
      record({ at: D21 + 5, op: 'b' }),
      record({ at: D21, op: 'a' }),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({}))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('request: цепочка по correlationId — UC, реакция, Job, вложенный вызов', async () => {
    const chain = (op: string, at: number, kind: OperationRecord['kind']) =>
      record({
        op,
        at,
        kind,
        trace: {
          cause: { kind: 'request', requestId: 'r-9' },
          correlationId: 'chain',
        },
      });
    writeDay(
      '2026-10-21',
      chain('uc', D21, 'useCase'),
      record({ op: 'other', at: D21 + 1 }),
      chain('nested', D21 + 2, 'useCase'),
      chain('reaction', D21 + 3, 'eventReaction'),
      chain('job', D21 + 4, 'job'),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({ request: 'chain' }))).toEqual([
      'uc',
      'nested',
      'reaction',
      'job',
    ]);
  });

  test('aggregate: записи с writes этого uuid, чужие и без writes — нет', async () => {
    writeDay(
      '2026-10-21',
      record({
        op: 'create',
        at: D21,
        writes: [{ aggregate: 'task', uuid: 't-1', from: null, to: 1 }],
      }),
      record({
        op: 'foreign',
        at: D21 + 1,
        writes: [{ aggregate: 'task', uuid: 't-2', from: 0, to: 1 }],
      }),
      record({ op: 'read', at: D21 + 2 }),
      record({
        op: 'two',
        at: D21 + 3,
        writes: [
          { aggregate: 'task', uuid: 't-2', from: 1, to: 2 },
          { aggregate: 'task', uuid: 't-1', from: 1, to: 2 },
        ],
      }),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({ aggregate: 't-1' }))).toEqual(['create', 'two']);
  });

  test('subject: user, delegate (по subjectId) и system с person', async () => {
    writeDay(
      '2026-10-21',
      record({
        op: 'user',
        at: D21,
        caller: { kind: 'user', subjectId: 'u-1' },
      }),
      record({
        op: 'other',
        at: D21 + 1,
        caller: { kind: 'user', subjectId: 'u-2' },
      }),
      record({ op: 'guest', at: D21 + 2, caller: { kind: 'guest' } }),
      record({
        op: 'delegate',
        at: D21 + 3,
        caller: {
          kind: 'delegate',
          subjectId: 'u-1',
          actorId: 'a-1',
          delegationId: 'd-1',
        },
      }),
      record({
        op: 'system',
        at: D21 + 4,
        caller: {
          kind: 'system',
          from: { kind: 'job', module: 'todo', name: 'sweep' },
          person: { kind: 'user', subjectId: 'u-1' },
        },
      }),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({ subject: 'u-1' }))).toEqual([
      'user',
      'delegate',
      'system',
    ]);
  });

  test('module и op', async () => {
    writeDay(
      '2026-10-21',
      record({ op: 'a', at: D21, module: 'todo' }),
      record({ op: 'a', at: D21 + 1, module: 'user' }),
      record({ op: 'b', at: D21 + 2, module: 'todo' }),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({ module: 'todo' }))).toEqual(['a', 'b']);
    expect((await r.read({ op: 'a' })).map((x) => x.module)).toEqual([
      'todo',
      'user',
    ]);
  });

  test('failed: только записи с ошибкой в итоге', async () => {
    const error = CoreErrors.UNAUTHORIZED.make({ callerKind: 'guest' });
    writeDay(
      '2026-10-21',
      record({ op: 'ok', at: D21 }),
      record({ op: 'fail', at: D21 + 1, result: { ok: false, error } }),
      record({ op: 'query', at: D21 + 2, result: { ok: true, size: 10 } }),
    );
    const { reader: r } = reader();
    expect(ops(await r.read({ failed: true }))).toEqual(['fail']);
  });

  test('since/until: дата YYYY-MM-DD — границы дня включительно (UTC)', async () => {
    writeDay('2026-10-21', record({ op: 'd21', at: D21 }));
    writeDay(
      '2026-10-22',
      record({ op: 'd22a', at: Date.UTC(2026, 9, 22, 0, 0) }),
      record({ op: 'd22b', at: Date.UTC(2026, 9, 22, 23, 59, 59, 999) }),
    );
    writeDay('2026-10-23', record({ op: 'd23', at: D23 }));
    const { reader: r } = reader();
    expect(ops(await r.read({ since: '2026-10-22' }))).toEqual([
      'd22a',
      'd22b',
      'd23',
    ]);
    expect(ops(await r.read({ until: '2026-10-22' }))).toEqual([
      'd21',
      'd22a',
      'd22b',
    ]);
    expect(
      ops(await r.read({ since: '2026-10-22', until: '2026-10-22' })),
    ).toEqual(['d22a', 'd22b']);
  });

  test('since/until: ISO-время — точная граница', async () => {
    writeDay(
      '2026-10-22',
      record({ op: 'a', at: Date.UTC(2026, 9, 22, 9, 59, 59) }),
      record({ op: 'b', at: Date.UTC(2026, 9, 22, 10, 0, 0) }),
      record({ op: 'c', at: Date.UTC(2026, 9, 22, 10, 30, 0) }),
      record({ op: 'd', at: Date.UTC(2026, 9, 22, 10, 30, 1) }),
    );
    const { reader: r } = reader();
    expect(
      ops(
        await r.read({
          since: '2026-10-22T10:00:00Z',
          until: '2026-10-22T10:30:00Z',
        }),
      ),
    ).toEqual(['b', 'c']);
  });

  test('ISO-время без смещения — UTC, не пояс процесса', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Almaty';
    try {
      writeDay(
        '2026-10-22',
        record({ op: 'a', at: Date.UTC(2026, 9, 22, 9, 59) }),
        record({ op: 'b', at: Date.UTC(2026, 9, 22, 10, 0) }),
      );
      const { reader: r } = reader();
      expect(ops(await r.read({ since: '2026-10-22T10:00' }))).toEqual(['b']);
    } finally {
      process.env.TZ = tz;
    }
  });

  test('несуществующая или неполная дата — ошибка', async () => {
    writeDay('2026-10-22', record());
    const { reader: r } = reader();
    for (const since of ['2026-02-30', '2026', '2026-13-01', 'вчера']) {
      await expect(r.read({ since })).rejects.toThrow(since);
    }
  });

  test('файлы вне диапазона дат не читаются', async () => {
    writeDay(
      '2026-10-20',
      'битая строка вне диапазона',
      record({ op: 'old', at: D21 - 86_400_000 }),
    );
    writeDay('2026-10-22', record({ op: 'in', at: D22 }));
    writeDay('2026-10-24', 'ещё битая');
    const { reader: r, warnings } = reader();
    expect(
      ops(await r.read({ since: '2026-10-21', until: '2026-10-23' })),
    ).toEqual(['in']);
    expect(warnings).toEqual([]);
  });

  test('фильтры комбинируются по И', async () => {
    writeDay(
      '2026-10-21',
      record({
        op: 'hit',
        at: D21,
        module: 'todo',
        caller: { kind: 'user', subjectId: 'u-1' },
      }),
      record({
        op: 'hit',
        at: D21 + 1,
        module: 'user',
        caller: { kind: 'user', subjectId: 'u-1' },
      }),
      record({
        op: 'hit',
        at: D21 + 2,
        module: 'todo',
        caller: { kind: 'user', subjectId: 'u-2' },
      }),
      record({
        op: 'miss',
        at: D21 + 3,
        module: 'todo',
        caller: { kind: 'user', subjectId: 'u-1' },
      }),
    );
    const { reader: r } = reader();
    const found = await r.read({ module: 'todo', op: 'hit', subject: 'u-1' });
    expect(found.map((x) => x.at)).toEqual([D21]);
  });
});

describe('OperationLogReader: формат файлов', () => {
  test('запись без changes и без writes читается как есть', async () => {
    writeDay(
      '2026-10-21',
      record({
        op: 'plain',
        writes: [{ aggregate: 'task', uuid: 't-1', from: 0, to: 1 }],
      }),
    );
    const { reader: r } = reader();
    const [found] = await r.read({ aggregate: 't-1' });
    expect(found?.writes[0]?.changes).toBeUndefined();
  });

  test('битая строка — пропуск и warn с файлом и номером строки', async () => {
    writeDay(
      '2026-10-21',
      record({ op: 'a', at: D21 }),
      '{не json',
      record({ op: 'b', at: D21 + 1 }),
    );
    const { reader: r, warnings } = reader();
    expect(ops(await r.read({}))).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2026-10-21.jsonl');
    expect(warnings[0]).toContain('2');
  });

  test('строка без module, op, kind или at — пропуск и warn', async () => {
    const { module: _, ...noModule } = record({ op: 'x' });
    writeDay(
      '2026-10-21',
      record({ op: 'a', at: D21 }),
      JSON.stringify(noModule),
      JSON.stringify({ at: D21, module: 'todo', op: 'y' }),
      JSON.stringify({ module: 'todo', op: 'z', kind: 'useCase' }),
      '[]',
    );
    const { reader: r, warnings } = reader();
    expect(ops(await r.read({}))).toEqual(['a']);
    expect(warnings.map((w) => w.split(':')[1])).toEqual(['2', '3', '4', '5']);
  });

  test('посторонние файлы каталога не читаются', async () => {
    writeDay('2026-10-21', record({ op: 'a' }));
    writeFileSync(join(temp().path, 'notes.txt'), 'не лог\n');
    writeFileSync(join(temp().path, 'backup.jsonl'), 'не лог\n');
    const { reader: r, warnings } = reader();
    expect(ops(await r.read({}))).toEqual(['a']);
    expect(warnings).toEqual([]);
  });

  test('старый формат (без writes): запись читается, цепочка по correlationId', async () => {
    const { reader: r, warnings } = reader(LEGACY_DIR);
    const chain = await r.read({ request: 'tg:1004' });
    expect(chain.map((x) => `${x.kind}:${x.module}.${x.op}`)).toEqual([
      'useCase:user.getUserByTelegramId',
      'useCase:user.getUser',
      'useCase:stream.completeStudent',
      'eventReaction:peer-review.createStudentCampaign',
      'useCase:user.getUser',
    ]);
    expect(
      await r.read({ aggregate: 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0' }),
    ).toEqual([]);
    expect(await r.read({ failed: true })).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
