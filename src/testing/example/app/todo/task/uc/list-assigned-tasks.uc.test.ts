import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { SystemCaller, UserCaller } from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import type { ExampleUser } from '#core/testing/example/shared/app-user';
import { TodoModuleDef } from '#core/testing/example/todo/index';
import type { TaskState } from '#core/testing/example/todo/state';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { ListAssignedTasksUc } from './list-assigned-tasks.uc';

// Query субъекта: задачи, назначенные вызывающему (`userId` из вызывающего,
// не из входа); выход — поля схемы output вместе с владельцем.

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T0 = Date.UTC(2026, 9, 1);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const as = (uuid: string) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => false });

const row = (
  title: string,
  assigneeId: string,
  status: TaskState['status'] = 'open',
): TaskState => ({
  uuid: crypto.randomUUID(),
  ownerId: OWNER,
  title,
  status,
  createdAt: T0,
  updatedAt: T0,
  version: 0,
  assignment: { assigneeId, assignedAt: T0 },
  ...(status === 'done' && { completedAt: T0 }),
});

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: ListAssignedTasksUc;

beforeEach(() => {
  tasks = new TaskRepoFake();
  ctx = testAppContext({ at: T0 });
  uc = new ListAssignedTasksUc(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
});

describe('ListAssignedTasksUc', () => {
  it('задачи других владельцев, назначенные вызывающему, — uuid, title, status, ownerId', async () => {
    const open = row('Хлеб', ASSIGNEE);
    const done = row('Молоко', ASSIGNEE, 'done');
    tasks.seed(open, done);
    // Выборку неархивных назначенных задач проверяет контрактный тест
    // репозитория; здесь ответ порта — только для исполнителя из вызывающего.
    tasks.findActiveByAssignee = async (userId) =>
      userId === ASSIGNEE
        ? [tasks.restoredOrThrow(open.uuid), tasks.restoredOrThrow(done.uuid)]
        : [];

    const res = await uc.handle({}, as(ASSIGNEE), REQ);

    expect(expectOk(res)).toEqual([
      { uuid: open.uuid, title: 'Хлеб', status: 'open', ownerId: OWNER },
      { uuid: done.uuid, title: 'Молоко', status: 'done', ownerId: OWNER },
    ]);
  });

  it('чужие назначения не видны — порт спрошен по вызывающему, ничего не записано', async () => {
    const asked: string[] = [];
    tasks.findActiveByAssignee = async (userId) => {
      asked.push(userId);
      return [];
    };

    expect(expectOk(await uc.handle({}, as(OWNER), REQ))).toEqual([]);
    expect(asked).toEqual([OWNER]);
    expect(tasks.saved).toEqual([]);
    expect(ctx.published).toEqual([]);
  });

  it('системный вызов — UNAUTHORIZED: callers только user', async () => {
    const job = new SystemCaller<ExampleUser>({
      kind: 'job',
      module: 'todo',
      name: 'archiveDoneTasks',
    });
    expectErr(await uc.handle({}, job, REQ), 'UNAUTHORIZED');
  });
});
