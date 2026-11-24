import { describe, expect, it } from 'bun:test';
import { CoreErrors } from '../../kernel/errors/core-errors';
import { ExampleAppDef } from '../../testing/example/platform/domain/example.app';
import {
  ArchiveDoneTasksJobDef,
  CreateTaskUcDef,
  ReleaseRemovedUserTasksErDef,
  TaskArDef,
  TaskErrors,
  TaskEvents,
  TaskRules,
  TodoModuleDef,
} from '../../testing/example/platform/domain/todo';
import { DomainIds } from './domain-ids';
import { DomainProvider } from './domain-provider';
import {
  LegacyAppDef,
  OddEvents,
  StrayArDef,
  StrayErrors,
  StrayEvents,
  StrayRuleDef,
  StrayUcDef,
} from './domain-provider.fixture';

describe('DomainIds: дерево id (Р-7)', () => {
  const domainIds = new DomainIds(ExampleAppDef);

  it('приложение — имя AppDef', () => {
    expect(domainIds.app()).toBe('example');
  });

  it('модуль — <app>/<m>', () => {
    expect(domainIds.module(TodoModuleDef)).toBe('example/todo');
  });

  it('агрегат — <app>/<m>/<a>', () => {
    expect(domainIds.aggregate(TaskArDef)).toBe('example/todo/task');
  });

  it('UC, ER и Job — дети модуля, не агрегата', () => {
    expect(domainIds.operation(CreateTaskUcDef)).toBe(
      'example/todo/createTask',
    );
    expect(domainIds.operation(ReleaseRemovedUserTasksErDef)).toBe(
      'example/todo/releaseRemovedUserTasks',
    );
    expect(domainIds.operation(ArchiveDoneTasksJobDef)).toBe(
      'example/todo/archiveDoneTasks',
    );
  });

  it('событие — <app>/<m>/<a>/<короткое имя>', () => {
    expect(domainIds.event(TaskEvents.created)).toBe(
      'example/todo/task/created',
    );
  });

  it('ошибка — <app>/<m>/<a>/<CODE>', () => {
    expect(domainIds.error(TaskErrors.NOT_FOUND)).toBe(
      'example/todo/task/TASK_NOT_FOUND',
    );
  });

  it('id правила — по агрегату-владельцу ошибки', () => {
    expect(domainIds.rule(TaskRules.rules.withinOpenLimit)).toBe(
      'example/todo/task/withinOpenLimit',
    );
  });

  it('событие с FQN не по MAN-08 — сегмент из полного имени', () => {
    expect(new DomainIds(LegacyAppDef).event(OddEvents.thing)).toBe(
      'legacy-app/legacy/thing/odd.name.thing',
    );
  });
});

describe('DomainIds: внешние id (Р-9)', () => {
  const domainIds = new DomainIds(ExampleAppDef);

  it('базовая ошибка ядра — dmg-core/<CODE>', () => {
    expect(domainIds.error(CoreErrors.UNAUTHORIZED)).toBe(
      'dmg-core/UNAUTHORIZED',
    );
  });

  it('агрегат и операция вне модулей — orphan/<dmg>/<name>', () => {
    expect(domainIds.aggregate(StrayArDef)).toBe(
      'dmg-core/orphan/aggregate/stray',
    );
    expect(domainIds.operation(StrayUcDef)).toBe(
      'dmg-core/orphan/useCase/strayQuery',
    );
  });

  it('событие и ошибка вне модулей — по FQN и коду', () => {
    expect(domainIds.event(StrayEvents.happened)).toBe(
      'dmg-core/orphan/event/lost.stray.happened',
    );
    expect(domainIds.error(StrayErrors.GONE)).toBe(
      'dmg-core/orphan/error/STRAY_GONE',
    );
  });

  it('правило с ошибкой вне модулей — сирота без модуля', () => {
    expect(domainIds.rule(StrayRuleDef)).toBe(
      'dmg-core/orphan/domainRule/strayCheck',
    );
  });
});

describe('DomainProvider.ids', () => {
  it('отдаёт те же id, что стоят в узлах графа', () => {
    const provider = new DomainProvider(ExampleAppDef);
    const nodeIds = new Set(provider.contribute().nodes.map((n) => n.id));
    expect(nodeIds.has(provider.ids.app())).toBe(true);
    expect(nodeIds.has(provider.ids.operation(CreateTaskUcDef))).toBe(true);
    expect(nodeIds.has(provider.ids.event(TaskEvents.created))).toBe(true);
    expect(nodeIds.has(provider.ids.error(TaskErrors.NOT_FOUND))).toBe(true);
  });
});
