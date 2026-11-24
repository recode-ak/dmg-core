import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { UserCaller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import { Trace } from '#core/kernel/trace/trace';
import { TodoModuleDef } from '#core/testing/example/platform/domain/todo/index';
import type { TaskState } from '#core/testing/example/platform/domain/todo/state';
import {
  GetUserUcDef,
  type UserActivity,
  UserErrors,
  UsersModuleDef,
} from '#core/testing/example/platform/domain/users/contract';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';
import {
  expectErr,
  expectOk,
  StubFacade,
  testAppContext,
} from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { AssignTaskUc } from './assign-task.uc';

// Command с вызовом чужого модуля: `users` — `StubFacade` по Def из его
// контракта (ARC-06), решение над ответом — правило `assigneeActive`.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TASK = '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const as = (uuid: string) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => false });
const owner = as(OWNER);

let tasks: TaskRepoFake;
let users: StubFacade<typeof UsersModuleDef>;
let ctx: ReturnType<typeof testAppContext>;
let uc: AssignTaskUc;

/** Ответ `users` об исполнителе. */
const answer = (activity: UserActivity) =>
  users.answer(GetUserUcDef, () => ok(activity));

/** Задача владельца в базе — как от прежних сессий. */
const seed = (
  status: TaskState['status'] = 'open',
  assignment?: TaskState['assignment'],
) =>
  tasks.seed({
    uuid: TASK,
    ownerId: OWNER,
    title: 'Купить хлеб',
    status,
    createdAt: T0,
    updatedAt: T0,
    version: 0,
    ...(assignment && { assignment }),
  });

beforeEach(() => {
  tasks = new TaskRepoFake();
  users = new StubFacade(UsersModuleDef);
  answer({ userId: ASSIGNEE, active: true });
  ctx = testAppContext({ at: T1 });
  uc = new AssignTaskUc(
    { app: ctx.app, facades: new ModuleFacades([users]), tasks },
    TodoModuleDef,
  );
  seed();
});

const assign = (caller = owner, taskId = TASK) =>
  uc.handle({ taskId, assigneeId: ASSIGNEE }, caller, REQ);

/** Отказ: задачи не записаны, событий нет. */
function expectNothingWritten() {
  expect(tasks.saved).toEqual([]);
  expect(ctx.published).toEqual([]);
}

describe('AssignTaskUc', () => {
  it('назначает исполнителя открытой задаче, событие assigned', async () => {
    expect(expectOk(await assign())).toEqual({});

    const stored = tasks.restored(TASK)?.snapshot();
    expect(stored).toMatchObject({
      status: 'open',
      version: 1,
      assignment: { assigneeId: ASSIGNEE, assignedAt: T1 },
    });
    expect(ctx.published.map((e) => [e.name, e.payload])).toEqual([
      [
        'todo.task.assigned',
        { taskId: TASK, ownerId: OWNER, assigneeId: ASSIGNEE },
      ],
    ]);
  });

  it('тот же исполнитель — ok, без изменений и событий', async () => {
    const assignment = { assigneeId: ASSIGNEE, assignedAt: T0 };
    seed('open', assignment);

    expect(expectOk(await assign())).toEqual({});

    // Ar ничего не меняет; UC не ветвится по состоянию (API-01), поэтому
    // UoW записывает ту же версию — данные прежние.
    const stored = tasks.restored(TASK)?.snapshot();
    expect(stored).toMatchObject({ version: 0, updatedAt: T0, assignment });
    expect(ctx.published).toEqual([]);
  });

  it('другой исполнитель — unassigned прежнего, затем assigned нового', async () => {
    seed('open', { assigneeId: OWNER, assignedAt: T0 });

    expectOk(await assign());

    const ref = { taskId: TASK, ownerId: OWNER };
    expect(ctx.published.map((e) => [e.name, e.payload])).toEqual([
      ['todo.task.unassigned', { ...ref, assigneeId: OWNER }],
      ['todo.task.assigned', { ...ref, assigneeId: ASSIGNEE }],
    ]);
    expect(tasks.restored(TASK)?.snapshot().assignment).toEqual({
      assigneeId: ASSIGNEE,
      assignedAt: T1,
    });
  });

  it('users спрошен об исполнителе от имени UC с человеком пришедшего', async () => {
    expectOk(await assign());
    expect(users.received).toHaveLength(1);
    const [call] = users.received;
    expect(call?.def).toBe(GetUserUcDef);
    expect(call?.input).toEqual({ userId: ASSIGNEE });
    expect(call?.caller.from).toEqual(uc.ref);
    expect(call?.caller.person()).toBe(owner);
  });

  it('нет задачи — TASK_NOT_FOUND, users не спрошен', async () => {
    const missing = crypto.randomUUID();

    const res = await assign(owner, missing);

    expect(expectErr(res, 'TASK_NOT_FOUND').payload).toEqual({
      taskId: missing,
    });
    expect(users.received).toEqual([]);
    expectNothingWritten();
  });

  it('нет пользователя — USER_NOT_FOUND от users как есть', async () => {
    users.answer(GetUserUcDef, ({ userId }) =>
      UserErrors.NOT_FOUND.err({ userId }),
    );

    const res = await assign();

    expect(expectErr(res, 'USER_NOT_FOUND').payload).toEqual({
      userId: ASSIGNEE,
    });
    expectNothingWritten();
  });

  it('не владелец — ACCESS_DENIED', async () => {
    expectErr(await assign(as(ASSIGNEE)), 'ACCESS_DENIED');
    expectNothingWritten();
  });

  it('не владелец не узнаёт о пользователе: ACCESS_DENIED, users не спрошен (D-58)', async () => {
    users.answer(GetUserUcDef, ({ userId }) =>
      UserErrors.NOT_FOUND.err({ userId }),
    );

    expectErr(await assign(as(ASSIGNEE)), 'ACCESS_DENIED');
    expect(users.received).toEqual([]);
    expectNothingWritten();
  });

  it('исполнитель неактивен — TASK_ASSIGNEE_INACTIVE', async () => {
    answer({ userId: ASSIGNEE, active: false });

    const res = await assign();

    expect(expectErr(res, 'TASK_ASSIGNEE_INACTIVE').payload).toEqual({
      assigneeId: ASSIGNEE,
    });
    expectNothingWritten();
  });

  it('задача не открыта — TASK_NOT_ASSIGNABLE', async () => {
    seed('done');
    expectErr(await assign(), 'TASK_NOT_ASSIGNABLE');
    expectNothingWritten();
  });

  it('неактивный исполнитель и закрытая задача — отказ правила раньше перехода', async () => {
    seed('done');
    answer({ userId: ASSIGNEE, active: false });
    expectErr(await assign(), 'TASK_ASSIGNEE_INACTIVE');
  });
});
