import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import {
  type Caller,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import {
  TASK_BATCH_LIMIT,
  TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { TaskState } from '#core/testing/example/platform/domain/todo/state';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { CompleteTasksUc } from './complete-tasks.uc';

// Command над несколькими агрегатами: право — `canManageAll` над всем
// набором, переходы — `TaskCompletionDcs`; первый отказ — отказ всей
// команды, в UoW ничего не попадает.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const STRANGER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const as = (uuid: string, admin = false) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => admin });

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: CompleteTasksUc;

/** Задача в базе — как от прежних сессий; возвращает её uuid. */
const seed = (
  status: TaskState['status'] = 'open',
  ownerId = OWNER,
): string => {
  const uuid = crypto.randomUUID();
  tasks.seed({
    uuid,
    ownerId,
    title: 'Задача',
    status,
    createdAt: T0,
    updatedAt: T0,
    version: 0,
  });
  return uuid;
};

beforeEach(() => {
  tasks = new TaskRepoFake();
  ctx = testAppContext({ at: T1 });
  uc = new CompleteTasksUc(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
});

const complete = (taskIds: string[], caller: Caller<ExampleUser> = as(OWNER)) =>
  uc.handle({ taskIds }, caller, REQ);

/** Отказ: задачи не записаны, событий нет. */
function expectNothingWritten() {
  expect(tasks.saved).toEqual([]);
  expect(ctx.published).toEqual([]);
}

describe('CompleteTasksUc', () => {
  it('владелец выполняет выбранные задачи — все done, по событию completed на каждую', async () => {
    const first = seed();
    const second = seed();

    expect(expectOk(await complete([first, second]))).toEqual({});

    for (const uuid of [first, second]) {
      expect(tasks.restored(uuid)?.snapshot()).toMatchObject({
        status: 'done',
        completedAt: T1,
        version: 1,
      });
    }
    expect(ctx.published.map((e) => [e.name, e.payload])).toEqual([
      ['todo.task.completed', { taskId: first, ownerId: OWNER }],
      ['todo.task.completed', { taskId: second, ownerId: OWNER }],
    ]);
  });

  it('одна из задач уже выполнена — TASK_ALREADY_DONE, ничего не записано', async () => {
    const open = seed();
    const done = seed('done');

    expectErr(await complete([open, done]), 'TASK_ALREADY_DONE');
    expectNothingWritten();
  });

  it('одна из задач в архиве — TASK_ARCHIVED, ничего не записано', async () => {
    const open = seed();
    const archived = seed('archived');

    expectErr(await complete([open, archived]), 'TASK_ARCHIVED');
    expectNothingWritten();
  });

  it('одна из задач чужая — ACCESS_DENIED, ничего не записано', async () => {
    const own = seed();
    const foreign = seed('open', STRANGER);

    expectErr(await complete([own, foreign]), 'ACCESS_DENIED');
    expectNothingWritten();
  });

  it('одной задачи нет — TASK_NOT_FOUND с её id, ничего не записано', async () => {
    const own = seed();
    const missing = crypto.randomUUID();

    const res = await complete([own, missing]);

    expect(expectErr(res, 'TASK_NOT_FOUND').payload).toEqual({
      taskId: missing,
    });
    expectNothingWritten();
  });

  it('администратор выполняет чужие задачи', async () => {
    const first = seed();
    const second = seed('open', STRANGER);

    expectOk(await complete([first, second], as(STRANGER, true)));

    expect(tasks.restored(first)?.isDone()).toBe(true);
    expect(tasks.restored(second)?.isDone()).toBe(true);
  });

  it('повтор id во входе — задача выполняется один раз, одно событие', async () => {
    const task = seed();

    expectOk(await complete([task, task]));

    expect(tasks.saved).toHaveLength(1);
    expect(ctx.published.map((e) => e.name)).toEqual(['todo.task.completed']);
  });

  it('системный вызов — UNAUTHORIZED: callers только user', async () => {
    const job = new SystemCaller<ExampleUser>({
      kind: 'job',
      module: 'todo',
      name: 'archiveDoneTasks',
    });
    expectErr(await complete([seed()], job), 'UNAUTHORIZED');
    expectNothingWritten();
  });
});

describe('CompleteTasksUc — граница набора', () => {
  const ids = (count: number) => Array.from({ length: count }, () => seed());

  it('ровно предел задач — все выполнены', async () => {
    const taskIds = ids(TASK_BATCH_LIMIT);
    expectOk(await complete(taskIds));
    expect(ctx.published).toHaveLength(TASK_BATCH_LIMIT);
  });

  it('больше предела — INPUT_VALIDATION по полю taskIds', async () => {
    const res = await complete(ids(TASK_BATCH_LIMIT + 1));
    const issues = expectErr(res, 'INPUT_VALIDATION').payload.issues;
    expect(issues.map((i) => i.path)).toEqual(['taskIds']);
    expectNothingWritten();
  });

  it('пустой набор — INPUT_VALIDATION по полю taskIds', async () => {
    const res = await complete([]);
    const issues = expectErr(res, 'INPUT_VALIDATION').payload.issues;
    expect(issues.map((i) => i.path)).toEqual(['taskIds']);
  });

  it('id не uuid — INPUT_VALIDATION', async () => {
    expectErr(await complete(['x']), 'INPUT_VALIDATION');
  });
});
