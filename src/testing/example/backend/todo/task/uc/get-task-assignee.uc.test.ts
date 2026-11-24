import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import {
  type OperationRef,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import { TodoModuleDef } from '#core/testing/example/platform/domain/todo/index';
import type { TaskState } from '#core/testing/example/platform/domain/todo/state';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { GetTaskAssigneeUc } from './get-task-assignee.uc';

// Системный query (`callers: ['system']`, `allowAll`): исполнитель задачи —
// получатели уведомлений; человек за системным вызовом не нужен.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TASK = '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10';
const T0 = Date.UTC(2026, 9, 1);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const from: OperationRef = {
  kind: 'useCase',
  module: 'notify',
  name: 'deliver',
};
const system = new SystemCaller<ExampleUser>(from);

const task = (assigneeId?: string): TaskState => ({
  uuid: TASK,
  ownerId: OWNER,
  title: 'Купить хлеб',
  status: 'open',
  createdAt: T0,
  updatedAt: T0,
  version: 0,
  ...(assigneeId && { assignment: { assigneeId, assignedAt: T0 } }),
});

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: GetTaskAssigneeUc;

beforeEach(() => {
  tasks = new TaskRepoFake();
  ctx = testAppContext({ at: T0 });
  uc = new GetTaskAssigneeUc(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
});

describe('GetTaskAssigneeUc', () => {
  it('системный вызов без человека — assigneeId назначенной задачи, ничего не записано', async () => {
    tasks.seed(task(ASSIGNEE));

    const res = await uc.handle({ taskId: TASK }, system, REQ);

    expect(expectOk(res)).toEqual({ assigneeId: ASSIGNEE });
    expect(tasks.saved).toEqual([]);
    expect(ctx.published).toEqual([]);
  });

  it('задача без исполнителя — пустой ответ', async () => {
    tasks.seed(task());
    expect(expectOk(await uc.handle({ taskId: TASK }, system, REQ))).toEqual(
      {},
    );
  });

  it('нет задачи — TASK_NOT_FOUND', async () => {
    const missing = crypto.randomUUID();
    const res = await uc.handle({ taskId: missing }, system, REQ);
    expect(expectErr(res, 'TASK_NOT_FOUND').payload).toEqual({
      taskId: missing,
    });
  });

  it('пользователь напрямую — UNAUTHORIZED: только system', async () => {
    tasks.seed(task(ASSIGNEE));
    const person = new UserCaller<ExampleUser>({
      uuid: OWNER,
      hasRole: () => false,
    });
    expectErr(await uc.handle({ taskId: TASK }, person, REQ), 'UNAUTHORIZED');
  });
});
