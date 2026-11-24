import { beforeEach, describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { EventReactionDef } from '#core/domain/contracts/event-reaction-def';
import { JobDef } from '#core/domain/contracts/job-def';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { EventDef } from '#core/domain/events/event-def';
import { allowAll } from '#core/domain/policy/rule';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import type { DomainError } from '#core/kernel/errors/error';
import { ErrorDef } from '#core/kernel/errors/error-def';
import { F } from '#core/kernel/fields/fields';
import { TaskArDef } from '#core/testing/example/platform/domain/todo/index';
import type { OperationRecord } from './operation-record';
import { RecordMask } from './record-mask';

// Маскирование записи лога по Def операции (D-86): вход, выход и payload
// ошибки — схемами Def; `writes` маскирует UoW, здесь они как есть.

const SECRET = 'пароль-42';
const PIN = '4321';

const SecretErrors = ErrorDef.define('SECRET', {
  LEAKED: {
    kind: 'conflict',
    label: 'Секрет раскрыт',
    description: 'Ошибка с помеченным полем payload.',
    payload: v.object({
      pin: F.sensitive(F.string('Пин')),
      tries: F.int('Попытки'),
    }),
  },
});

const OtherErrors = ErrorDef.define('OTHER', {
  FAILED: {
    kind: 'conflict',
    label: 'Сбой',
    description: 'Ошибка другого модуля — её схемы в Def операции нет.',
    payload: v.object({ detail: v.string() }),
  },
  BARE: { kind: 'conflict', label: 'Без payload', description: 'Пустой.' },
});

const SignInUcDef = UseCaseDef.define({
  name: 'signIn',
  label: 'Вход',
  description: 'UC с помеченными полями входа и выхода.',
  type: 'command',
  aggregate: TaskArDef,
  callers: ['user'],
  policy: allowAll,
  input: v.object({
    login: F.string('Логин'),
    password: F.sensitive(F.string('Пароль')),
  }),
  output: v.object({
    token: F.sensitive(F.string('Токен')),
    login: v.string(),
  }),
  errors: [SecretErrors.LEAKED],
});

const NoteEvents = EventDef.define('notes.note', {
  posted: {
    label: 'Заметка опубликована',
    description: 'Событие с помеченным полем payload.',
    payload: v.object({
      noteId: v.string(),
      text: F.sensitive(F.string('Текст')),
    }),
  },
});

const ReadNoteErDef = EventReactionDef.define({
  name: 'readNote',
  label: 'Прочитать заметку',
  description: 'ER на событие с помеченным полем.',
  on: [NoteEvents.posted],
  touches: [TaskArDef],
});

const SweepJobDef = JobDef.define({
  name: 'sweep',
  label: 'Уборка',
  description: 'Job без схем входа и выхода.',
  schedule: { kind: 'dailyAt', hour: 3, minute: 0 },
  scans: [TaskArDef],
});

const record = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  at: 0,
  module: 'todo',
  op: 'signIn',
  kind: 'useCase',
  caller: { kind: 'user', subjectId: 'u-1' },
  trace: { cause: { kind: 'request', requestId: 'r-1' }, correlationId: 'r-1' },
  input: { login: 'nur', password: SECRET },
  result: { ok: true, output: { token: SECRET, login: 'nur' } },
  events: [],
  writes: [],
  durationMs: 1,
  ...patch,
});

const failed = (error: DomainError) => record({ result: { ok: false, error } });

let warns: string[];

beforeEach(() => {
  warns = [];
});

const ucMask = () => RecordMask.of(SignInUcDef, (m) => warns.push(m));

describe('RecordMask — UC', () => {
  test('вход: помеченное поле [redacted], значения нет в строке', () => {
    const masked = ucMask().apply(record());
    expect(masked.input).toEqual({ login: 'nur', password: '[redacted]' });
    expect(JSON.stringify(masked)).not.toContain(SECRET);
  });

  test('вход как пришёл: невалидный и с лишними ключами — помеченное всё равно скрыто', () => {
    const input = { password: 42, extra: 'x' };
    expect(ucMask().apply(record({ input })).input).toEqual({
      password: '[redacted]',
      extra: 'x',
    });
  });

  test('выход: помеченное поле [redacted]', () => {
    expect(ucMask().apply(record()).result).toEqual({
      ok: true,
      output: { token: '[redacted]', login: 'nur' },
    });
  });

  test('сводка выхода query — как есть', () => {
    const masked = ucMask().apply(record({ result: { ok: true, size: 12 } }));
    expect(masked.result).toEqual({ ok: true, size: 12 });
  });

  test('payload ошибки из errors — по code, помеченное [redacted]', () => {
    const error = SecretErrors.LEAKED.make({ pin: PIN, tries: 3 });
    const masked = ucMask().apply(failed(error));
    expect(masked.result).toEqual({
      ok: false,
      error: { ...error, payload: { pin: '[redacted]', tries: 3 } },
    });
    expect(JSON.stringify(masked)).not.toContain(PIN);
  });

  test('ошибка ядра — по схеме CoreErrors, без пометок как есть', () => {
    const error = CoreErrors.UNAUTHORIZED.make({ callerKind: 'guest' });
    expect(ucMask().apply(failed(error)).result).toEqual({ ok: false, error });
  });

  test('код вне errors и CoreErrors с payload — payload целиком [redacted]', () => {
    const error = OtherErrors.FAILED.make({ detail: SECRET });
    expect(ucMask().apply(failed(error)).result).toEqual({
      ok: false,
      error: { ...error, payload: '[redacted]' },
    });
  });

  test('код вне errors без payload — ошибка как есть', () => {
    const error = OtherErrors.BARE.make();
    expect(ucMask().apply(failed(error)).result).toEqual({ ok: false, error });
  });

  test('остальные поля записи — как есть, writes не трогаются', () => {
    const writes = [
      {
        aggregate: 'task',
        uuid: 't-1',
        from: 0,
        to: 1,
        changes: [{ path: 'title', redacted: true as const }],
      },
    ];
    const events = [{ name: 'todo.task.created', eventId: 'e-1' }];
    const source = record({ writes, events });
    const { input: _i, result: _r, ...rest } = ucMask().apply(source);
    const { input: _si, result: _sr, ...expected } = source;
    expect(rest).toEqual(expected);
  });

  test('сбой маскирования — значение целиком [redacted] и warn', () => {
    const LazyUcDef = UseCaseDef.define({
      ...SignInUcDef,
      name: 'lazyIn',
      input: v.object({
        nested: v.lazy(() => v.object({ secret: F.sensitive(v.string()) })),
      }),
    });
    const masked = RecordMask.of(LazyUcDef, (m) => warns.push(m)).apply(
      record({ input: { nested: { secret: SECRET } } }),
    );
    expect(masked.input).toBe('[redacted]');
    expect(warns).toHaveLength(1);
  });
});

describe('RecordMask — ER', () => {
  const envelope = {
    ...NoteEvents.posted.make({ noteId: 'n-1', text: SECRET }),
    eventId: 'e-1',
    occurredAt: 0,
    aggregateId: 'n-1',
    cause: { kind: 'request', requestId: 'r-1' },
    correlationId: 'c-1',
  };
  const erRecord = (input: unknown) =>
    record({
      kind: 'eventReaction',
      input,
      result: { ok: true, output: null },
    });

  test('вход — конверт: маскируется только payload схемой события', () => {
    const masked = RecordMask.of(ReadNoteErDef).apply(erRecord(envelope));
    expect(masked.input).toEqual({
      ...envelope,
      payload: { noteId: 'n-1', text: '[redacted]' },
    });
    expect(JSON.stringify(masked)).not.toContain(SECRET);
  });

  test('сбой маскирования записи — вход и выход целиком [redacted] и warn', () => {
    const broken = {
      name: NoteEvents.posted.name,
      get payload(): never {
        throw new Error('payload недоступен');
      },
    };
    const masked = RecordMask.of(ReadNoteErDef, (m) => warns.push(m)).apply(
      record({ kind: 'eventReaction', input: broken }),
    );
    expect(masked.input).toBe('[redacted]');
    expect(masked.result).toEqual({ ok: true, output: '[redacted]' });
    expect(warns).toHaveLength(1);
  });

  test('выход ER схемы не имеет — как есть', () => {
    const masked = RecordMask.of(ReadNoteErDef).apply(erRecord(envelope));
    expect(masked.result).toEqual({ ok: true, output: null });
  });
});

describe('RecordMask — Job', () => {
  test('вход null и отчёт — как есть', () => {
    const source = record({
      kind: 'job',
      input: null,
      result: { ok: true, output: { archived: 2 } },
    });
    expect(RecordMask.of(SweepJobDef).apply(source)).toEqual(source);
  });
});
