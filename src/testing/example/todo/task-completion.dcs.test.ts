import { describe, expect, it } from 'bun:test';
import { expectErr, expectOk } from '#core/testing/index';
import { TaskAr } from './task/task.ar';
import type { TaskStatus } from './task/task.state';
import { TaskCompletionDcs } from './task-completion.dcs';

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const T0 = Date.UTC(2026, 9, 1);
const T1 = Date.UTC(2026, 9, 2);

const task = (status: TaskStatus) =>
  TaskAr.restore({
    uuid: crypto.randomUUID(),
    ownerId: OWNER,
    title: 'Задача',
    status,
    createdAt: T0,
    updatedAt: T0,
    version: 0,
  });

describe('TaskCompletionDcs.completeAll — выполнение набора задач', () => {
  it('все открытые — все выполнены, возвращаются в порядке набора', () => {
    const first = task('open');
    const second = task('open');

    const completed = expectOk(
      new TaskCompletionDcs([first, second]).completeAll(T1),
    );

    expect(completed).toEqual([first, second]);
    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
  });

  it('выполненная в наборе — отказ первой ошибкой по порядку набора', () => {
    const tasks = [task('open'), task('done'), task('archived')];

    expectErr(
      new TaskCompletionDcs(tasks).completeAll(T1),
      'TASK_ALREADY_DONE',
    );
  });
});
