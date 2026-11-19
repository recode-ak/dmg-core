import { describe, expect, it } from 'bun:test';
import manifest from '../../../package.json' with { type: 'json' };

describe('вход dmg-core/testing/example', () => {
  it('exports объявляет именованный вход на index.ts учебного модуля', () => {
    const exports: Record<string, string> = manifest.exports;
    expect(exports['./testing/example']).toBe('./src/testing/example/index.ts');
  });

  it('вход отдаёт приложение, его Def и контракты модуля todo', async () => {
    const entry = await import('dmg-core/testing/example');
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        'ExampleApp',
        'ExampleAppDef',
        'CreateTaskUcDef',
        'CompleteTaskUcDef',
        'CompleteTasksUcDef',
        'ListTasksUcDef',
        'ListAssignedTasksUcDef',
        'AssignTaskUcDef',
        'GetTaskAssigneeUcDef',
        'TaskEvents',
        'TaskErrors',
        'GetUserUcDef',
      ]),
    );
  });

  it('вход отдаёт Ar, Policy, правила задач и предел открытых задач', async () => {
    const entry = await import('dmg-core/testing/example');
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        'TaskAr',
        'TaskPolicy',
        'TaskRules',
        'OPEN_TASKS_LIMIT',
      ]),
    );
    expect(entry.OPEN_TASKS_LIMIT).toBe(3);
  });

  it('вход не отдаёт схему state, ArDef, DCS и внутренности users', async () => {
    const entry = await import('dmg-core/testing/example');
    const names = Object.keys(entry);
    for (const hidden of [
      'TaskState',
      'TaskArDef',
      'TaskCompletionDcs',
      'UserAr',
      'UserPolicy',
    ]) {
      expect(names).not.toContain(hidden);
    }
  });

  it('входа достаточно для правил клиента: state → TaskAr.readonly → Policy и правило', async () => {
    const { TaskAr, TaskPolicy, TaskRules, TaskErrors } = await import(
      'dmg-core/testing/example'
    );
    const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
    const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const onWire = (uuid: string) =>
      JSON.parse(
        JSON.stringify({
          uuid,
          ownerId: OWNER,
          title: 'Хлеб',
          status: 'open',
          createdAt: 0,
          updatedAt: 0,
          version: 0,
        }),
      );
    const person = (uuid: string) => ({ uuid, hasRole: () => false });

    const task = TaskAr.readonly(onWire(crypto.randomUUID()));
    const { canManage } = TaskPolicy.rules;
    expect(canManage.evaluate(person(OWNER), { task }).allowed).toBe(true);
    expect(canManage.evaluate(person(OTHER), { task }).allowed).toBe(false);

    const ownerTasks = [1, 2, 3].map(() =>
      TaskAr.readonly(onWire(crypto.randomUUID())),
    );
    expect(TaskRules.rules.withinOpenLimit.check({ ownerTasks })).toEqual(
      TaskErrors.TOO_MANY_OPEN.err({ limit: 3 }),
    );
  });
});
