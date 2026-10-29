import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import {
  type Caller,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import type { ExampleUser } from '#core/testing/example/shared/app-user';
import { TodoModuleDef } from '#core/testing/example/todo/index';
import type { TaskState } from '#core/testing/example/todo/state';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { CompleteTaskUc } from './complete-task.uc';

// Command над существующим агрегатом с Policy: каждый недопустимый статус —
// отказ перехода Ar (`rejects`), UC статусы не сравнивает.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const STRANGER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TASK = '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const as = (uuid: string, admin = false) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => admin });

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: CompleteTaskUc;

const seed = (status: TaskState['status'] = 'open') =>
  tasks.seed({
    uuid: TASK,
    ownerId: OWNER,
    title: 'Купить хлеб',
    status,
    createdAt: T0,
    updatedAt: T0,
    version: 0,
  });

beforeEach(() => {
  tasks = new TaskRepoFake();
  ctx = testAppContext({ at: T1 });
  uc = new CompleteTaskUc(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
  seed();
});

const complete = (caller: Caller<ExampleUser> = as(OWNER), taskId = TASK) =>
  uc.handle({ taskId }, caller, REQ);

/** Отказ: задачи не записаны, событий нет. */
function expectNothingWritten() {
  expect(tasks.saved).toEqual([]);
  expect(ctx.published).toEqual([]);
}

describe('CompleteTaskUc', () => {
  it('владелец выполняет открытую задачу — done, событие completed', async () => {
    expect(expectOk(await complete())).toEqual({});
    expect(tasks.restored(TASK)?.snapshot()).toMatchObject({
      status: 'done',
      completedAt: T1,
      version: 1,
    });
    expect(ctx.published.map((e) => [e.name, e.payload])).toEqual([
      ['todo.task.completed', { taskId: TASK, ownerId: OWNER }],
    ]);
  });

  it('администратор выполняет чужую задачу', async () => {
    expectOk(await complete(as(STRANGER, true)));
    expect(tasks.restored(TASK)?.isDone()).toBe(true);
  });

  it('нет задачи — TASK_NOT_FOUND', async () => {
    const missing = crypto.randomUUID();
    const res = await complete(as(OWNER), missing);
    expect(expectErr(res, 'TASK_NOT_FOUND').payload).toEqual({
      taskId: missing,
    });
  });

  it('не владелец — ACCESS_DENIED', async () => {
    expectErr(await complete(as(STRANGER)), 'ACCESS_DENIED');
    expectNothingWritten();
  });

  it('уже выполнена — TASK_ALREADY_DONE', async () => {
    seed('done');
    expectErr(await complete(), 'TASK_ALREADY_DONE');
    expectNothingWritten();
  });

  it('в архиве — TASK_ARCHIVED', async () => {
    seed('archived');
    expectErr(await complete(), 'TASK_ARCHIVED');
    expectNothingWritten();
  });

  it('системный вызов — UNAUTHORIZED: callers только user и delegate', async () => {
    const job = new SystemCaller<ExampleUser>({
      kind: 'job',
      module: 'todo',
      name: 'archiveDoneTasks',
    });
    expectErr(await complete(job), 'UNAUTHORIZED');
  });
});

// Ожидаемая версия от клиента (D-57): клиент присылает версию задачи,
// которую видел; устаревшее действие отклоняется без записи.
describe('CompleteTaskUc — ожидаемая версия', () => {
  const completeSeen = (expectedVersion: number) =>
    uc.handle({ taskId: TASK, expectedVersion }, as(OWNER), REQ);

  it('совпала — задача выполнена', async () => {
    expectOk(await completeSeen(0));
    expect(tasks.restored(TASK)?.isDone()).toBe(true);
  });

  it('расходится — VERSION_CONFLICT, ничего не записано', async () => {
    const res = await completeSeen(1);
    expect(expectErr(res, 'VERSION_CONFLICT').payload).toEqual({
      aggregate: 'task',
      uuid: TASK,
    });
    expectNothingWritten();
  });

  it('не прислана — сверки нет', async () => {
    expectOk(await complete());
  });

  it('отрицательная — INPUT_VALIDATION по полю expectedVersion', async () => {
    const res = await completeSeen(-1);
    const issues = expectErr(res, 'INPUT_VALIDATION').payload.issues;
    expect(issues.map((i) => i.path)).toEqual(['expectedVersion']);
  });
});
