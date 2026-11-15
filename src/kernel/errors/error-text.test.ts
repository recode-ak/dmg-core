import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { CoreErrors } from './core-errors';
import { type DomainError, ERROR_KINDS, type ErrorKind } from './error';
import { ErrorDef } from './error-def';
import { ErrorText } from './error-text';

const UUID = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';

const ToyErrors = ErrorDef.define('TOY', {
  BAD_INPUT: {
    kind: 'validation',
    label: 'Плохой ввод',
    description: 'Ввод не подошёл.',
    payload: v.object({ note: v.string() }),
  },
  DENIED: {
    kind: 'access',
    label: 'Доступ закрыт',
    description: 'Отказ без причины.',
    payload: v.object({ rule: v.string() }),
  },
  CLASH: {
    kind: 'conflict',
    label: 'Конфликт данных',
    description: 'Данные разошлись.',
    payload: v.object({ mark: v.string() }),
  },
  NO_LABEL: {
    kind: 'not_found',
    label: '',
    description: 'Ошибка без названия.',
  },
});

/** Ошибка каждого вида, ожидаемый текст и то, чего в тексте быть не должно. */
const BY_KIND: Record<
  ErrorKind,
  { error: DomainError; text: string; absent: string[] }
> = {
  validation: {
    error: CoreErrors.INPUT_VALIDATION.make({
      issues: [
        { path: 'title', message: 'Обязательное поле' },
        { path: '', message: 'Пустая команда' },
      ],
    }),
    text: 'Некорректные данные:\n- title: Обязательное поле\n- Пустая команда',
    absent: [],
  },
  unauthorized: {
    error: CoreErrors.UNAUTHORIZED.make({
      callerKind: 'guest',
      reason: 'personal',
    }),
    text: 'Вызов не разрешён',
    absent: ['guest', 'personal'],
  },
  access: {
    error: CoreErrors.ACCESS_DENIED.make({
      rule: 'owner',
      denyMessage: 'Задачей управляет только её владелец.',
    }),
    text: 'Задачей управляет только её владелец.',
    absent: ['owner'],
  },
  not_found: {
    error: CoreErrors.OPERATION_NOT_FOUND.make({ module: 'todo', uc: 'nope' }),
    text: 'Операция не найдена',
    absent: ['nope'],
  },
  conflict: {
    error: CoreErrors.VERSION_CONFLICT.make({ aggregate: 'task', uuid: UUID }),
    text: 'Данные изменились',
    absent: [UUID],
  },
  internal: {
    error: CoreErrors.OUTPUT_VALIDATION.make({
      issues: [{ path: 'secret', message: 'SECRET' }],
    }),
    text: 'Некорректный ответ',
    absent: ['secret', 'SECRET'],
  },
};

describe('ErrorText', () => {
  it.each(ERROR_KINDS)('вид %s — текст по таблице вида', (kind) => {
    const { error, text, absent } = BY_KIND[kind];
    const rendered = ErrorText.of(error).toString();
    expect(rendered).toBe(text);
    for (const secret of absent) expect(rendered).not.toContain(secret);
  });

  it('validation: summary — label, fields равны issues', () => {
    const issues = [
      { path: 'title', message: 'Обязательное поле' },
      { path: '', message: 'Пустая команда' },
    ];
    const text = ErrorText.of(CoreErrors.INPUT_VALIDATION.make({ issues }));
    expect(text.summary).toBe('Некорректные данные');
    expect(text.fields).toEqual(issues);
  });

  it('validation без проблем: только summary', () => {
    const text = ErrorText.of(CoreErrors.INPUT_VALIDATION.make({ issues: [] }));
    expect(text.fields).toEqual([]);
    expect(text.toString()).toBe('Некорректные данные');
  });

  it('validation с лишними ключами в issues: в fields — только path и message', () => {
    const error: DomainError = {
      ...CoreErrors.INPUT_VALIDATION.make({ issues: [] }),
      payload: {
        issues: [{ path: 'title', message: 'Слишком длинно', hint: 'MARK' }],
      },
    };
    const text = ErrorText.of(error);
    expect(text.fields).toEqual([{ path: 'title', message: 'Слишком длинно' }]);
    expect(JSON.stringify(text.fields)).not.toContain('MARK');
  });

  it('validation модуля с payload не по Issues: label, полей нет', () => {
    const text = ErrorText.of(ToyErrors.BAD_INPUT.make({ note: 'NOTE-MARK' }));
    expect(text.summary).toBe('Плохой ввод');
    expect(text.fields).toEqual([]);
    expect(text.toString()).toBe('Плохой ввод');
  });

  it('access модуля без denyMessage: label, без rule', () => {
    const text = ErrorText.of(ToyErrors.DENIED.make({ rule: 'owner' }));
    expect(text.toString()).toBe('Доступ закрыт');
    expect(text.toString()).not.toContain('owner');
  });

  it('access с пустым denyMessage: label', () => {
    const text = ErrorText.of(
      CoreErrors.ACCESS_DENIED.make({ rule: 'owner', denyMessage: '' }),
    );
    expect(text.summary).toBe('Доступ запрещён');
  });

  it('conflict модуля: label, метки payload нет', () => {
    const text = ErrorText.of(ToyErrors.CLASH.make({ mark: 'PAYLOAD-MARK' }));
    expect(text.toString()).toBe('Конфликт данных');
    expect(text.toString()).not.toContain('PAYLOAD-MARK');
  });

  it('internal: проблемы выхода не попадают в fields', () => {
    const text = ErrorText.of(BY_KIND.internal.error);
    expect(text.fields).toEqual([]);
  });

  it('DELEGATION_DENIED и SERVER_INTERNAL: свои label без payload', () => {
    const delegation = ErrorText.of(
      CoreErrors.DELEGATION_DENIED.make({ reason: 'expired' }),
    ).toString();
    expect(delegation).toBe('Делегирование не принято');
    expect(delegation).not.toContain('expired');
    expect(ErrorText.of(CoreErrors.SERVER_INTERNAL.make()).toString()).toBe(
      'Внутренняя ошибка',
    );
  });

  it('пустой label: Внутренняя ошибка', () => {
    expect(ErrorText.of(ToyErrors.NO_LABEL.make()).summary).toBe(
      'Внутренняя ошибка',
    );
  });

  it('вид вне ERROR_KINDS: Внутренняя ошибка', () => {
    const unknown = {
      ...CoreErrors.SERVER_INTERNAL.make(),
      kind: 'weird',
      label: 'Странная',
    } as unknown as DomainError;
    expect(ErrorText.of(unknown).summary).toBe('Внутренняя ошибка');
  });
});
