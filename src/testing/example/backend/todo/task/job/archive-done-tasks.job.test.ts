import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { Trace } from '#core/kernel/trace/trace';
import {
  ArchiveDoneTasksJobDef,
  TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { TaskState } from '#core/testing/example/platform/domain/todo/state';
import { expectOk, testAppContext } from '#core/testing/index';
import { TaskRepoFake } from '../task.repo.fake';
import { ArchiveDoneTasksJob } from './archive-done-tasks.job';

// Обход выполненных задач: у каждой своя UoW, сбой одной записи не
// прерывает обход; повторный прогон ничего не находит (идемпотентность).
// Репозиторий — фейк в памяти; выборку выполненных задаёт тест (`seed`).

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2, 3);

const row = (status: TaskState['status']): TaskState => ({
  uuid: crypto.randomUUID(),
  ownerId: OWNER,
  title: 'Задача',
  status,
  createdAt: T0,
  updatedAt: T0,
  version: 0,
  ...(status === 'done' && { completedAt: T0 }),
});

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;

beforeEach(() => {
  tasks = new TaskRepoFake();
  ctx = testAppContext({ at: T1 });
});

/**
 * Задачи в базе и ответ выборки выполненных: из этих задач — те, что
 * сейчас выполнены (свежие Ar из текущего состояния базы).
 */
const seed = (...rows: TaskState[]) => {
  tasks.seed(...rows);
  tasks.findDone = async () =>
    rows
      .map((r) => tasks.restoredOrThrow(r.uuid))
      .filter((task) => task.isDone());
};

const makeJob = () =>
  new ArchiveDoneTasksJob(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );

const run = (job: ArchiveDoneTasksJob) =>
  job.handle(Trace.forJob(ArchiveDoneTasksJobDef));

describe('ArchiveDoneTasksJob', () => {
  it('выполненные — в архив, открытые не трогает', async () => {
    const done1 = row('done');
    const done2 = row('done');
    const open = row('open');
    seed(done1, open, done2);

    const report = expectOk(await run(makeJob()));

    expect(report).toEqual({ processed: 2, failed: 0 });
    expect(tasks.restored(done1.uuid)?.isArchived()).toBe(true);
    expect(tasks.restored(done2.uuid)?.isArchived()).toBe(true);
    expect(tasks.restored(open.uuid)?.snapshot()).toEqual(open);
    expect(ctx.published.map((e) => [e.name, e.payload])).toEqual([
      ['todo.task.archived', { taskId: done1.uuid, ownerId: OWNER }],
      ['todo.task.archived', { taskId: done2.uuid, ownerId: OWNER }],
    ]);
  });

  it('повторный прогон — ничего не находит и не пишет', async () => {
    seed(row('done'));
    const job = makeJob();
    expectOk(await run(job));
    const before = [...tasks.saved];
    const sent = ctx.published.length;

    expect(expectOk(await run(job))).toEqual({ processed: 0, failed: 0 });
    expect(tasks.saved).toEqual(before);
    expect(ctx.published).toHaveLength(sent);
  });

  it('сбой записи одной задачи — остальные архивированы, сбой в логе', async () => {
    const broken = row('done');
    const fine = row('done');
    seed(broken, fine);
    tasks.failOn(broken.uuid);

    const report = expectOk(await run(makeJob()));

    expect(report).toEqual({ processed: 1, failed: 1 });
    expect(tasks.restored(broken.uuid)?.isDone()).toBe(true);
    expect(tasks.restored(fine.uuid)?.isArchived()).toBe(true);
    expect(ctx.logs).toContainEqual(
      expect.objectContaining({ level: 'error', source: 'archiveDoneTasks' }),
    );
  });
});
