import { describe, expect, test } from 'bun:test';
import { VersionConflict } from '#core/app/uow/repository';
import type { TaskRepo } from '#core/testing/example/app/todo/task/task.repo';
import { TaskAr, TaskArDef } from '#core/testing/example/todo/index';
import type { TaskState } from '#core/testing/example/todo/state';
import { OWNER, T0, TASK, TASK_2, taskRow } from '../app/app.fixture';
import { expectOk } from './expect-result';
import { MemoryRepo } from './memory-repo';

const T1 = T0 + 1000;

/**
 * Фейк порта `TaskRepo`: запись — память базы, методы поиска — ответы,
 * которые задаёт тест (`findById` — удобство по uuid из памяти).
 */
class MemoryTaskRepo extends MemoryRepo<TaskAr, TaskState> implements TaskRepo {
  constructor() {
    super(TaskArDef, TaskAr.restore);
  }

  findById = async (uuid: string) => this.restored(uuid);
  findActiveByOwner = this.unanswered<[ownerId: string], TaskAr[]>(
    'findActiveByOwner',
  );
  findActiveByParticipant = this.unanswered<[userId: string], TaskAr[]>(
    'findActiveByParticipant',
  );
  findDone = this.unanswered<[], TaskAr[]>('findDone');
}

const created = (uuid = TASK): TaskAr =>
  expectOk(TaskAr.create({ uuid, ownerId: OWNER, title: 'Купить хлеб' }, T0));

describe('MemoryRepo', () => {
  test('round trip: save → чтение — тот же снапшот, новый объект', async () => {
    const repo = new MemoryTaskRepo();
    const ar = created();
    await repo.save(ar);
    const read = await repo.findById(TASK);
    expect(read?.snapshot()).toEqual(ar.snapshot());
    expect(read).not.toBe(ar);
    expect(await repo.findById(TASK)).not.toBe(read);
  });

  test('restored — нет записи — undefined; restoredOrThrow — исключение', () => {
    const repo = new MemoryTaskRepo();
    expect(repo.restored(TASK)).toBeUndefined();
    expect(() => repo.restoredOrThrow(TASK)).toThrow(
      `MemoryRepo task: нет записи ${TASK}`,
    );
  });

  test('seed копирует снапшот: правка исходного объекта не меняет запись', () => {
    const row = taskRow(TASK);
    const repo = new MemoryTaskRepo().seed(row);
    row.title = 'Другое';
    expect(repo.restoredOrThrow(TASK).snapshot()).toEqual(taskRow(TASK));
  });

  test('seed — записи до UC; агрегат из seed сохраняется по версии', async () => {
    const repo = new MemoryTaskRepo().seed(taskRow(TASK), taskRow(TASK_2));
    const ar = await repo.findById(TASK);
    expect(ar?.snapshot()).toEqual(taskRow(TASK));
    expect(repo.saved).toEqual([]);
    if (ar === undefined) throw new Error('нет задачи');
    expectOk(ar.complete(T1));
    await repo.save(ar);
    expect(repo.restored(TASK)?.isDone()).toBe(true);
  });

  test('конфликт версии: запись изменена параллельно — VersionConflict', async () => {
    const repo = new MemoryTaskRepo().seed(taskRow(TASK));
    const a = repo.restored(TASK);
    const b = repo.restored(TASK);
    if (a === undefined || b === undefined) throw new Error('нет задачи');
    expectOk(a.complete(T1));
    expectOk(b.archive(T1));
    await repo.save(a);
    await expect(repo.save(b)).rejects.toThrow(VersionConflict);
    expect(repo.saved).toHaveLength(1);
  });

  test('новый агрегат поверх существующей записи — VersionConflict', async () => {
    const repo = new MemoryTaskRepo().seed(taskRow(TASK));
    await expect(repo.save(created())).rejects.toThrow(VersionConflict);
    expect(repo.saved).toEqual([]);
  });

  test('saved — снапшоты записей по порядку на момент save', async () => {
    const repo = new MemoryTaskRepo();
    expect(repo.saved).toEqual([]);
    const ar = created();
    await repo.save(ar);
    const first = ar.snapshot();
    ar.markStored();
    expectOk(ar.complete(T1));
    await repo.save(ar);
    await repo.save(created(TASK_2));
    expect(repo.saved.map((s) => [s.uuid, s.status])).toEqual([
      [TASK, 'open'],
      [TASK, 'done'],
      [TASK_2, 'open'],
    ]);
    expect(repo.saved[0]).toEqual(first);
  });

  test('failOn — save этого uuid бросает, запись не меняется', async () => {
    const repo = new MemoryTaskRepo().failOn(TASK);
    await expect(repo.save(created())).rejects.toThrow(TASK);
    expect(repo.restored(TASK)).toBeUndefined();
    expect(repo.saved).toEqual([]);
    await repo.save(created(TASK_2));
    expect(repo.saved).toHaveLength(1);
  });

  test('метод порта — ответ, заданный тестом', async () => {
    const repo = new MemoryTaskRepo().seed(taskRow(TASK, 'done'));
    repo.findDone = async () => [repo.restoredOrThrow(TASK)];
    const done = await repo.findDone();
    expect(done.map((t) => t.uuid)).toEqual([TASK]);
  });

  test('метод порта без ответа — исключение с понятным текстом', async () => {
    const repo = new MemoryTaskRepo();
    await expect(repo.findActiveByOwner(OWNER)).rejects.toThrow(
      'MemoryRepo task: нет ответа для findActiveByOwner',
    );
  });

  test('без методов порта — сам MemoryRepo годится как Repository', async () => {
    const repo = new MemoryRepo(TaskArDef, TaskAr.restore);
    await repo.save(created());
    expect(repo.aggregate).toBe(TaskArDef);
    expect(repo.saved).toHaveLength(1);
  });
});

const TASK_3 = '2d8b4e3a-0c6f-4b5d-9e4a-3f7c9d1a5b32';

/** Фейк с тривиальной выборкой через `where` (предикат по снимку). */
class WhereTaskRepo extends MemoryTaskRepo {
  findDoneWhere = async () => this.where((s) => s.status === 'done');
}

describe('MemoryRepo.where', () => {
  test('Ar записей по предикату снимка — в порядке вставки', async () => {
    const repo = new WhereTaskRepo().seed(
      taskRow(TASK_2, 'done'),
      taskRow(TASK),
      taskRow(TASK_3, 'done'),
    );
    const done = await repo.findDoneWhere();
    expect(done.map((t) => t.uuid)).toEqual([TASK_2, TASK_3]);
  });

  test('видит записанное через save', async () => {
    const repo = new WhereTaskRepo().seed(taskRow(TASK));
    const ar = repo.restoredOrThrow(TASK);
    expectOk(ar.complete(T1));
    await repo.save(ar);
    const done = await repo.findDoneWhere();
    expect(done.map((t) => t.uuid)).toEqual([TASK]);
  });

  test('отдаёт новые Ar: правка без save не меняет память', async () => {
    const repo = new WhereTaskRepo().seed(taskRow(TASK, 'done'));
    const [first] = await repo.findDoneWhere();
    if (first === undefined) throw new Error('нет задачи');
    expectOk(first.archive(T1));
    const [again] = await repo.findDoneWhere();
    expect(again).not.toBe(first);
    expect(again?.snapshot()).toEqual(taskRow(TASK, 'done'));
  });
});
