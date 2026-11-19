import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '#core/app/events/event-bus';
import type { EventEnvelope } from '#core/app/events/event-envelope';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { UserCaller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import { Trace } from '#core/kernel/trace/trace';
import type { ExampleUser } from '#core/testing/example/shared/app-user';
import {
  ArchiveDoneTasksJobDef,
  AssignTaskUcDef,
  CompleteTaskUcDef,
  CreateTaskUcDef,
  ListAssignedTasksUcDef,
  ListTasksUcDef,
} from '#core/testing/example/todo/index';
import {
  GetUserUcDef,
  UserEvents,
  UsersModuleDef,
} from '#core/testing/example/users/contract';
import { expectOk, StubFacade, testAppContext } from '#core/testing/index';
import { TaskJsonRepo } from './infra/task.json-repo';
import { createTodoModule } from './todo.module';

// Smoke модуля: настоящий репозиторий во временном каталоге, фасад `users` —
// `StubFacade` по Def из его контракта (ARC-06), вход — `handle`, `runJob`,
// реакции — через `subscribe` на шине приложения.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
/** След нового запроса: каждая команда — своё намерение клиента (D-49, D-56). */
const req = (): Trace => Trace.fromRequest({ requestId: crypto.randomUUID() });
const as = (uuid: string) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => false });
const owner = as(OWNER);
const STRANGER = '1f2e3d4c-5b6a-4978-8a1b-2c3d4e5f6a7b';

/**
 * Шина в памяти, которая помнит запущенные обработчики: `delivered()`
 * дожидается их завершения — без таймеров (`MemoryBus` их не возвращает).
 */
function awaitingBus() {
  const handlers = new Map<
    string,
    Set<(envelope: EventEnvelope) => Promise<void>>
  >();
  const pending: Promise<void>[] = [];
  const bus: EventBus = {
    publish: (envelope) => {
      for (const handler of handlers.get(envelope.name) ?? []) {
        pending.push(handler(envelope));
      }
    },
    subscribe: (def, handler) => {
      // Имя события уникально (D-10): конверт под этим именем имеет тип def.
      const wrapped = (envelope: EventEnvelope) =>
        handler(envelope as Parameters<typeof handler>[0]);
      const set = handlers.get(def.name) ?? new Set();
      set.add(wrapped);
      handlers.set(def.name, set);
      return () => set.delete(wrapped);
    },
  };
  return { bus, delivered: () => Promise.all(pending) };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todo-module-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeModule() {
  const { bus, delivered } = awaitingBus();
  const ctx = testAppContext({ at: Date.UTC(2026, 9, 1) });
  const app = { ...ctx.app, bus };
  const tasks = new TaskJsonRepo(join(dir, 'tasks.json'));
  const users = new StubFacade(UsersModuleDef).answer(
    GetUserUcDef,
    ({ userId }) => ok({ userId, active: true }),
  );
  const module = createTodoModule({
    app,
    facades: new ModuleFacades([users]),
    tasks,
  });
  return { module, tasks, users, bus, delivered };
}

/** State задачи из репозитория — эталон полного выхода query. */
const stored = async (tasks: TaskJsonRepo, taskId: string) => {
  const task = await tasks.findById(taskId);
  if (!task) throw new Error(`Задача ${taskId} не найдена`);
  return task.view();
};

const create = async (
  module: ReturnType<typeof createTodoModule>,
  title = 'Хлеб',
  by: UserCaller<ExampleUser> = owner,
) =>
  expectOk(await module.dispatch(CreateTaskUcDef.command({ title }), by, req()))
    .taskId;

describe('createTodoModule', () => {
  it('собирает модуль по карте Def', () => {
    expect(makeModule().module.def.name).toBe('todo');
  });

  it('smoke: создать → назначить → выполнить → список командами', async () => {
    const { module, tasks, users } = makeModule();
    const taskId = await create(module);

    expectOk(
      await module.dispatch(
        AssignTaskUcDef.command({ taskId, assigneeId: ASSIGNEE }),
        owner,
        req(),
      ),
    );
    expectOk(
      await module.dispatch(
        CompleteTaskUcDef.command({ taskId }),
        owner,
        req(),
      ),
    );
    const list = expectOk(
      await module.dispatch(ListTasksUcDef.command({}), owner, req()),
    );

    expect(list).toMatchObject([
      { uuid: taskId, ownerId: OWNER, title: 'Хлеб', status: 'done' },
    ]);
    expect((await tasks.findById(taskId))?.isAssignedTo(ASSIGNEE)).toBe(true);
    expect(users.received.map((c) => c.input)).toEqual([{ userId: ASSIGNEE }]);
  });

  it('runJob: выполненная задача уходит в архив', async () => {
    const { module, tasks } = makeModule();
    const taskId = await create(module);
    expectOk(
      await module.dispatch(
        CompleteTaskUcDef.command({ taskId }),
        owner,
        req(),
      ),
    );

    const report = await module.runJob(
      ArchiveDoneTasksJobDef,
      Trace.forJob(ArchiveDoneTasksJobDef),
    );

    expect(expectOk(report)).toEqual({ processed: 1, failed: 0 });
    expect((await tasks.findById(taskId))?.isArchived()).toBe(true);
  });

  it('subscribe: users.user.removed на шине — задачи пользователя в архиве', async () => {
    const { module, tasks, bus, delivered } = makeModule();
    const taskId = await create(module);
    const off = module.subscribe();

    bus.publish({
      ...UserEvents.removed.make({ userId: OWNER }),
      eventId: 'e-removed',
      occurredAt: Date.UTC(2026, 9, 2),
      aggregateId: OWNER,
      cause: { kind: 'request', requestId: 'r-2' },
      correlationId: 'r-2',
    });
    await delivered();
    off();

    expect((await tasks.findById(taskId))?.isArchived()).toBe(true);
  });

  it('listTasks на реальном репозитории: выход содержит полный state, чужие задачи не отдаются', async () => {
    const { module, tasks } = makeModule();
    const mine = await create(module, 'Моя задача', owner);
    const theirs = await create(module, 'Чужая тайна', as(ASSIGNEE));

    const list = expectOk(
      await module.dispatch(ListTasksUcDef.command({}), owner, req()),
    );

    expect(list).toEqual([await stored(tasks, mine)]);
    const wire = JSON.stringify(list);
    expect(wire).not.toContain(theirs);
    expect(wire).not.toContain(ASSIGNEE);
    expect(wire).not.toContain('Чужая тайна');
  });

  it('listTasks: архивные задачи не отдаются', async () => {
    const { module } = makeModule();
    const taskId = await create(module);
    expectOk(
      await module.dispatch(
        CompleteTaskUcDef.command({ taskId }),
        owner,
        req(),
      ),
    );
    await module.runJob(
      ArchiveDoneTasksJobDef,
      Trace.forJob(ArchiveDoneTasksJobDef),
    );

    const list = expectOk(
      await module.dispatch(ListTasksUcDef.command({}), owner, req()),
    );

    expect(list).toEqual([]);
  });

  it('listAssignedTasks на реальном репозитории: только назначенные вызывающему, третьему — пусто', async () => {
    const { module, tasks } = makeModule();
    const assigned = await create(module, 'Назначенная');
    await create(module, 'Не назначенная');
    expectOk(
      await module.dispatch(
        AssignTaskUcDef.command({ taskId: assigned, assigneeId: ASSIGNEE }),
        owner,
        req(),
      ),
    );

    const mineForAssignee = expectOk(
      await module.dispatch(
        ListAssignedTasksUcDef.command({}),
        as(ASSIGNEE),
        req(),
      ),
    );
    const forStranger = expectOk(
      await module.dispatch(
        ListAssignedTasksUcDef.command({}),
        as(STRANGER),
        req(),
      ),
    );

    expect(mineForAssignee).toEqual([await stored(tasks, assigned)]);
    expect(forStranger).toEqual([]);
  });

  it('listAssignedTasks: архивные назначенные не отдаются', async () => {
    const { module } = makeModule();
    const taskId = await create(module);
    expectOk(
      await module.dispatch(
        AssignTaskUcDef.command({ taskId, assigneeId: ASSIGNEE }),
        owner,
        req(),
      ),
    );
    expectOk(
      await module.dispatch(
        CompleteTaskUcDef.command({ taskId }),
        owner,
        req(),
      ),
    );
    await module.runJob(
      ArchiveDoneTasksJobDef,
      Trace.forJob(ArchiveDoneTasksJobDef),
    );

    const list = expectOk(
      await module.dispatch(
        ListAssignedTasksUcDef.command({}),
        as(ASSIGNEE),
        req(),
      ),
    );

    expect(list).toEqual([]);
  });
});
