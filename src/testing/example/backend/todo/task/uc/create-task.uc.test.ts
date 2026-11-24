import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { UserCaller } from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import {
  OPEN_TASKS_LIMIT,
  TaskAr,
  TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { CreateTaskUc } from './create-task.uc';

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const owner = new UserCaller<ExampleUser>({
  uuid: OWNER,
  hasRole: () => false,
});

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: CreateTaskUc;

beforeEach(() => {
  tasks = new TaskRepoFake();
  // Открытые задачи владельца — всё, что UC успел записать: других задач в
  // тесте нет, выборку проверяет контрактный тест репозитория.
  tasks.findActiveByOwner = async () =>
    tasks.saved.map((s) => TaskAr.restore(s));
  ctx = testAppContext({ at: Date.UTC(2026, 9, 1) });
  uc = new CreateTaskUc(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
});

const create = (title: string) => uc.handle({ title }, owner, REQ);

describe('CreateTaskUc — доменное правило предела открытых задач', () => {
  it('до предела задачи создаются', async () => {
    for (let i = 0; i < OPEN_TASKS_LIMIT; i++) {
      expectOk(await create(`Задача ${i}`));
    }
    expect(tasks.saved).toHaveLength(OPEN_TASKS_LIMIT);
  });

  it('сверх предела — ошибка правила, ничего не зафиксировано', async () => {
    for (let i = 0; i < OPEN_TASKS_LIMIT; i++) await create(`Задача ${i}`);
    const published = ctx.published.length;
    const res = await create('Лишняя');
    expect(expectErr(res, 'TASK_TOO_MANY_OPEN').payload).toEqual({
      limit: OPEN_TASKS_LIMIT,
    });
    expect(tasks.saved).toHaveLength(OPEN_TASKS_LIMIT);
    expect(ctx.published).toHaveLength(published);
  });
});
