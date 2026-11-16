import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { AggregateDef } from '../domain/aggregate/aggregate-def';
import { AppDef } from '../domain/contracts/app-def';
import {
  ArchiveDoneErDef,
  CompleteTaskUcDef,
  RemindJobDef,
  TaskArDef,
  TaskErrors,
  TaskPolicy,
  TodoModuleDef,
} from '../domain/contracts/contracts.fixture';
import { EventReactionDef } from '../domain/contracts/event-reaction-def';
import { JobDef } from '../domain/contracts/job-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { UseCaseDef } from '../domain/contracts/use-case-def';
import { EventDef } from '../domain/events/event-def';
import { PolicyDef } from '../domain/policy/policy-def';
import { DomainRuleDef } from '../domain/rules/domain-rule-def';
import { RulesDef } from '../domain/rules/rules-def';
import { Def } from '../index';
import { ErrorDef } from '../kernel/errors/error-def';
import { BaseEntityFields, F } from '../kernel/fields/fields';
import { ok } from '../kernel/result/result';
import { normalize } from './normalize';

const objectSchema = expect.objectContaining({ type: 'object' });

describe('normalize', () => {
  it('UC: personal — false по умолчанию, true при объявлении (D-89)', () => {
    expect(normalize(CompleteTaskUcDef)).toMatchObject({ personal: false });
    const personal = UseCaseDef.define({
      ...CompleteTaskUcDef,
      personal: true,
    });
    expect(normalize(personal)).toMatchObject({ personal: true });
  });

  it('UC ссылается на доменное правило по имени', () => {
    const notDone = DomainRuleDef.define({
      name: 'notDone',
      label: 'Задача не выполнена',
      description: 'Действие допустимо только над невыполненной задачей.',
      error: TaskErrors.ALREADY_DONE,
      check: (_: unknown) => ok(),
    });
    const uc = UseCaseDef.define({ ...CompleteTaskUcDef, rules: [notDone] });
    expect(normalize(uc)).toMatchObject({ rules: ['notDone'] });
  });

  it('модуль: состав по именам, фасада нет (D-42)', () => {
    expect(normalize(TodoModuleDef)).toEqual({
      dmg: 'module',
      name: 'todo',
      label: 'Задачи',
      description: 'Список дел.',
      visible: false,
      external: false,
      dependsOn: ['users'],
      aggregates: ['task'],
      useCases: ['completeTask', 'listTasks'],
      reactions: ['archiveDone'],
      jobs: ['remind'],
    });
  });

  it('стабильность: одинаковый Def — одинаковая сериализация; отказы переходов — коды', () => {
    const NoteErrors = ErrorDef.define('NOTE', {
      CLOSED: {
        kind: 'conflict',
        label: 'Закрыта',
        description: 'Уже закрыта.',
      },
    });
    const build = () =>
      AggregateDef.define({
        name: 'note',
        label: 'Заметка',
        description: 'Заметка со статусом.',
        state: v.object({
          ...BaseEntityFields,
          status: F.picklist(['draft', 'closed'], 'Статус'),
        }),
        statuses: {
          draft: { label: 'Черновик' },
          closed: { label: 'Закрыта' },
        },
        transitions: {
          close: {
            from: ['draft'],
            to: 'closed',
            rejects: { closed: NoteErrors.CLOSED },
          },
        },
        events: {},
        errors: NoteErrors,
      });
    const a = normalize(build());
    expect(JSON.stringify(a)).toBe(JSON.stringify(normalize(build())));
    expect(a).toMatchObject({
      statuses: { draft: { label: 'Черновик' }, closed: { label: 'Закрыта' } },
      transitions: {
        close: {
          from: ['draft'],
          to: 'closed',
          rejects: { closed: 'NOTE_CLOSED' },
        },
      },
    });
  });

  it.each([
    [
      'ошибка',
      () =>
        ErrorDef.define('V', {
          A: { kind: 'conflict', label: 'Л', description: 'О.', visible: true },
        }).A,
    ],
    [
      'событие',
      () =>
        EventDef.define('v.e', {
          done: {
            label: 'Л',
            description: 'О.',
            visible: true,
            payload: v.object({}),
          },
        }).done,
    ],
    ['агрегат', () => AggregateDef.define({ ...TaskArDef, visible: true })],
    ['политика', () => PolicyDef.define({ ...TaskPolicy, visible: true })],
    [
      'доменное правило',
      () =>
        DomainRuleDef.define({
          name: 'r',
          label: 'Л',
          description: 'О.',
          visible: true,
          error: TaskErrors.ALREADY_DONE,
          check: (_: unknown) => ok(),
        }),
    ],
    [
      'правила',
      () =>
        RulesDef.define({
          name: 'rs',
          label: 'Л',
          description: 'О.',
          visible: true,
          rules: {},
        }),
    ],
    ['UC', () => UseCaseDef.define({ ...CompleteTaskUcDef, visible: true })],
    [
      'ER',
      () => EventReactionDef.define({ ...ArchiveDoneErDef, visible: true }),
    ],
    ['Job', () => JobDef.define({ ...RemindJobDef, visible: true })],
    ['модуль', () => ModuleDef.define({ ...TodoModuleDef, visible: true })],
    [
      'приложение',
      () =>
        AppDef.define({
          name: 'app',
          label: 'Л',
          description: 'О.',
          visible: true,
          modules: [TodoModuleDef],
        }),
    ],
  ] as const)(
    'признак visible: true из спеки попадает в форму — %s',
    (_kind, build) => {
      expect(normalize(build())).toMatchObject({ visible: true });
    },
  );

  it('чужой вид: normalize(Def) возвращает форму вида, Def — из корня пакета', () => {
    class ScreenDef extends Def<'home'> {
      readonly dmg = 'screen';
      normalize(): { readonly dmg: 'screen'; readonly name: string } {
        return { dmg: this.dmg, name: this.name };
      }
    }
    const screen = new ScreenDef({
      name: 'home',
      label: 'Главная',
      description: 'Экран.',
    });
    expect(normalize(screen)).toEqual({ dmg: 'screen', name: 'home' });
  });
});
