import { beforeEach, describe, expect, test } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import { testAppContext } from '#core/testing/app-context';
import {
  type TaskState,
  TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import { UserEvents } from '#core/testing/example/platform/domain/users/contract';
import { expectOk } from '#core/testing/expect-result';
import { expectIdempotentReaction } from '#core/testing/reaction-idempotency';
import { TaskRepoFake } from '../task.repo.fake';
import { ReleaseRemovedUserTasksEr } from './release-removed-user-tasks.er';

// Реакция на событие внешнего модуля через DCS: ER загружает задачи
// удалённого пользователя (свои и назначенные ему), решение — `TaskReleaseDcs`.
// Репозиторий — фейк в памяти; выборку задач с участием пользователя
// задаёт тест (`answer`), её корректность — контрактный тест репозитория.

const REMOVED = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2);

let tasks: TaskRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let er: ReleaseRemovedUserTasksEr;

beforeEach(() => {
  tasks = new TaskRepoFake();
  tasks.findActiveByParticipant = async () => [];
  ctx = testAppContext({ at: T1 });
  er = new ReleaseRemovedUserTasksEr(
    { app: ctx.app, facades: new ModuleFacades(), tasks },
    TodoModuleDef,
  );
});
/** Задача в базе — как от прежних сессий. */
const row = (
  ownerId: string,
  status: TaskState['status'] = 'open',
  assigneeId?: string,
): TaskState => ({
  uuid: crypto.randomUUID(),
  ownerId,
  title: 'Задача',
  status,
  createdAt: T0,
  updatedAt: T0,
  version: 0,
  ...(assigneeId && { assignment: { assigneeId, assignedAt: T0 } }),
});

const seed = (rows: TaskState[]) => tasks.seed(...rows);

/**
 * Ответ выборки задач с участием пользователя: эти задачи, каждый вызов —
 * свежие Ar из текущего состояния базы.
 */
const answer = (rows: readonly TaskState[]) => {
  tasks.findActiveByParticipant = async () =>
    rows.map((r) => tasks.restoredOrThrow(r.uuid));
};

const removed = {
  ...UserEvents.removed.make({ userId: REMOVED }),
  eventId: 'e-removed',
  occurredAt: T1,
  aggregateId: REMOVED,
  cause: { kind: 'request', requestId: 'r-1' },
  correlationId: 'c-1',
} as const;

const stored = (uuid: string) => tasks.restored(uuid)?.snapshot();

const published = () => ctx.published.map((e) => [e.name, e.payload]);

describe('ReleaseRemovedUserTasksEr', () => {
  test('свои задачи — в архив, назначенные ему чужие — владельцам', async () => {
    const ownOpen = row(REMOVED);
    const ownDone = row(REMOVED, 'done', OTHER);
    const assigned = row(OTHER, 'open', REMOVED);
    const foreign = row(OTHER);
    seed([ownOpen, ownDone, assigned, foreign]);
    answer([ownOpen, ownDone, assigned]);

    expectOk(await er.handle(removed));

    expect(stored(ownOpen.uuid)?.status).toBe('archived');
    expect(stored(ownDone.uuid)?.status).toBe('archived');
    const released = stored(assigned.uuid);
    expect(released).toMatchObject({ status: 'open', version: 1 });
    expect(released?.assignment).toBeUndefined();
    expect(stored(foreign.uuid)).toEqual(foreign);
    expect(tasks.saved.map((r) => r.uuid)).toEqual([
      ownOpen.uuid,
      ownDone.uuid,
      assigned.uuid,
    ]);
    expect(published()).toEqual([
      ['todo.task.archived', { taskId: ownOpen.uuid, ownerId: REMOVED }],
      ['todo.task.archived', { taskId: ownDone.uuid, ownerId: REMOVED }],
      [
        'todo.task.unassigned',
        { taskId: assigned.uuid, ownerId: OTHER, assigneeId: REMOVED },
      ],
    ]);
  });

  test('своя задача, назначенная себе, — одна запись и одно событие', async () => {
    const own = row(REMOVED, 'open', REMOVED);
    seed([own]);
    answer([own]);

    expectOk(await er.handle(removed));

    expect(tasks.saved).toHaveLength(1);
    expect(stored(own.uuid)).toMatchObject({
      status: 'archived',
      version: 1,
    });
    expect(published()).toEqual([
      ['todo.task.archived', { taskId: own.uuid, ownerId: REMOVED }],
    ]);
  });

  test('задач у пользователя нет — Ok, ничего не записано', async () => {
    expectOk(await er.handle(removed));
    expect(tasks.saved).toEqual([]);
    expect(ctx.published).toEqual([]);
  });

  test('повтор users.user.removed с новым eventId — без записей и событий (D-47)', async () => {
    const rows = [row(REMOVED), row(OTHER, 'open', REMOVED)];
    seed(rows);
    answer(rows);
    await expectIdempotentReaction({
      event: removed,
      deliver: (event) => er.handle(event),
      published: ctx.published,
      state: () => [...tasks.saved],
    });
  });
});
