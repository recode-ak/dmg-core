import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { AggregateDef } from '../domain/aggregate/aggregate-def';
import {
  ArchiveDoneErDef,
  CompleteTaskUcDef,
  GetUserUcDef,
  ListTasksUcDef,
  RemindJobDef,
  TaskArDef,
  TaskErrors,
  TaskEvents,
  TodoModuleDef,
  UserArDef,
  UsersModuleDef,
} from '../domain/contracts/contracts.fixture';
import { ModuleDef } from '../domain/contracts/module-def';
import { EventDef } from '../domain/events/event-def';
import { DomainRuleDef } from '../domain/rules/domain-rule-def';
import { ErrorDef } from '../kernel/errors/error-def';
import { BaseEntityFields } from '../kernel/fields/fields';
import { ok } from '../kernel/result/result';
import { DefIndex } from './def-index';

const NotDone = DomainRuleDef.define({
  name: 'notDone',
  label: 'Не выполнена',
  description: 'Задачу ещё не завершили.',
  error: TaskErrors.ALREADY_DONE,
  check: () => ok(undefined),
});

const Stray = ErrorDef.define('STRAY', {
  LOST: { kind: 'conflict', label: 'Чужая', description: 'Вне модулей.' },
});

const Orphan = DomainRuleDef.define({
  name: 'orphan',
  label: 'Сирота',
  description: 'Ошибка вне модулей индекса.',
  error: Stray.LOST,
  check: () => ok(undefined),
});

describe('DefIndex', () => {
  const index = DefIndex.from([TodoModuleDef]);

  it('modules — замыкание корней по dependsOn, без повторов', () => {
    expect(index.modules).toEqual([TodoModuleDef, UsersModuleDef]);
    const twice = DefIndex.from([TodoModuleDef, UsersModuleDef]);
    expect(twice.modules).toEqual([TodoModuleDef, UsersModuleDef]);
  });

  it('operations() — операции всех модулей индекса', () => {
    expect(index.operations()).toEqual([
      CompleteTaskUcDef,
      ListTasksUcDef,
      ArchiveDoneErDef,
      RemindJobDef,
      GetUserUcDef,
    ]);
  });

  it('moduleOf — модуль-владелец агрегата или операции', () => {
    expect(index.moduleOf(TaskArDef)).toBe(TodoModuleDef);
    expect(index.moduleOf(UserArDef)).toBe(UsersModuleDef);
    expect(index.moduleOf(GetUserUcDef)).toBe(UsersModuleDef);
    expect(index.moduleOf(RemindJobDef)).toBe(TodoModuleDef);
    expect(DefIndex.from([UsersModuleDef]).moduleOf(TaskArDef)).toBeUndefined();
  });

  it('aggregateOf — агрегат-владелец события или ошибки', () => {
    expect(index.aggregateOf(TaskEvents.completed)).toBe(TaskArDef);
    expect(index.aggregateOf(TaskErrors.NOT_FOUND)).toBe(TaskArDef);
    expect(index.aggregateOf(Stray.LOST)).toBeUndefined();
  });

  it('eventLocalName — остаток FQN после `<m>.<a>.`; иначе полное имя', () => {
    expect(index.eventLocalName(TaskEvents.completed)).toBe('completed');
    const Nested = EventDef.define('deep.box.sub', {
      made: {
        label: 'Сделано',
        description: 'Имя с лишним сегментом.',
        payload: v.object({}),
      },
    });
    const BoxArDef = AggregateDef.define({
      name: 'box',
      label: 'Коробка',
      description: 'Агрегат с событием не по MAN-08.',
      state: v.object({ ...BaseEntityFields }),
      events: Nested,
      errors: {},
    });
    const deep = DefIndex.from([
      ModuleDef.define({
        name: 'deep',
        label: 'Глубокий',
        description: 'Модуль с событием не по MAN-08.',
        dependsOn: [],
        aggregates: [BoxArDef],
        useCases: [],
        reactions: [],
        jobs: [],
      }),
    ]);
    expect(deep.eventLocalName(Nested.made)).toBe('deep.box.sub.made');
    expect(deep.eventLocalName(TaskEvents.completed)).toBe(
      TaskEvents.completed.name,
    );
  });

  it('ruleId — по агрегату-владельцу ошибки правила (D-40)', () => {
    expect(index.ruleId(NotDone)).toEqual({
      id: 'todo.task.notDone',
      module: 'todo',
    });
    expect(index.ruleId(Orphan)).toEqual({ id: '?.?.orphan', module: '?' });
  });
});
