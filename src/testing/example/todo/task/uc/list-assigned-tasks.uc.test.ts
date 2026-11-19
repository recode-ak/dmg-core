import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { normalize } from '#core/graph/normalize';
import { TaskAr } from '../task.ar';
import type { TaskState } from '../task.state';
import { ListAssignedTasksUcDef } from './list-assigned-tasks.uc';

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const full: TaskState = {
  uuid: '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10',
  ownerId: OWNER,
  title: 'Хлеб',
  status: 'done',
  createdAt: 1,
  updatedAt: 2,
  version: 3,
  completedAt: 2,
  assignment: { assigneeId: ASSIGNEE, assignedAt: 1 },
};

describe('ListAssignedTasksUcDef', () => {
  it('query пользователя, виден в UI: вызывающий — только user', () => {
    expect(normalize(ListAssignedTasksUcDef)).toMatchObject({
      name: 'listAssignedTasks',
      type: 'query',
      aggregate: 'task',
      callers: ['user'],
      visible: true,
      errors: [],
      emits: [],
    });
  });

  it('выход — полный state задачи: поля не теряются', () => {
    expect(v.parse(ListAssignedTasksUcDef.output, [full])).toEqual([full]);
  });

  it('строка выхода восстанавливается в TaskAr.readonly', () => {
    const [row] = v.parse(ListAssignedTasksUcDef.output, [full]);
    if (!row) throw new Error('строка выхода пуста');
    const task = TaskAr.readonly(row);
    expect(task.isOwnedBy(OWNER)).toBe(true);
    expect(task.isDone()).toBe(true);
  });

  it('пустой список допустим, строка без ownerId — нет', () => {
    expect(v.is(ListAssignedTasksUcDef.output, [])).toBe(true);
    const { ownerId: _, ...withoutOwner } = full;
    expect(v.is(ListAssignedTasksUcDef.output, [withoutOwner])).toBe(false);
  });
});
